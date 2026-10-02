import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../src/config.js";
import type { Config } from "../src/config.js";
import { EbscoHttpAuthAdapter } from "../src/auth/ebsco-http-auth-adapter.js";
import { UpstreamApiClient } from "../src/upstream/upstream-client.js";
import { normalizeHtml } from "../src/content/html-normalizer.js";
import { ConnectorError } from "../src/errors.js";
import { publicCatalogAlias } from "../src/routes/catalog-aliases.js";

export type SmokeResult = {
  route: string;
  status: number | string;
  durationMs: number;
  responseShape?: string;
  url?: string;
  cookies?: string;
  errorCode?: string;
};

export function formatSmokeResult(result: SmokeResult): string {
  let safeUrl = "[REDACTED]";
  if (result.url) {
    try {
      const url = new URL(result.url);
      safeUrl = `${url.origin}${url.pathname}${url.search ? "?[REDACTED]" : ""}`;
    } catch {
      safeUrl = "[REDACTED]";
    }
  }
  return JSON.stringify({
    route: result.route,
    status: result.status,
    durationMs: result.durationMs,
    ...(result.responseShape ? { responseShape: result.responseShape } : {}),
    upstreamUrl: safeUrl,
    ...(result.cookies ? { session: "[REDACTED]" } : {}),
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
  });
}

function responseShape(value: unknown): string {
  if (!value || typeof value !== "object") return typeof value;
  const envelope = value as { header?: unknown; body?: unknown };
  if (!("header" in envelope) || !("body" in envelope)) return "object";
  if (Array.isArray(envelope.body)) return `envelope.array(${envelope.body.length})`;
  if (envelope.body && typeof envelope.body === "object" && typeof (envelope.body as { html?: unknown }).html === "string") return "envelope.object.html";
  return `envelope.${typeof envelope.body}`;
}

async function main(): Promise<void> {
  if (process.env.LIVE_SMOKE !== "1") {
    console.error(formatSmokeResult({ route: "startup", status: "disabled", durationMs: 0, errorCode: "LIVE_SMOKE_NOT_ENABLED" }));
    process.exitCode = 2;
    return;
  }

  let config: Config;
  try {
    try {
      config = loadConfig();
    } catch {
      console.error(formatSmokeResult({ route: "configuration", status: "failed", durationMs: 0, errorCode: "configuration_error" }));
      process.exitCode = 1;
      return;
    }
    const adapter = new EbscoHttpAuthAdapter(config);
    const started = Date.now();
    const session = await adapter.authenticate();
    console.log(formatSmokeResult({ route: "authenticate", status: 200, durationMs: Date.now() - started, responseShape: "authorized", cookies: session.cookieJar.toHeader(Math.floor(Date.now() / 1000)) }));

    const client = new UpstreamApiClient(config);
    const articleParams = {
      contentSource: process.env.LIVE_SMOKE_ARTICLE_CONTENT_SOURCE ?? "GeneralMotors",
      vehicleId: process.env.LIVE_SMOKE_ARTICLE_VEHICLE_ID ?? "100342221",
      articleId: process.env.LIVE_SMOKE_ARTICLE_ID ?? "4481222:17911387",
      bucketName: process.env.LIVE_SMOKE_ARTICLE_BUCKET_NAME ?? "Component Location Diagrams",
      articleSubtype: process.env.LIVE_SMOKE_ARTICLE_SUBTYPE ?? "",
      searchTerm: process.env.LIVE_SMOKE_ARTICLE_SEARCH_TERM ?? "",
    };
    const checks: Array<{ route: string; run: () => Promise<unknown> }> = [
      { route: "years", run: () => client.execute("years", {}, session) },
      { route: "makes", run: () => client.execute("makes", { year: 2024 }, session) },
      { route: "article", run: () => client.execute("article", articleParams, session) },
    ];
    for (const check of checks) {
      const checkStarted = Date.now();
      const value = await check.run();
      if (!value || typeof value !== "object" || !("header" in value) || !("body" in value)) throw new Error("invalid envelope");
      if (check.route === "article") {
        const body = (value as { body?: { html?: unknown } }).body;
        if (!body || typeof body.html !== "string") throw new Error("article HTML missing");
        const normalized = normalizeHtml(body.html, {
          publicBaseUrl: config.publicBaseUrl ?? "http://127.0.0.1:3000",
          contentSource: String(articleParams.contentSource),
          publicCatalog: publicCatalogAlias(String(articleParams.contentSource)),
          vehicleId: String(articleParams.vehicleId),
          upstreamOrigin: config.upstream.apiOrigin,
          connectorAssetUrl: () => "http://127.0.0.1:3000/v1/assets/reference/[REDACTED]",
        });
        if (!normalized.html) throw new Error("normalized article HTML is empty");
      }
      console.log(formatSmokeResult({ route: check.route, status: 200, durationMs: Date.now() - checkStarted, responseShape: responseShape(value) }));
    }
  } catch (error) {
    const code = error instanceof ConnectorError ? error.code : "smoke_failed";
    console.error(formatSmokeResult({ route: "smoke", status: "failed", durationMs: 0, errorCode: code }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(fileURLToPath(import.meta.url)).href === pathToFileURL(process.argv[1]).href) await main();
