import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UnitRow = {
  hospcode: string;
  name: string | null;
  district: string | null;
  province: string | null;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ hoscode: string }> },
) {
  const { hoscode } = await params;
  const cleanHoscode = hoscode?.trim();

  if (!cleanHoscode) {
    return NextResponse.json({ error: "hoscode required" }, { status: 400 });
  }

  const r = await db.query<UnitRow>(
    `select hospcode, name, district, province
       from hospcode
      where hospcode = $1
         or hospcode_5_digit = $1
         or hospcode_9_digit = $1
      order by (hospcode = $1) desc
      limit 1`,
    [cleanHoscode],
  );
  const row = r.rows[0];

  return NextResponse.json({
    unit: {
      hoscode: cleanHoscode,
      displayName: row?.name?.trim() || `หน่วยบริการ ${cleanHoscode}`,
      district: row?.district?.trim() || null,
      province: row?.province?.trim() || null,
    },
  });
}
