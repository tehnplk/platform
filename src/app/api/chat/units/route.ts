import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UnitSuggestionRow = {
  hospcode: string;
  name: string | null;
};

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ units: [] });
  }

  const like = `%${escapeLike(q)}%`;
  const prefix = `${escapeLike(q)}%`;
  const r = await db.query<UnitSuggestionRow>(
    `select hospcode, name
      from hospcode
      where hospcode ~ '^[0-9]{5}$'
        and chwpart = '65'
        and (
          hospcode ilike $1 escape '\\'
          or name ilike $1 escape '\\'
        )
      order by (hospcode = $2) desc,
               (hospcode ilike $3 escape '\\') desc,
               (name ilike $3 escape '\\') desc,
               hospcode asc
      limit 10`,
    [like, q, prefix],
  );

  return NextResponse.json({
    units: r.rows.map((row) => ({
      hoscode: row.hospcode,
      name: row.name?.trim() || "ไม่มีชื่อ",
    })),
  });
}
