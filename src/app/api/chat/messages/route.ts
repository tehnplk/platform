import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { broadcastNewMessage } from "@/lib/realtime-broadcast";
import { sendAdminPushNotifications } from "@/lib/web-push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AttachmentRow = {
  id: string;
  kind: "image" | "video" | "doc";
  filename: string;
  mime_type: string;
  size_bytes: number;
  duration_ms: number | null;
};

type MessageRow = {
  id: string;
  hoscode: string;
  role: "user" | "admin";
  body: string;
  client_id: string | null;
  created_at: string;
  read_at: string | null;
};

export async function GET(req: NextRequest) {
  const hoscode = req.nextUrl.searchParams.get("hoscode");
  if (!hoscode) {
    return NextResponse.json({ error: "hoscode required" }, { status: 400 });
  }
  const limit = Math.min(
    Number(req.nextUrl.searchParams.get("limit") ?? 100),
    500,
  );

  const msgs = await db.query<MessageRow>(
    `select id, hoscode, role, body, client_id, created_at, read_at
       from messages
      where hoscode = $1
      order by created_at asc
      limit $2`,
    [hoscode, limit],
  );

  if (msgs.rows.length === 0) {
    return NextResponse.json({ messages: [] });
  }

  const ids = msgs.rows.map((r) => r.id);
  const atts = await db.query<AttachmentRow & { message_id: string }>(
    `select id, message_id, kind, filename, mime_type, size_bytes, duration_ms
       from attachments
      where message_id = any($1::uuid[])`,
    [ids],
  );

  const byMessage = new Map<string, AttachmentRow[]>();
  for (const a of atts.rows) {
    const list = byMessage.get(a.message_id) ?? [];
    list.push({
      id: a.id,
      kind: a.kind,
      filename: a.filename,
      mime_type: a.mime_type,
      size_bytes: a.size_bytes,
      duration_ms: a.duration_ms,
    });
    byMessage.set(a.message_id, list);
  }

  return NextResponse.json({
    messages: msgs.rows.map((m) => ({
      ...m,
      attachments: byMessage.get(m.id) ?? [],
    })),
  });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const hoscode = String(formData.get("hoscode") ?? "").trim();
  const role = String(formData.get("role") ?? "");
  const body = String(formData.get("body") ?? "");
  const clientId = formData.get("client_id");
  const files = formData.getAll("attachments").filter(
    (v): v is File => v instanceof File && v.size > 0,
  );

  if (!hoscode) {
    return NextResponse.json({ error: "hoscode required" }, { status: 400 });
  }
  if (role !== "user" && role !== "admin") {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  if (!body.trim() && files.length === 0) {
    return NextResponse.json({ error: "empty message" }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("begin");

    // Ensure conversation exists (trigger handles this on insert too,
    // but inserting with FK requires the parent row first)
    await client.query(
      `insert into conversations (hoscode) values ($1)
         on conflict (hoscode) do nothing`,
      [hoscode],
    );

    const msgRes = await client.query<MessageRow>(
      `insert into messages (hoscode, role, body, client_id)
       values ($1, $2, $3, $4)
       returning id, hoscode, role, body, client_id, created_at, read_at`,
      [hoscode, role, body, typeof clientId === "string" ? clientId : null],
    );
    const msg = msgRes.rows[0];

    const attachmentResults: AttachmentRow[] = [];
    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      const kind: "image" | "video" | "doc" = file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("image/")
          ? "image"
          : "doc";
      const r = await client.query<AttachmentRow>(
        `insert into attachments
           (message_id, kind, filename, mime_type, size_bytes, data)
         values ($1, $2, $3, $4, $5, $6)
         returning id, kind, filename, mime_type, size_bytes, duration_ms`,
        [msg.id, kind, file.name, file.type || "application/octet-stream", buf.length, buf],
      );
      attachmentResults.push(r.rows[0]);
    }

    await client.query("commit");

    // Broadcast to all subscribers of this chat channel.
    // Fire-and-forget: do not await, do not fail the response if broadcast fails.
    void broadcastNewMessage(hoscode, {
      id: msg.id,
      client_id: msg.client_id,
      role: msg.role,
    });
    if (msg.role === "user") {
      void sendAdminPushNotifications({
        title: `หน่วยบริการ ${hoscode}`,
        body: msg.body.trim() || "มีข้อความใหม่เข้ามา",
        url: `/chat/admin?hoscode=${encodeURIComponent(hoscode)}`,
        tag: `chat-admin-${hoscode}`,
      });
    }

    return NextResponse.json({
      message: { ...msg, attachments: attachmentResults },
    });
  } catch (err) {
    await client.query("rollback");
    console.error("POST /api/chat/messages failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "insert failed" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
