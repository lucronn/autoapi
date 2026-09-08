import { createHmac, timingSafeEqual } from "node:crypto";
import { ConnectorError } from "../errors.js";
import type { AssetTarget } from "../content/url-rewriter.js";

export type SignedAssetTarget = AssetTarget;

type SignedPayload = SignedAssetTarget & {
  issuedAt: number;
  expiresAt: number;
};

const REFERENCE_TTL_SECONDS = 600;

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signature(payload: string, secret: Buffer): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

function validateTarget(target: SignedAssetTarget): void {
  if (!target || !["source", "graphic", "asset"].includes(target.kind) || !target.id || /[\u0000\r\n]/.test(target.id)) {
    throw new ConnectorError("invalid_asset_reference", "invalid_asset_reference: asset target is not supported", 400);
  }
  if ((target.kind === "source" || target.kind === "graphic") && (!target.source || !/^[A-Za-z0-9_-]+$/.test(target.source))) {
    throw new ConnectorError("invalid_asset_reference", "invalid_asset_reference: asset source is not supported", 400);
  }
}

export function createAssetReference(target: SignedAssetTarget, secret: Buffer, nowSeconds: number): string {
  validateTarget(target);
  if (secret.byteLength === 0) throw new Error("Asset signing secret must not be empty");
  const payload = encode(JSON.stringify({
    ...target,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + REFERENCE_TTL_SECONDS,
  } satisfies SignedPayload));
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export function verifyAssetReference(reference: string, secret: Buffer, nowSeconds: number): SignedAssetTarget {
  if (secret.byteLength === 0) throw new ConnectorError("invalid_asset_reference", "invalid_asset_reference: signing secret is empty", 400);
  const [payloadPart, signaturePart, extra] = reference.split(".");
  if (!payloadPart || !signaturePart || extra) throw new ConnectorError("invalid_asset_reference", "invalid_asset_reference: malformed reference", 400);
  const expected = signature(payloadPart, secret);
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signaturePart, "base64url");
  } catch {
    throw new ConnectorError("invalid_asset_reference", "invalid_asset_reference: malformed signature", 400);
  }
  if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) {
    throw new ConnectorError("invalid_asset_reference", "invalid_asset_reference: signature mismatch", 400);
  }

  let payload: SignedPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as SignedPayload;
  } catch {
    throw new ConnectorError("invalid_asset_reference", "invalid_asset_reference: malformed payload", 400);
  }
  validateTarget(payload);
  if (!Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= nowSeconds) {
    throw new ConnectorError("expired_asset_reference", "expired_asset_reference: asset reference has expired", 410);
  }
  return { kind: payload.kind, id: payload.id, ...(payload.source ? { source: payload.source } : {}) };
}
