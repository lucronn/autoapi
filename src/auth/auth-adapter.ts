import type { CookieJar } from "./cookie-jar.js";

export type AuthenticatedSession = {
  source: "server" | "override";
  cookieJar: CookieJar;
  createdAt: number;
  expiresAt?: number;
};

export type ValidationResult =
  | { valid: true; expiresAt?: number }
  | { valid: false; reason: "unauthorized" | "upstream_status" | "invalid_response" };

export interface AuthAdapter {
  authenticate(): Promise<AuthenticatedSession>;
  validate(session: AuthenticatedSession): Promise<ValidationResult>;
}
