import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

// /api/mcp authenticates with its own bearer tokens, so the login redirect must not catch it.
export const config = {
  matcher: [
    "/((?!login(?:/|$)|api/auth(?:/|$)|api/mcp(?:/|$)|_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)",
  ],
};
