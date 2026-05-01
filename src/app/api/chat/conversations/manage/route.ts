import { NextResponse } from "next/server";
import { auth, isAdminSession } from "@/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = {
  hoscode: string;
  last_chat_date_time: string | null;
  count_message: number;
};

export const GET = auth(async function GET(req) {
  if (!isAdminSession(req.auth)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const r = await db.query<Row>(
    `select c.hoscode,
            coalesce(c.last_message_at, max(m.created_at)) as last_chat_date_time,
            count(m.id)::int as count_message
       from conversations c
       left join messages m
         on m.hoscode = c.hoscode
        and m.created_at >= now() - interval '15 days'
      group by c.hoscode, c.last_message_at
      order by last_chat_date_time desc nulls last, c.hoscode asc`,
  );

  return NextResponse.json({ conversations: r.rows });
});
