import { NextResponse } from "next/server";
import { auth, getAdminSignInUrl, isAdminSession } from "@/auth";

export const proxy = auth((req) => {
  if (isAdminSession(req.auth)) {
    return NextResponse.next();
  }

  const callbackUrl = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  const signInUrl = new URL(
    getAdminSignInUrl(callbackUrl),
    req.nextUrl.origin,
  );

  return NextResponse.redirect(signInUrl);
});

export const config = {
  matcher: ["/chat/admin/manage/:path*"],
};
