import { NextResponse } from "next/server";
import { auth, isAdminSession } from "@/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = Promise<{ id: string }>;

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: unknown) {
  const text = readString(value);
  return text || null;
}

export const DELETE = auth(async function DELETE(req, ctx: { params: Params }) {
  if (!isAdminSession(req.auth)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  if (req.auth?.user?.id === id) {
    return NextResponse.json(
      { error: "You cannot delete your own account while signed in." },
      { status: 400 },
    );
  }

  const result = await db.query<{ id: string }>(
    `delete from team_users
      where id = $1::uuid
      returning id::text`,
    [id],
  );

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
});

export const PATCH = auth(async function PATCH(req, ctx: { params: Params }) {
  if (!isAdminSession(req.auth)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const payload = body && typeof body === "object" ? body : {};
  const fullname = readOptionalString(
    (payload as Record<string, unknown>).fullname,
  );
  const department = readOptionalString(
    (payload as Record<string, unknown>).department,
  );
  const roleInput = readString((payload as Record<string, unknown>).role);
  const role = roleInput === "admin" ? "admin" : "team";
  const isActive = Boolean((payload as Record<string, unknown>).is_active);

  if (req.auth?.user?.id === id && (role !== "admin" || !isActive)) {
    return NextResponse.json(
      { error: "You cannot remove admin access or deactivate your own account." },
      { status: 400 },
    );
  }

  const result = await db.query<{
    id: string;
    username: string;
    fullname: string | null;
    department: string | null;
    role: "admin" | "team";
    is_active: boolean;
    last_login: string | null;
    created_at: string;
  }>(
    `update team_users
        set fullname = $2,
            department = $3,
            role = $4,
            is_active = $5,
            updated_at = now()
      where id = $1::uuid
      returning id::text,
                username,
                fullname,
                department,
                role,
                is_active,
                last_login,
                created_at`,
    [id, fullname, department, role, isActive],
  );

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ user: result.rows[0] });
});
