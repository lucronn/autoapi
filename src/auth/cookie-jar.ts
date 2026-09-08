export type SerializedCookie = {
  name: string;
  value: string;
  domain?: string;
  path: string;
  expiresAt?: number;
  secure: boolean;
  httpOnly: boolean;
};

export type SerializedCookieJar = {
  version: 1;
  cookies: SerializedCookie[];
};

function asLines(headers: string | string[]): string[] {
  return Array.isArray(headers) ? headers : [headers];
}

function cookieKey(cookie: Pick<SerializedCookie, "name" | "domain" | "path">): string {
  return `${cookie.name}\u0000${cookie.domain ?? ""}\u0000${cookie.path}`;
}

function parseCookie(line: string, nowSeconds: number): SerializedCookie | undefined {
  const parts = line.split(";").map((part) => part.trim());
  const separator = parts[0]?.indexOf("=");
  if (!parts[0] || separator === undefined || separator <= 0) return undefined;

  const cookie: SerializedCookie = {
    name: parts[0].slice(0, separator),
    value: parts[0].slice(separator + 1),
    path: "/",
    secure: false,
    httpOnly: false,
  };

  for (const attribute of parts.slice(1)) {
    const [rawName, ...rawValue] = attribute.split("=");
    const name = rawName.toLowerCase();
    const value = rawValue.join("=").trim();
    if (name === "domain" && value) cookie.domain = value.toLowerCase();
    else if (name === "path" && value.startsWith("/")) cookie.path = value;
    else if (name === "secure") cookie.secure = true;
    else if (name === "httponly") cookie.httpOnly = true;
    else if (name === "max-age") {
      const seconds = Number(value);
      if (Number.isFinite(seconds)) cookie.expiresAt = nowSeconds + seconds;
    } else if (name === "expires") {
      const timestamp = Date.parse(value);
      if (Number.isFinite(timestamp)) cookie.expiresAt = Math.floor(timestamp / 1000);
    }
  }

  return cookie;
}

export class CookieJar {
  private constructor(private readonly cookies = new Map<string, SerializedCookie>()) {}

  static fromSetCookie(headers: string | string[], nowSeconds: number): CookieJar {
    const jar = new CookieJar();
    jar.addSetCookie(headers, nowSeconds);
    return jar;
  }

  addSetCookie(headers: string | string[], nowSeconds: number): void {
    for (const line of asLines(headers)) {
      const cookie = parseCookie(line, nowSeconds);
      if (!cookie) continue;
      const key = cookieKey(cookie);
      if (cookie.expiresAt !== undefined && cookie.expiresAt <= nowSeconds) this.cookies.delete(key);
      else this.cookies.set(key, cookie);
    }
  }

  toHeader(nowSeconds: number): string {
    for (const [key, cookie] of this.cookies) {
      if (cookie.expiresAt !== undefined && cookie.expiresAt <= nowSeconds) this.cookies.delete(key);
    }
    return [...this.cookies.values()].map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }

  serialize(): SerializedCookieJar {
    return { version: 1, cookies: [...this.cookies.values()] };
  }

  static deserialize(value: SerializedCookieJar): CookieJar {
    if (!value || value.version !== 1 || !Array.isArray(value.cookies)) throw new Error("Invalid cookie jar");
    return new CookieJar(new Map(value.cookies.map((cookie) => [cookieKey(cookie), { ...cookie }])));
  }
}
