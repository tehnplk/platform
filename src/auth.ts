import type { Session } from "next-auth";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  department: string | null;
  role: string;
  is_active: boolean;
};

function readCredential(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function sha256Bytes(value: string) {
  return new Uint8Array(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    ),
  );
}

async function sha256Hex(value: string) {
  const bytes = await sha256Bytes(value);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function safeEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([
    sha256Bytes(left),
    sha256Bytes(right),
  ]);
  if (leftHash.length !== rightHash.length) return false;

  let diff = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    diff |= leftHash[index] ^ rightHash[index];
  }

  return diff === 0;
}

export function isAdminSession(session: Session | null | undefined) {
  return session?.user?.role === "admin" || session?.user?.role === "sub-admin";
}

export function normalizeCallbackUrl(
  callbackUrl: string | null | undefined,
  fallback = "/chat/admin/manage",
) {
  if (!callbackUrl) return fallback;
  if (!callbackUrl.startsWith("/") || callbackUrl.startsWith("//")) {
    return fallback;
  }
  return callbackUrl;
}

export function getAdminSignInUrl(callbackUrl: string) {
  return `/login?${new URLSearchParams({
    callbackUrl: normalizeCallbackUrl(callbackUrl),
  }).toString()}`;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      name: "Admin Login",
      credentials: {
        username: { label: "Username" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const username = readCredential(credentials?.username).toLowerCase();
        const password = readCredential(credentials?.password);

        if (!username || !password) return null;

        const { db } = await import("@/lib/db");
        const result = await db.query<UserRow>(
          `select id::text, username, password_hash, department, role, is_active
             from users
            where username = $1
              and is_active = true
            limit 1`,
          [username],
        );

        const userRow = result.rows[0];
        if (!userRow) return null;

        const passwordHash = await sha256Hex(password);
        if (!(await safeEqual(passwordHash, userRow.password_hash))) return null;

        void db.query(
          `update users set last_login = now(), updated_at = now()
            where id = $1::uuid`,
          [userRow.id],
        );

        return {
          id: userRow.id,
          name: userRow.username,
          role: userRow.role,
          department: userRow.department,
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.department = (user as { department?: string | null }).department ?? null;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = (token.role as string) ?? "user";
        session.user.department = (token.department as string | null) ?? null;
      }
      return session;
    },
  },
});
