import { NextResponse } from "next/server";
import { authConfigured, createSessionToken, passwordMatches, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth";

export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json({ error: "APP_PASSWORD and SESSION_SECRET are not configured on the server." }, { status: 503 });
  }
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  // Flat delay blunts online guessing without extra infrastructure.
  await new Promise((r) => setTimeout(r, 400));
  if (!(await passwordMatches(password))) {
    return NextResponse.json({ error: "That password isn't right." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
