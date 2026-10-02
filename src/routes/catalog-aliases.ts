import { ConnectorError } from "../errors.js";

const PUBLIC_TO_UPSTREAM = {
  gm: "GeneralMotors",
  toyota: "Toyota",
  catalog: "Motor",
} as const;

export type PublicCatalog = keyof typeof PUBLIC_TO_UPSTREAM;

export function resolveCatalogAlias(value: unknown, allowedContentSources: readonly string[]): string {
  const alias = String(value ?? "").trim().toLowerCase() as PublicCatalog;
  const upstream = PUBLIC_TO_UPSTREAM[alias];
  if (!upstream || !allowedContentSources.includes(upstream)) {
    throw new ConnectorError("invalid_request", "catalog is not available", 400);
  }
  return upstream;
}

export function publicCatalogAlias(upstream: string): string {
  const entry = Object.entries(PUBLIC_TO_UPSTREAM).find(([, value]) => value === upstream);
  return entry?.[0] ?? upstream;
}
