import type { Config } from "../config.js";
import { ConnectorError } from "../errors.js";
import { HttpClient, type HttpResponse, type HttpTransport } from "../http/http-client.js";
import type { AuthenticatedSession } from "../auth/auth-adapter.js";
import { buildMotorRequest, type MotorRequest, type MotorRouteId, type MotorRouteParams } from "./route-registry.js";

export type UpstreamEnvelope<T> = {
  header: Record<string, unknown>;
  body: T;
};

export class MotorApiClient {
  private readonly http: HttpClient;

  constructor(private readonly config: Config, transport?: HttpTransport) {
    this.http = new HttpClient(transport, {
      maxResponseBytes: config.limits.maxResponseBytes,
      timeoutMs: config.limits.requestTimeoutMs,
    });
  }

  buildRequest(routeId: MotorRouteId, params: MotorRouteParams): MotorRequest {
    return buildMotorRequest(
      routeId,
      params,
      this.config.upstream.apiOrigin,
      this.config.upstream.allowedContentSources,
    );
  }

  async executeResponse(routeId: MotorRouteId, params: MotorRouteParams, session: AuthenticatedSession): Promise<HttpResponse> {
    const request = this.buildRequest(routeId, params);
    return this.http.request({
      method: request.method,
      url: request.url,
      headers: {
        accept: request.responseKind === "json" ? "application/json" : "text/plain, application/xml;q=0.9, */*;q=0.8",
        cookie: session.cookieJar.toHeader(Math.floor(Date.now() / 1000)),
      },
    });
  }

  async execute<T = unknown>(routeId: MotorRouteId, params: MotorRouteParams, session: AuthenticatedSession): Promise<UpstreamEnvelope<T>> {
    const response = await this.executeResponse(routeId, params, session);
    if (response.status < 200 || response.status >= 300) {
      throw new ConnectorError("upstream_error", "MOTOR request failed", 502, response.status);
    }
    const request = this.buildRequest(routeId, params);
    if (request.responseKind === "text") {
      return { header: { statusCode: response.status }, body: response.body.toString("utf8") as T };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body.toString("utf8"));
    } catch (error) {
      throw new ConnectorError("upstream_error", "MOTOR returned invalid JSON", 502, response.status, error);
    }
    if (!parsed || typeof parsed !== "object" || !("header" in parsed) || !("body" in parsed)) {
      throw new ConnectorError("upstream_error", "MOTOR returned an invalid response envelope", 502, response.status);
    }
    return parsed as UpstreamEnvelope<T>;
  }
}
