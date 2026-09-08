import type { AuthAdapter, AuthenticatedSession } from "./auth-adapter.js";
import type { EncryptedSessionStore } from "./session-store.js";

type SessionManagerOptions = {
  refreshSkewSeconds: number;
  now?: () => number;
};

type SessionOperation<T extends { status: number }> = (session: AuthenticatedSession) => Promise<T>;

export class SessionManager {
  private session?: AuthenticatedSession;
  private validated = false;
  private refreshPromise?: Promise<AuthenticatedSession>;
  private readonly now: () => number;

  constructor(
    private readonly adapter: AuthAdapter,
    private readonly store: Pick<EncryptedSessionStore, "load" | "save">,
    private readonly options: SessionManagerOptions,
  ) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async getSession(): Promise<AuthenticatedSession> {
    if (!this.session) this.session = await this.store.load();
    if (this.session && this.isUsableByExpiry(this.session)) {
      if (!this.validated) {
        const validation = await this.adapter.validate(this.session);
        if (!validation.valid) return this.refresh();
        if (validation.expiresAt !== undefined) {
          this.session.expiresAt = validation.expiresAt;
          await this.store.save(this.session);
        }
        this.validated = true;
      }
      return this.session;
    }
    return this.refresh();
  }

  async withSession<T extends { status: number }>(operation: SessionOperation<T>): Promise<T> {
    const session = await this.getSession();
    const response = await operation(session);
    if (response.status !== 401 && response.status !== 403) return response;
    const refreshed = await this.refresh();
    return operation(refreshed);
  }

  private isUsableByExpiry(session: AuthenticatedSession): boolean {
    return session.expiresAt === undefined || session.expiresAt - this.now() > this.options.refreshSkewSeconds;
  }

  private refresh(): Promise<AuthenticatedSession> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.adapter.authenticate()
      .then(async (session) => {
        this.session = { ...session, source: "server" };
        this.validated = true;
        await this.store.save(this.session);
        return this.session;
      })
      .finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }
}
