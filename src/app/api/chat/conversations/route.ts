import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = {
  hoscode: string;
  display_name: string | null;
  unit_name: string | null;
  last_message_at: string | null;
  admin_unread: number;
  last_body: string | null;
  last_role: "user" | "admin" | null;
};

export async function GET() {
  const r = await db.query<Row>(
    `select c.hoscode,
            c.display_name,
            h.name as unit_name,
            c.last_message_at,
            c.admin_unread,
            m.body as last_body,
            m.role as last_role
       from conversations c
       left join lateral (
         select name
           from hospcode
          where hospcode = c.hoscode
          limit 1
       ) h on true
       left join lateral (
         select body, role
           from messages
          where hoscode = c.hoscode
            and created_at >= now() - interval '15 days'
          order by created_at desc
          limit 1
       ) m on true
      where c.last_message_at is null
         or c.last_message_at >= now() - interval '15 days'
      order by c.last_message_at desc nulls last`,
  );
  return NextResponse.json({ conversations: r.rows });
}
