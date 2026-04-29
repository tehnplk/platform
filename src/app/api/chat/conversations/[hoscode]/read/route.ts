import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

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
  const col = role === "user" ? "user_unread" : "admin_unread";
  await db.query(
    `update conversations set ${col} = 0 where hoscode = $1`,
    [hoscode],
  );
  return NextResponse.json({ ok: true });
}
