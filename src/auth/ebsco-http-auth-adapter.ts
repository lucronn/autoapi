import type { Config } from "../config.js";
import { ConnectorError } from "../errors.js";
import { HttpClient, type HttpResponse, type HttpTransport } from "../http/http-client.js";
import { CookieJar } from "./cookie-jar.js";
import type { AuthAdapter, AuthenticatedSession, ValidationResult } from "./auth-adapter.js";

const DISPATCHER_ORIGIN = "https://logon.ebsco.zone";
const MAX_REDIRECTS = 8;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function header(response: HttpResponse, name: string): string | string[] | undefined {
  return response.headers[name.toLowerCase()];
}

function setCookies(response: HttpResponse, jar: CookieJar, now: number): void {
  const values = header(response, "set-cookie");
  if (values) jar.addSetCookie(values, now);
}

function text(response: HttpResponse): string {
  return response.body.toString("utf8");
}

function parseJson(response: HttpResponse, message: string): Record<string, any> {
  try {
    const value: unknown = JSON.parse(text(response));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, any>;
  } catch (error) {
    throw new ConnectorError("upstream_error", message, 502, response.status, error);
  }
}

function ensureAllowed(url: URL, config: Config): void {
  const allowed = new Set([
    new URL(config.upstream.entryUrl).origin,
    config.upstream.loginOrigin,
    config.upstream.apiOrigin,
    DISPATCHER_ORIGIN,
  ]);
  if (!allowed.has(url.origin)) throw new ConnectorError("blocked_upstream_target", "Upstream redirect target is not allowlisted", 502);
}

export class EbscoHttpAuthAdapter implements AuthAdapter {
  private readonly client: HttpClient;

  constructor(private readonly config: Config, transport?: HttpTransport) {
    this.client = new HttpClient(transport, {
      maxResponseBytes: config.limits.maxResponseBytes,
      timeoutMs: config.limits.requestTimeoutMs,
      maxConcurrentRequests: config.limits.maxConcurrentUpstream,
    });
  }

  private async followGet(startUrl: string, jar: CookieJar): Promise<HttpResponse> {
    let current = new URL(startUrl);
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      ensureAllowed(current, this.config);
      const response = await this.client.request({
        method: "GET",
        url: current.toString(),
        headers: jar.toHeader(nowSeconds()) ? { cookie: jar.toHeader(nowSeconds()) } : undefined,
      });
      setCookies(response, jar, nowSeconds());
      if (response.status < 300 || response.status >= 400) return response;
      const location = header(response, "location");
      if (typeof location !== "string" || !location) throw new ConnectorError("upstream_error", "Upstream redirect omitted a location", 502, response.status);
      current = new URL(location, current);
    }
    throw new ConnectorError("upstream_error", "Upstream redirect limit exceeded", 502);
  }

  async authenticate(): Promise<AuthenticatedSession> {
    const jar = CookieJar.empty();
    const loginPage = await this.followGet(this.config.upstream.entryUrl, jar);
    if (loginPage.status < 200 || loginPage.status >= 300) throw new ConnectorError("upstream_error", "Upstream login page failed", 502, loginPage.status);

    const match = text(loginPage).match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) throw new ConnectorError("upstream_auth_failed", "Upstream login state was not found", 502);

    let state: Record<string, any>;
    try {
      state = JSON.parse(match[1])?.props?.initialState?.login;
    } catch (error) {
      throw new ConnectorError("upstream_auth_failed", "Upstream login state was invalid", 502, undefined, error);
    }
    const original = state?.context?.original;
    const action = state?.modifiers?.inputs?.submit?.action;
    if (!original || typeof action !== "string") throw new ConnectorError("upstream_auth_failed", "Upstream login state was incomplete", 502);

    const loginResponse = await this.client.request({
      method: "POST",
      url: `${this.config.upstream.loginOrigin}/api/login/v1/prompted/next-step`,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(jar.toHeader(nowSeconds()) ? { cookie: jar.toHeader(nowSeconds()) } : {}),
      },
      body: JSON.stringify({
        action,
        context: {
          original: {
            authType: original.authType,
            customerId: original.customerId,
            groupId: original.groupId,
            profId: original.profId,
            opid: original.opid,
            language: original.locale,
            requestIdentifier: original.requestIdentifier,
            redirectUri: original.redirectUri,
            showonlyspecifiedtypes: original.showonlyspecifiedtypes,
            isSimplified: original.isSimplified,
            authRequest: original.authRequest,
            authToken: original.authToken,
          },
        },
        values: { prompt: this.config.upstream.promptValue, passwordPrompt: "" },
      }),
    });
    setCookies(loginResponse, jar, nowSeconds());
    if (loginResponse.status < 200 || loginResponse.status >= 300) throw new ConnectorError("upstream_auth_failed", "Upstream login submission failed", 502, loginResponse.status);
    const authorization = parseJson(loginResponse, "Upstream login response was invalid");
    if (authorization.view !== "authorized" || typeof authorization.context?.redirectUri !== "string") {
      throw new ConnectorError("upstream_auth_failed", "Upstream did not authorize the session", 502);
    }

    const callback = new URL(authorization.context.redirectUri);
    ensureAllowed(callback, this.config);
    // The callback chain can finish at a stale or moved upstream UI landing page.
    // Authentication is established by the callback redirects and must be
    // confirmed by the read-only API probe below, not by the UI page status.
    await this.followGet(callback.toString(), jar);

    const session: AuthenticatedSession = { source: "server", cookieJar: jar, createdAt: nowSeconds() };
    const validation = await this.validate(session);
    if (!validation.valid) throw new ConnectorError("upstream_auth_failed", "Authenticated upstream session could not be validated", 502);
    if (validation.expiresAt !== undefined) session.expiresAt = validation.expiresAt;
    return session;
  }

  async validate(session: AuthenticatedSession): Promise<ValidationResult> {
    const response = await this.client.request({
      method: "GET",
      url: new URL(this.config.session.validationPath, this.config.upstream.apiOrigin).toString(),
      headers: {
        accept: "application/json",
        ...(session.cookieJar.toHeader(nowSeconds()) ? { cookie: session.cookieJar.toHeader(nowSeconds()) } : {}),
      },
    });
    if (response.status === 401 || response.status === 403) return { valid: false, reason: "unauthorized" };
    if (response.status < 200 || response.status >= 300) return { valid: false, reason: "upstream_status" };
    const body = parseJson(response, "Upstream validation response was invalid");
    if (!body.header || body.header.statusCode === undefined || body.body === undefined) return { valid: false, reason: "invalid_response" };
    return { valid: true };
  }
}
