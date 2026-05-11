import type { NextRequest } from "next/server";
import {
  auth,
  getAdminSignInUrl,
  isAdminSession,
  isTeamSession,
} from "@/auth";

export async function proxy(req: NextRequest) {
  const session = await auth();
  const isManagePath = req.nextUrl.pathname.startsWith("/chat/admin/manage");
  const allowed = isManagePath ? isAdminSession(session) : isTeamSession(session);

  if (!allowed) {
    const callbackUrl = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    const signInUrl = new URL(
      getAdminSignInUrl(callbackUrl),
      req.nextUrl.origin,
    );
    return Response.redirect(signInUrl);
  }
}

export const config = {
  matcher: ["/chat/team/:path*", "/chat/admin/manage/:path*"],
};
