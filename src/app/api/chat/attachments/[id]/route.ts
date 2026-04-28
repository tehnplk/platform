import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const r = await db.query<{
    mime_type: string;
    filename: string;
    data: Buffer;
  }>(
    `select mime_type, filename, data from attachments where id = $1`,
    [id],
  );
  const row = r.rows[0];
  if (!row) {
    return new NextResponse("not found", { status: 404 });
  }
  return new NextResponse(new Uint8Array(row.data), {
    status: 200,
    headers: {
      "Content-Type": row.mime_type,
      "Content-Length": String(row.data.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": `inline; filename="${encodeURIComponent(row.filename)}"`,
    },
  });
}
