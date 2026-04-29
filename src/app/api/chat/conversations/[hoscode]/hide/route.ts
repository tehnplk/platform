import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ hoscode: string }> },
) {
  const { hoscode } = await params;
  if (!hoscode) {
    return NextResponse.json({ error: "hoscode required" }, { status: 400 });
  }
  await db.query(
    `update conversations set hidden_at = now() where hoscode = $1`,
    [hoscode],
  );
  return NextResponse.json({ ok: true });
}
