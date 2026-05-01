import type { Metadata } from "next";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import {
  auth,
  isAdminSession,
  normalizeCallbackUrl,
  signIn,
} from "@/auth";

export const metadata: Metadata = {
  title: "Admin Login",
};

type SearchParams = Promise<{
  callbackUrl?: string | string[];
  error?: string | string[];
}>;

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getErrorMessage(error: string | undefined) {
  if (error === "CredentialsSignin") {
    return "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
  }
  if (error) {
    return "ไม่สามารถเข้าสู่ระบบได้ กรุณาลองอีกครั้ง";
  }
  return null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  const params = await searchParams;
  const callbackUrl = normalizeCallbackUrl(readParam(params.callbackUrl));
  const error = readParam(params.error);

  if (isAdminSession(session)) {
    redirect(callbackUrl);
  }

  async function authenticate(formData: FormData) {
    "use server";

    const username = String(formData.get("username") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const redirectTo = normalizeCallbackUrl(
      String(formData.get("callbackUrl") ?? callbackUrl),
    );

    try {
      await signIn("credentials", {
        username,
        password,
        redirectTo,
      });
    } catch (error) {
      if (error instanceof AuthError) {
        const next = new URLSearchParams({
          callbackUrl: redirectTo,
          error: error.type,
        });
        redirect(`/login?${next.toString()}`);
      }
      throw error;
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_38%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.12),_transparent_30%)]" />
      <section className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(17,28,51,0.96),rgba(11,20,38,0.98))] shadow-[0_30px_90px_rgba(2,6,23,0.5)]">
        <div className="border-b border-[var(--border)] bg-[linear-gradient(135deg,rgba(56,189,248,0.14),rgba(14,165,233,0.03))] px-6 py-6">
          <div className="inline-flex rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1 text-[12px] font-semibold tracking-[0.2em] text-sky-200 uppercase">
            Admin Access
          </div>
          <h1 className="mt-4 text-2xl font-bold text-[var(--text)]">
            เข้าสู่ระบบสำหรับผู้ดูแล
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            ใช้บัญชีผู้ดูแลเพื่อเข้าหน้าจัดการ conversation และเครื่องมือดูแลระบบแชท
          </p>
        </div>

        <form action={authenticate} className="space-y-5 px-6 py-6">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-[var(--text)]">
              Username
            </span>
            <input
              name="username"
              type="text"
              autoComplete="username"
              required
              className="w-full rounded-2xl border border-[var(--border)] bg-[var(--inset)] px-4 py-3 text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-sky-400/20"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-[var(--text)]">
              Password
            </span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-2xl border border-[var(--border)] bg-[var(--inset)] px-4 py-3 text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-sky-400/20"
            />
          </label>

          {getErrorMessage(error) && (
            <div className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {getErrorMessage(error)}
            </div>
          )}

          <button
            type="submit"
            className="w-full rounded-2xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] px-4 py-3 text-sm font-bold text-[#032538] transition-transform hover:scale-[1.01] active:scale-[0.99]"
          >
            เข้าสู่ระบบ
          </button>

        </form>
      </section>
    </main>
  );
}
