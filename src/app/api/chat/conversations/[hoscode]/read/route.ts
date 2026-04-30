import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { broadcastReadReceipt } from "@/lib/realtime-broadcast";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ hoscode: string }> },
) {
  const { hoscode } = await params;
  const role = req.nextUrl.searchParams.get("role") ?? "admin";
  if (!hoscode) {
    return NextResponse.json({ error: "hoscode required" }, { status: 400 });
  }
  if (role !== "user" && role !== "admin") {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  const col = role === "user" ? "user_unread" : "admin_unread";
  const readAt = new Date().toISOString();
  await db.query(
    `update conversations set ${col} = 0 where hoscode = $1`,
    [hoscode],
  );
  await db.query(
    `update messages
        set read_at = coalesce(read_at, $2::timestamptz)
      where hoscode = $1
        and role <> $3
        and read_at is null
        and created_at >= now() - interval '15 days'`,
    [hoscode, readAt, role],
  );
  void broadcastReadReceipt(hoscode, {
    role: role === "user" ? "user" : "admin",
    read_at: readAt,
  });
  return NextResponse.json({ ok: true, read_at: readAt });
}
