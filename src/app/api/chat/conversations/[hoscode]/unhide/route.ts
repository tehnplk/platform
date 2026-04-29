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
    `insert into conversations (hoscode) values ($1)
       on conflict (hoscode) do update set hidden_at = null`,
    [hoscode],
  );
  return NextResponse.json({ ok: true });
}
