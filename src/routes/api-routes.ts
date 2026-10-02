import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { CookieJar } from "../auth/cookie-jar.js";
import type { AuthenticatedSession } from "../auth/auth-adapter.js";
import type { SessionManager } from "../auth/session-manager.js";
import type { Config } from "../config.js";
import { ConnectorError } from "../errors.js";
import { normalizeHtml } from "../content/html-normalizer.js";
import { createAssetReference } from "../assets/asset-reference.js";
import type { UpstreamApiClient, UpstreamEnvelope } from "../upstream/upstream-client.js";
import type { HttpResponse } from "../http/http-client.js";
import type { UpstreamRouteId } from "../upstream/route-registry.js";
import { ClientRateLimiter } from "../http/client-rate-limiter.js";
import { ResponseCache } from "../http/response-cache.js";
import { maskProviderContent } from "../content/branding-mask.js";
import { publicCatalogAlias, resolveCatalogAlias } from "./catalog-aliases.js";

export type ApiRouteDependencies = {
  config: Config;
  upstreamClient: UpstreamApiClient;
  sessionManager: SessionManager;
  clientRateLimiter: ClientRateLimiter;
  responseCache: ResponseCache;
};

type PublicRoute = {
  method: "GET";
  url: string;
  routeId: UpstreamRouteId;
  query: readonly string[];
};

export const PUBLIC_API_ROUTES: readonly PublicRoute[] = [
  { method: "GET", url: "/v1/api/years", routeId: "years", query: [] },
  { method: "GET", url: "/v1/api/year/:year/makes", routeId: "makes", query: [] },
  { method: "GET", url: "/v1/api/year/:year/make/:make/models", routeId: "models", query: [] },
  { method: "GET", url: "/v1/api/vin/:vin/vehicle", routeId: "vinVehicle", query: [] },
  { method: "GET", url: "/v1/api/catalog/:catalog/vehicles", routeId: "vehicles", query: ["vehicleIds"] },
  { method: "GET", url: "/v1/api/catalog/:catalog/:vehicleId/vehicle-details", routeId: "vehicleDetails", query: [] },
  { method: "GET", url: "/v1/api/catalog/:catalog/:vehicleId/name", routeId: "vehicleName", query: [] },
  { method: "GET", url: "/v1/api/catalog/:catalog/vehicle/:vehicleId/articles/v2", routeId: "articles", query: ["bucketName", "articleSubtype", "searchTerm"] },
  { method: "GET", url: "/v1/api/catalog/:catalog/vehicle/:vehicleId/article/:articleId", routeId: "article", query: ["bucketName", "articleSubtype", "searchTerm"] },
  { method: "GET", url: "/v1/api/catalog/:catalog/vehicle/:vehicleId/article/:articleId/title", routeId: "articleTitle", query: [] },
  { method: "GET", url: "/v1/api/catalog/:catalog/vehicle/:vehicleId/labor/:articleId", routeId: "labor", query: [] },
  { method: "GET", url: "/v1/api/catalog/:catalog/vehicle/:vehicleId/maintenanceSchedules/frequency", routeId: "maintenanceFrequency", query: [] },
  { method: "GET", url: "/v1/api/catalog/:catalog/vehicle/:vehicleId/maintenanceSchedules/intervals", routeId: "maintenanceIntervals", query: [] },
  { method: "GET", url: "/v1/api/catalog/:catalog/vehicle/:vehicleId/maintenanceSchedules/indicators", routeId: "maintenanceIndicators", query: [] },
  { method: "GET", url: "/v1/api/catalog/:catalog/vehicle/:vehicleId/parts", routeId: "parts", query: [] },
  { method: "GET", url: "/v1/api/catalog/:catalog/graphic/:id", routeId: "graphic", query: [] },
  { method: "GET", url: "/v1/api/asset/:handleId", routeId: "asset", query: [] },
  { method: "GET", url: "/v1/api/catalog/:catalog/xml/:articleId", routeId: "xml", query: [] },
  { method: "GET", url: "/v1/api/ui/usersettings", routeId: "userSettings", query: [] },
];

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function requestParams(request: FastifyRequest, queryNames: readonly string[], allowedContentSources: readonly string[]): Record<string, unknown> {
  const params = { ...(request.params as Record<string, unknown>) };
  if (params.catalog !== undefined) params.contentSource = resolveCatalogAlias(params.catalog, allowedContentSources);
  const query = request.query as Record<string, unknown>;
  for (const key of Object.keys(query)) {
    if (key !== "raw" && !queryNames.includes(key)) throw new ConnectorError("invalid_request", `Unsupported query parameter: ${key}`, 400);
  }
  for (const key of queryNames) if (query[key] !== undefined) params[key] = query[key];
  return params;
}

function overrideSession(request: FastifyRequest): AuthenticatedSession | undefined {
  const value = request.headers["x-upstream-cookie"];
  if (!value || Array.isArray(value)) return undefined;
  if (!value.trim() || /[\r\n]/.test(value)) throw new ConnectorError("invalid_request", "Invalid upstream cookie override", 400);
  const now = nowSeconds();
  const cookies = value.split(";").map((part) => {
    const trimmed = part.trim();
    if (!/^[^=;\s]+=[^;]*$/.test(trimmed)) throw new ConnectorError("invalid_request", "Invalid upstream cookie override", 400);
    return `${trimmed}; Path=/`;
  });
  return { source: "override", cookieJar: CookieJar.fromSetCookie(cookies, now), createdAt: now };
}

function parseEnvelope(response: HttpResponse): UpstreamEnvelope<unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body.toString("utf8"));
  } catch (error) {
    throw new ConnectorError("upstream_error", "Upstream returned invalid JSON", 502, response.status, error);
  }
  if (!parsed || typeof parsed !== "object" || !("header" in parsed) || !("body" in parsed)) {
    throw new ConnectorError("upstream_error", "Upstream returned an invalid response envelope", 502, response.status);
  }
  return parsed as UpstreamEnvelope<unknown>;
}

function publicBaseUrl(request: FastifyRequest, config: Config): string {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const forwardedProto = request.headers["x-forwarded-proto"];
  const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(",")[0]?.trim();
  const safeProtocol = protocol === "http" || protocol === "https" ? protocol : request.protocol;
  return `${safeProtocol}://${request.hostname}`;
}

function normalizeEnvelope(envelope: UpstreamEnvelope<unknown>, request: FastifyRequest, config: Config): UpstreamEnvelope<unknown> | (UpstreamEnvelope<unknown> & { connector: Record<string, unknown> }) {
  const catalog = String((request.params as Record<string, unknown>).catalog ?? "");
  const content = maskProviderContent(envelope.body);
  const maskedEnvelope = { ...envelope, body: content };
  if (!content || typeof content !== "object" || Array.isArray(content) || typeof (content as Record<string, unknown>).html !== "string") {
    return maskedEnvelope;
  }
  const body = content as Record<string, unknown>;
  const context = {
    publicBaseUrl: publicBaseUrl(request, config),
    contentSource: resolveCatalogAlias(catalog, config.upstream.allowedContentSources),
    publicCatalog: publicCatalogAlias(resolveCatalogAlias(catalog, config.upstream.allowedContentSources)),
    vehicleId: String((request.params as Record<string, unknown>).vehicleId ?? ""),
    upstreamOrigin: config.upstream.apiOrigin,
    connectorAssetUrl: (target: { kind: "source" | "graphic" | "asset"; id: string; source?: string }) => {
      const reference = createAssetReference(target, config.session.encryptionKey, nowSeconds());
      return `${publicBaseUrl(request, config)}/v1/assets/reference/${encodeURIComponent(reference)}`;
    },
  };
  const normalized = normalizeHtml(String(body.html), context);
  return {
    ...maskedEnvelope,
    body: { ...body, html: normalized.html },
    connector: { normalized: true, links: normalized.links, resources: normalized.resources },
  };
}

async function handleRoute(request: FastifyRequest, reply: FastifyReply, deps: ApiRouteDependencies, route: PublicRoute): Promise<void> {
  const params = requestParams(request, route.query, deps.config.upstream.allowedContentSources);
  const admission = deps.clientRateLimiter.check(request.ip || "unknown");
  if (!admission.allowed) {
    reply.header("retry-after", String(admission.retryAfterSeconds));
    throw new ConnectorError("client_rate_limited", "Caller request rate exceeded; request was not sent upstream", 429);
  }
  const override = overrideSession(request);
  const load = () => override
    ? deps.upstreamClient.executeResponse(route.routeId, params, override)
    : deps.sessionManager.withSession((session) => deps.upstreamClient.executeResponse(route.routeId, params, session));
  const response = override
    ? await load()
    : await deps.responseCache.getOrSet(cacheKey(route.routeId, params), cacheTtlSeconds(route.routeId), load);
  if (response.status < 200 || response.status >= 300) {
    const unavailableStatuses = new Set([400, 404, 500]);
    if (route.routeId === "parts" && response.status === 500) {
      throw new ConnectorError("parts_unavailable", "No parts list is available for this vehicle.", 404, response.status);
    }
    if (route.routeId === "labor" && unavailableStatuses.has(response.status)) {
      throw new ConnectorError("labor_unavailable", "No labor data is available for this vehicle or article.", 404, response.status);
    }
    if (["maintenanceFrequency", "maintenanceIntervals", "maintenanceIndicators"].includes(route.routeId) && unavailableStatuses.has(response.status)) {
      throw new ConnectorError("maintenance_schedule_unavailable", "No maintenance schedule is available for this vehicle.", 404, response.status);
    }
    if (route.routeId === "asset" && [400, 404].includes(response.status)) {
      throw new ConnectorError("asset_unavailable", "The requested upstream asset is unavailable or invalid.", 404, response.status);
    }
    throw new ConnectorError("upstream_error", "Upstream request failed", 502, response.status);
  }

  if (route.routeId === "graphic" || route.routeId === "asset" || route.routeId === "xml") {
    const contentType = response.headers["content-type"];
    if (typeof contentType === "string") reply.type(contentType);
    const textContentType = typeof contentType === "string" ? contentType : "";
    const body = route.routeId === "xml" && /(?:xml|text)\//i.test(textContentType)
      ? Buffer.from(maskProviderContent(response.body.toString("utf8")))
      : response.body;
    await reply.send(body);
    return;
  }
  const envelope = parseEnvelope(response);
  const query = request.query as Record<string, unknown>;
  await reply.send(query.raw === "true" || query.raw === true ? { ...envelope, body: maskProviderContent(envelope.body) } : normalizeEnvelope(envelope, request, deps.config));
}

function cacheKey(routeId: UpstreamRouteId, params: Record<string, unknown>): string {
  return `${routeId}:${JSON.stringify(Object.fromEntries(Object.entries(params).sort(([left], [right]) => left.localeCompare(right))))}`;
}

function cacheTtlSeconds(routeId: UpstreamRouteId): number {
  if (routeId === "article" || routeId === "articleTitle" || routeId === "labor") return 24 * 60 * 60;
  if (routeId === "graphic" || routeId === "asset" || routeId === "xml") return 60 * 60;
  return 15 * 60;
}

export function registerApiRoutes(app: FastifyInstance, deps: ApiRouteDependencies): void {
  for (const route of PUBLIC_API_ROUTES) {
    app.get(route.url, async (request, reply) => handleRoute(request, reply, deps, route));
  }
}
