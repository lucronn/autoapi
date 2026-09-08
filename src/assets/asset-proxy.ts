import { Readable } from "node:stream";
import type { Config } from "../config.js";
import { ConnectorError } from "../errors.js";
import type { AuthenticatedSession } from "../auth/auth-adapter.js";
import type { MotorApiClient } from "../motor/motor-client.js";
import { verifyAssetReference, type SignedAssetTarget } from "./asset-reference.js";

export type StreamedAsset = {
  body: Readable;
  contentType: string;
  contentLength?: number;
  headers: Record<string, string>;
};

export class AssetProxy {
  constructor(
    private readonly motorClient: MotorApiClient,
    private readonly config: Config,
    private readonly signingSecret: Buffer = config.session.encryptionKey,
  ) {}

  async stream(reference: string, session: AuthenticatedSession): Promise<StreamedAsset> {
    const target = verifyAssetReference(reference, this.signingSecret, Math.floor(Date.now() / 1000));
    this.assertAllowedTarget(target);
    const response = await this.motorClient.executeResponse(
      target.kind === "asset" ? "asset" : target.kind === "graphic" || target.kind === "source" ? "graphic" : "asset",
      target.kind === "asset"
        ? { handleId: target.id }
        : { contentSource: target.source, id: target.id },
      session,
      this.config.limits.maxAssetBytes,
    );
    if (response.status < 200 || response.status >= 300) {
      throw new ConnectorError("upstream_error", "MOTOR asset request failed", 502, response.status);
    }
    const contentType = this.header(response.headers, "content-type") ?? "application/octet-stream";
    const contentLengthValue = this.header(response.headers, "content-length");
    const contentLength = contentLengthValue && /^\d+$/.test(contentLengthValue) ? Number(contentLengthValue) : undefined;
    const headers: Record<string, string> = {};
    for (const name of ["etag", "cache-control", "last-modified"]) {
      const value = this.header(response.headers, name);
      if (value) headers[name] = value;
    }
    return { body: Readable.from(response.body), contentType, contentLength, headers };
  }

  private assertAllowedTarget(target: SignedAssetTarget): void {
    if ((target.source && !this.config.upstream.allowedContentSources.includes(target.source)) || (target.kind === "source" && !target.source)) {
      throw new ConnectorError("invalid_asset_reference", "invalid_asset_reference: source is not allowed", 400);
    }
  }

  private header(headers: Record<string, string | string[]>, name: string): string | undefined {
    const value = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }
}
