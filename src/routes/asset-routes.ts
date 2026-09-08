import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { AssetProxy } from "../assets/asset-proxy.js";
import type { SessionManager } from "../auth/session-manager.js";
import { CookieJar } from "../auth/cookie-jar.js";

export type AssetRouteDependencies = {
  config: Config;
  assetProxy: AssetProxy;
  sessionManager: SessionManager;
};

export function registerAssetRoutes(app: FastifyInstance, deps: AssetRouteDependencies): void {
  app.get("/v1/assets/motor/:reference", async (request, reply) => {
    const value = request.headers["x-upstream-cookie"];
    const now = Math.floor(Date.now() / 1000);
    const override = typeof value === "string"
      ? { source: "override" as const, cookieJar: CookieJar.fromSetCookie(value.split(";").map((part) => `${part.trim()}; Path=/`), now), createdAt: now }
      : undefined;
    const session = override ?? await deps.sessionManager.getSession();
    const reference = (request.params as { reference: string }).reference;
    const asset = await deps.assetProxy.stream(reference, session);
    reply.type(asset.contentType);
    if (asset.contentLength !== undefined) reply.header("content-length", asset.contentLength);
    for (const [key, valueToSet] of Object.entries(asset.headers)) reply.header(key, valueToSet);
    return reply.send(asset.body);
  });
}
