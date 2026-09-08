import Fastify, { type FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { Config } from "./config.js";
import { EbscoHttpAuthAdapter } from "./auth/ebsco-http-auth-adapter.js";
import { EncryptedSessionStore } from "./auth/session-store.js";
import { SessionManager } from "./auth/session-manager.js";
import { MotorApiClient } from "./motor/motor-client.js";
import { AssetProxy } from "./assets/asset-proxy.js";
import { serializeError } from "./errors.js";
import { registerApiRoutes } from "./routes/api-routes.js";
import { registerAssetRoutes } from "./routes/asset-routes.js";
import { registerHealthRoutes } from "./routes/health-routes.js";
import { registerOpenApi } from "./openapi.js";

export type ConnectorDependencies = {
  config: Config;
  motorClient?: MotorApiClient;
  sessionManager?: SessionManager;
  assetProxy?: AssetProxy;
};

export async function createApp(deps: ConnectorDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, requestIdHeader: "x-request-id" });
  const motorClient = deps.motorClient ?? new MotorApiClient(deps.config);
  const sessionManager = deps.sessionManager ?? new SessionManager(
    new EbscoHttpAuthAdapter(deps.config),
    new EncryptedSessionStore(deps.config.session.filePath, deps.config.session.encryptionKey),
    { refreshSkewSeconds: deps.config.session.refreshSkewSeconds },
  );
  const assetProxy = deps.assetProxy ?? new AssetProxy(motorClient, deps.config);

  app.setErrorHandler((error, request, reply) => {
    const serialized = serializeError(error, request.id);
    reply.code((error as { statusCode?: number }).statusCode ?? (error as { status?: number }).status ?? 500).send(serialized);
  });
  await app.register(swagger, {
      openapi: {
      openapi: "3.0.3",
      info: { title: "MOTOR Read-only Connector API", version: "0.1.0" },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  app.get("/openapi.json", async () => app.swagger());
  registerApiRoutes(app, { config: deps.config, motorClient, sessionManager });
  registerAssetRoutes(app, { config: deps.config, assetProxy, sessionManager });
  registerHealthRoutes(app);
  await app.ready();
  await registerOpenApi(app);
  return app;
}
