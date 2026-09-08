import type { FastifyInstance } from "fastify";
import { PUBLIC_API_ROUTES } from "./routes/api-routes.js";

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  const openapi = app.swagger?.();
  if (!openapi) return;
  openapi.paths ??= {};
  for (const route of PUBLIC_API_ROUTES) {
    const path = route.url.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    openapi.paths[path] ??= {};
    openapi.paths[path].get = {
      operationId: route.routeId,
      summary: `Read MOTOR ${route.routeId}`,
      parameters: [],
      responses: { "200": { description: "Upstream MOTOR response envelope" }, "502": { description: "Upstream failure" } },
    };
  }
}
