import { NextResponse, type NextRequest } from "next/server";
import { authConfigured, publicAccess, SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

const PUBLIC = ["/login", "/api/auth/login"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.includes(pathname)) return NextResponse.next();

  // Fail closed in production when the gate isn't configured; allow local development without it.
  if (!authConfigured()) {
    if (publicAccess()) return NextResponse.next();
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("Set APP_PASSWORD and SESSION_SECRET (or PUBLIC_ACCESS=true to run without sign-in).", { status: 503 });
    }
    return NextResponse.next();
  }

  const ok = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Your session has expired. Sign in again." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|svg|ico|woff2?)$).*)"],
};
