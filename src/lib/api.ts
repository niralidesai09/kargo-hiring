import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authConfigured, publicAccess, SESSION_COOKIE, verifySessionToken } from "./auth";
import { ConfigError } from "./db";
import { log } from "./log";

export function jsonError(status: number, error: string, code?: string) {
  return NextResponse.json({ error, code }, { status });
}

/** Second line of defence behind proxy.ts: every mutating route re-checks the session. */
export async function requireSession(): Promise<NextResponse | null> {
  if (!authConfigured()) {
    if (publicAccess()) return null;
    return process.env.NODE_ENV === "production" ? jsonError(503, "APP_PASSWORD and SESSION_SECRET are not configured.") : null;
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return (await verifySessionToken(token)) ? null : jsonError(401, "Your session has expired. Sign in again.");
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Wrap a handler so unexpected failures return a calm message and never leak internals. */
export function handle<A extends unknown[]>(name: string, fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      const denied = await requireSession();
      if (denied) return denied;
      return await fn(...args);
    } catch (err) {
      if (err instanceof ConfigError) return jsonError(503, err.message, "config");
      log.error(`api.${name}`, { error: (err as Error)?.message });
      return jsonError(500, "Something went wrong on the server. Try again.");
    }
  };
}
