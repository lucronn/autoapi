import { request as undiciRequest } from "undici";
import { ConnectorError } from "../errors.js";

export type HttpMethod = "GET" | "POST";

export type HttpRequest = {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
};

export type HttpResponse = {
  status: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
  url?: string;
};

export type HttpTransportRequest = HttpRequest & { signal?: AbortSignal };
export type HttpTransport = (request: HttpTransportRequest) => Promise<HttpResponse>;

export type HttpClientOptions = {
  maxResponseBytes?: number;
  timeoutMs?: number;
};

function normalizeHeaders(headers: Record<string, unknown>): Record<string, string | string[]> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key.toLowerCase(), Array.isArray(value) ? value.map(String) : String(value),
  ]));
}

async function defaultTransport(input: HttpTransportRequest): Promise<HttpResponse> {
  const response = await undiciRequest(input.url, {
    method: input.method,
    headers: input.headers,
    body: input.body,
    signal: input.signal,
  });
  const chunks: Buffer[] = [];
  for await (const chunk of response.body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return {
    status: response.statusCode,
    headers: normalizeHeaders(response.headers),
    body: Buffer.concat(chunks),
    url: input.url,
  };
}

export class HttpClient {
  private readonly options: Required<HttpClientOptions>;

  constructor(private readonly transport: HttpTransport = defaultTransport, options: HttpClientOptions = {}) {
    this.options = {
      maxResponseBytes: options.maxResponseBytes ?? 8 * 1024 * 1024,
      timeoutMs: options.timeoutMs ?? 15_000,
    };
  }

  async request(input: HttpRequest, options: { maxResponseBytes?: number } = {}): Promise<HttpResponse> {
    if (input.method !== "GET" && input.method !== "POST") throw new ConnectorError("invalid_request", "Only GET and POST are supported", 400);
    const url = new URL(input.url);
    if (url.protocol !== "https:") throw new ConnectorError("blocked_upstream_target", "Only HTTPS upstream targets are allowed", 400);

    let response: HttpResponse;
    try {
      response = await this.transport({ ...input, signal: AbortSignal.timeout(this.options.timeoutMs) });
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new ConnectorError("upstream_timeout", "Upstream request timed out", 504);
      }
      throw new ConnectorError("upstream_error", "Upstream request failed", 502, undefined, error);
    }

    if (response.body.byteLength > (options.maxResponseBytes ?? this.options.maxResponseBytes)) {
      throw new ConnectorError("upstream_response_too_large", "Upstream response exceeded the configured limit", 502, response.status);
    }
    return response;
  }
}
