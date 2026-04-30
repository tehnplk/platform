import { NextRequest, NextResponse } from "next/server";
import {
  getWebPushPublicKey,
  saveAdminPushSubscription,
} from "@/lib/web-push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const publicKey = getWebPushPublicKey();
  if (!publicKey) {
    return NextResponse.json(
      { error: "WEB_PUSH_PUBLIC_KEY is not configured" },
      { status: 503 },
    );
  }
  return NextResponse.json({ publicKey });
}

export async function POST(req: NextRequest) {
  const subscription = await req.json();
  if (
    !subscription ||
    typeof subscription.endpoint !== "string" ||
    !subscription.keys?.p256dh ||
    !subscription.keys?.auth
  ) {
    return NextResponse.json(
      { error: "invalid push subscription" },
      { status: 400 },
    );
  }

  await saveAdminPushSubscription(subscription);
  return NextResponse.json({ ok: true });
}
