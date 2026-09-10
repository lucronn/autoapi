export type ClientRateLimiterOptions = {
  maxRequests: number;
  windowSeconds: number;
  now?: () => number;
};

export type ClientRateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export class ClientRateLimiter {
  private readonly timestamps = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(private readonly options: ClientRateLimiterOptions) {
    if (!Number.isSafeInteger(options.maxRequests) || options.maxRequests <= 0) throw new Error("maxRequests must be a positive integer");
    if (!Number.isSafeInteger(options.windowSeconds) || options.windowSeconds <= 0) throw new Error("windowSeconds must be a positive integer");
    this.now = options.now ?? (() => Date.now() / 1000);
  }

  check(callerKey: string): ClientRateLimitDecision {
    const now = this.now();
    const cutoff = now - this.options.windowSeconds;
    const active = (this.timestamps.get(callerKey) ?? []).filter((timestamp) => timestamp > cutoff);

    if (active.length >= this.options.maxRequests) {
      this.timestamps.set(callerKey, active);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(active[0] + this.options.windowSeconds - now)),
      };
    }

    active.push(now);
    this.timestamps.set(callerKey, active);
    return { allowed: true };
  }
}
