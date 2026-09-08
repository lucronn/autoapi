import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { AuthenticatedSession } from "./auth-adapter.js";
import { CookieJar } from "./cookie-jar.js";

type EncryptedRecord = {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};

export class EncryptedSessionStore {
  constructor(private readonly filePath: string, private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("Session encryption key must be 32 bytes");
  }

  async load(): Promise<AuthenticatedSession | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }

    try {
      const record = JSON.parse(raw) as EncryptedRecord;
      if (record.version !== 1) throw new Error("unsupported session version");
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(record.iv, "base64url"));
      decipher.setAuthTag(Buffer.from(record.tag, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(record.ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
      const value = JSON.parse(plaintext) as Omit<AuthenticatedSession, "cookieJar"> & { cookieJar: ReturnType<CookieJar["serialize"]> };
      return {
        source: value.source,
        createdAt: value.createdAt,
        ...(value.expiresAt === undefined ? {} : { expiresAt: value.expiresAt }),
        cookieJar: CookieJar.deserialize(value.cookieJar),
      };
    } catch (error) {
      throw new Error("Unable to decrypt session state", { cause: error });
    }
  }

  async save(session: AuthenticatedSession): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const plaintext = JSON.stringify({
      source: session.source,
      createdAt: session.createdAt,
      ...(session.expiresAt === undefined ? {} : { expiresAt: session.expiresAt }),
      cookieJar: session.cookieJar.serialize(),
    });
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const record: EncryptedRecord = {
      version: 1,
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.tmp-${randomBytes(8).toString("hex")}`;
    await writeFile(temporaryPath, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
    await stat(this.filePath);
  }
}
