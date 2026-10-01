/**
 * Single-operator password gate. The session cookie is an HMAC-signed expiry
 * timestamp; nothing about the user is stored in it.
 */
export const SESSION_COOKIE = "kargo_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Explicit opt-out of the sign-in gate (PUBLIC_ACCESS=true). Never the default. */
export function publicAccess(): boolean {
  return process.env.PUBLIC_ACCESS?.trim().toLowerCase() === "true";
}

export function authConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD?.trim() && process.env.SESSION_SECRET?.trim());
}

export async function createSessionToken(now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  return `${exp}.${await hmac(process.env.SESSION_SECRET!, `v1.${exp}`)}`;
}

export async function verifySessionToken(token: string | undefined, now = Date.now()): Promise<boolean> {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!token || !secret) return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < now || !sig) return false;
  return safeEqual(sig, await hmac(secret, `v1.${exp}`));
}

export async function passwordMatches(input: string): Promise<boolean> {
  const expected = process.env.APP_PASSWORD?.trim();
  if (!expected) return false;
  // Compare digests so timing doesn't depend on where the strings differ.
  const secret = process.env.SESSION_SECRET ?? "";
  return safeEqual(await hmac(secret, input), await hmac(secret, expected));
}
