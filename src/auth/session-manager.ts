import type { AuthAdapter, AuthenticatedSession, ValidationResult } from "./auth-adapter.js";
import type { EncryptedSessionStore } from "./session-store.js";

type SessionManagerOptions = {
  refreshSkewSeconds: number;
  refreshFailureCooldownSeconds?: number;
  now?: () => number;
};

type SessionOperation<T extends { status: number }> = (session: AuthenticatedSession) => Promise<T>;

export class SessionManager {
  private session?: AuthenticatedSession;
  private validated = false;
  private loadPromise?: Promise<AuthenticatedSession | undefined>;
  private validationPromise?: Promise<ValidationResult>;
  private refreshPromise?: Promise<AuthenticatedSession>;
  private refreshFailure?: unknown;
  private refreshFailureUntil = 0;
  private readonly now: () => number;

  constructor(
    private readonly adapter: AuthAdapter,
    private readonly store: Pick<EncryptedSessionStore, "load" | "save">,
    private readonly options: SessionManagerOptions,
  ) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async getSession(): Promise<AuthenticatedSession> {
    if (!this.session) {
      if (!this.loadPromise) {
        this.loadPromise = this.store.load().finally(() => { this.loadPromise = undefined; });
      }
      this.session = await this.loadPromise;
    }
    const session = this.session;
    if (session && this.isUsableByExpiry(session)) {
      if (!this.validated) {
        if (!this.validationPromise) {
          this.validationPromise = this.validateAndPersist(session).finally(() => { this.validationPromise = undefined; });
        }
        const validation = await this.validationPromise;
        if (!validation.valid) return this.refresh();
        this.validated = true;
      }
      return session;
    }
    return this.refresh();
  }

  async withSession<T extends { status: number }>(operation: SessionOperation<T>): Promise<T> {
    const run = async (session: AuthenticatedSession): Promise<T> => {
      const cookiesBefore = JSON.stringify(session.cookieJar.serialize());
      const response = await operation(session);
      if (response.status >= 200 && response.status < 300 && JSON.stringify(session.cookieJar.serialize()) !== cookiesBefore) {
        await this.store.save(session);
      }
      return response;
    };
    const response = await run(await this.getSession());
    if (response.status !== 401 && response.status !== 403) return response;
    const refreshed = await this.refresh();
    return run(refreshed);
  }

  private isUsableByExpiry(session: AuthenticatedSession): boolean {
    return session.expiresAt === undefined || session.expiresAt - this.now() > this.options.refreshSkewSeconds;
  }

  private async validateAndPersist(session: AuthenticatedSession): Promise<ValidationResult> {
    const validation = await this.adapter.validate(session);
    if (validation.valid && validation.expiresAt !== undefined) {
      session.expiresAt = validation.expiresAt;
      if (this.session === session) await this.store.save(session);
    }
    return validation;
  }

  private refresh(): Promise<AuthenticatedSession> {
    if (this.refreshPromise) return this.refreshPromise;
    if (this.refreshFailure && this.now() < this.refreshFailureUntil) return Promise.reject(this.refreshFailure);
    this.refreshPromise = this.adapter.authenticate()
      .then(async (session) => {
        this.session = { ...session, source: "server" };
        this.validated = true;
        this.refreshFailure = undefined;
        this.refreshFailureUntil = 0;
        await this.store.save(this.session);
        return this.session;
      })
      .catch((error) => {
        this.refreshFailure = error;
        this.refreshFailureUntil = this.now() + (this.options.refreshFailureCooldownSeconds ?? 5);
        throw error;
      })
      .finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }
}
