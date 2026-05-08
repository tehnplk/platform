import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = {
  unread: number;
};

export async function GET() {
  const r = await db.query<Row>(
    `select coalesce(sum(greatest(admin_unread, 0)), 0)::int as unread
       from conversations
      where last_message_at is null
         or last_message_at >= now() - interval '15 days'`,
  );

  return NextResponse.json(
    {
      unread: r.rows[0]?.unread ?? 0,
      checked_at: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
