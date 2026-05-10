import type { NextRequest } from "next/server";
import { auth, getAdminSignInUrl, isAdminSession } from "@/auth";

export async function proxy(req: NextRequest) {
  const session = await auth();

  if (!isAdminSession(session)) {
    const callbackUrl = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    const signInUrl = new URL(
      getAdminSignInUrl(callbackUrl),
      req.nextUrl.origin,
    );
    return Response.redirect(signInUrl);
  }
}

export const config = {
  matcher: ["/chat/admin/manage/:path*"],
};
