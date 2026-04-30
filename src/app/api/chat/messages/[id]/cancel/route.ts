import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { broadcastCancelledMessage } from "@/lib/realtime-broadcast";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CANCELLED_MESSAGE_BODY = "ยกเลิกข้อความ";
const CANCELLED_IMAGE_BODY = "ยกเลิกส่งรูปภาพ";
const CANCELLED_FILE_BODY = "ยกเลิกส่งไฟล์";

type CancelledMessageRow = {
  id: string;
  hoscode: string;
  role: "user" | "admin";
  body: string;
  client_id: string | null;
  created_at: string;
  read_at: string | null;
  cancelled_at: string;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    hoscode?: string;
    role?: string;
  };
  const hoscode = body.hoscode?.trim();
  const role = body.role;

  if (!id) {
    return NextResponse.json({ error: "message id required" }, { status: 400 });
  }
  if (!hoscode) {
    return NextResponse.json({ error: "hoscode required" }, { status: 400 });
  }
  if (role !== "user" && role !== "admin") {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("begin");
    const attachmentKinds = await client.query<{
      kind: "image" | "video" | "doc";
    }>("select kind from attachments where message_id = $1", [id]);
    const cancelBody = attachmentKinds.rows.some((row) => row.kind !== "image")
      ? CANCELLED_FILE_BODY
      : attachmentKinds.rows.some((row) => row.kind === "image")
        ? CANCELLED_IMAGE_BODY
        : CANCELLED_MESSAGE_BODY;

    const updated = await client.query<CancelledMessageRow>(
      `update messages m
          set body = $4,
              cancelled_at = now()
        where m.id = $1
          and m.hoscode = $2
          and m.role = $3
          and m.cancelled_at is null
        returning id, hoscode, role, body, client_id, created_at, read_at, cancelled_at`,
      [id, hoscode, role, cancelBody],
    );

    const msg = updated.rows[0];
    if (!msg) {
      await client.query("rollback");
      return NextResponse.json(
        { error: "message is already cancelled or not yours" },
        { status: 409 },
      );
    }

    await client.query("delete from attachments where message_id = $1", [id]);
    await client.query("commit");

    void broadcastCancelledMessage(hoscode, {
      id: msg.id,
      role: msg.role,
      body: msg.body,
      cancelled_at: msg.cancelled_at,
    });

    return NextResponse.json({ message: { ...msg, attachments: [] } });
  } catch (err) {
    await client.query("rollback");
    console.error("POST /api/chat/messages/[id]/cancel failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "cancel failed" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
