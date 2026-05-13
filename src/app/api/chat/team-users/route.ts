import { NextResponse } from "next/server";
import { auth, isAdminSession } from "@/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TeamUserRow = {
  id: string;
  username: string;
  fullname: string | null;
  department: string | null;
  role: "admin" | "team";
  is_active: boolean;
  last_login: string | null;
  created_at: string;
};

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function sha256Hex(value: string) {
  const bytes = new Uint8Array(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    ),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export const GET = auth(async function GET(req) {
  if (!isAdminSession(req.auth)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await db.query<TeamUserRow>(
    `select id::text,
            username,
            fullname,
            department,
            role,
            is_active,
            last_login,
            created_at
       from team_users
      order by role asc, username asc`,
  );

  return NextResponse.json({ users: result.rows });
});

export const POST = auth(async function POST(req) {
  if (!isAdminSession(req.auth)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const payload = body && typeof body === "object" ? body : {};
  const username = readString((payload as Record<string, unknown>).username)
    .toLowerCase();
  const password = readString((payload as Record<string, unknown>).password);
  const fullname = readString((payload as Record<string, unknown>).fullname);
  const department = readString((payload as Record<string, unknown>).department);
  const roleInput = readString((payload as Record<string, unknown>).role);
  const role = roleInput === "admin" ? "admin" : "team";

  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    return NextResponse.json(
      { error: "Username must be 3-64 characters: a-z, 0-9, dot, dash, underscore." },
      { status: 400 },
    );
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters." },
      { status: 400 },
    );
  }

  try {
    const passwordHash = await sha256Hex(password);
    const result = await db.query<TeamUserRow>(
      `insert into team_users (
          username,
          password_hash,
          fullname,
          department,
          role,
          is_active
        )
        values ($1, $2, nullif($3, ''), nullif($4, ''), $5, true)
        returning id::text,
                  username,
                  fullname,
                  department,
                  role,
                  is_active,
                  last_login,
                  created_at`,
      [username, passwordHash, fullname, department, role],
    );

    return NextResponse.json({ user: result.rows[0] }, { status: 201 });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "23505"
    ) {
      return NextResponse.json(
        { error: "Username already exists." },
        { status: 409 },
      );
    }
    throw err;
  }
});
