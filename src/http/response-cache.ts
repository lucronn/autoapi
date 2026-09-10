import type { HttpResponse } from "./http-client.js";

type ResponseCacheOptions = {
  maxEntries: number;
  maxBytes: number;
  now?: () => number;
};

type CacheEntry = {
  response: HttpResponse;
  expiresAt: number;
  bytes: number;
};

function cloneHeaders(headers: HttpResponse["headers"]): HttpResponse["headers"] {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));
}

function cloneResponse(response: HttpResponse): HttpResponse {
  return {
    ...response,
    headers: cloneHeaders(response.headers),
    body: Buffer.from(response.body),
  };
}

export class ResponseCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<HttpResponse>>();
  private readonly now: () => number;
  private bytes = 0;

  constructor(private readonly options: ResponseCacheOptions) {
    if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries <= 0) throw new Error("maxEntries must be a positive integer");
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) throw new Error("maxBytes must be a positive integer");
    this.now = options.now ?? (() => Date.now() / 1000);
  }

  get(key: string): HttpResponse | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.remove(key, entry);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return cloneResponse(entry.response);
  }

  set(key: string, ttlSeconds: number, response: HttpResponse): void {
    if (response.status < 200 || response.status >= 300 || response.body.byteLength > this.options.maxBytes) return;
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) throw new Error("ttlSeconds must be positive");

    const existing = this.entries.get(key);
    if (existing) this.remove(key, existing);
    const cached = cloneResponse(response);
    delete cached.headers["set-cookie"];
    const entry: CacheEntry = { response: cached, expiresAt: this.now() + ttlSeconds, bytes: cached.body.byteLength };
    this.entries.set(key, entry);
    this.bytes += entry.bytes;
    this.evict();
  }

  async getOrSet(key: string, ttlSeconds: number, load: () => Promise<HttpResponse>): Promise<HttpResponse> {
    const cached = this.get(key);
    if (cached) return cached;
    const current = this.inFlight.get(key);
    if (current) return current.then(cloneResponse);

    const promise = load()
      .then((response) => {
        this.set(key, ttlSeconds, response);
        return cloneResponse(response);
      })
      .finally(() => { this.inFlight.delete(key); });
    this.inFlight.set(key, promise);
    return promise;
  }

  private remove(key: string, entry: CacheEntry): void {
    this.entries.delete(key);
    this.bytes -= entry.bytes;
  }

  private evict(): void {
    while (this.entries.size > this.options.maxEntries || this.bytes > this.options.maxBytes) {
      const oldest = this.entries.entries().next().value as [string, CacheEntry] | undefined;
      if (!oldest) return;
      this.remove(oldest[0], oldest[1]);
    }
  }
}
