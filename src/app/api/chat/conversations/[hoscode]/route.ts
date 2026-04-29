import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ hoscode: string }> },
) {
  const { hoscode } = await params;
  const cleanHoscode = hoscode?.trim();

  if (!cleanHoscode) {
    return NextResponse.json({ error: "hoscode required" }, { status: 400 });
  }

  const r = await db.query<{ hoscode: string }>(
    `delete from conversations
      where hoscode = $1
      returning hoscode`,
    [cleanHoscode],
  );

  return NextResponse.json({
    ok: true,
    deleted: (r.rowCount ?? 0) > 0,
    hoscode: cleanHoscode,
  });
}
