import { readFile } from "node:fs/promises";
import path from "node:path";

type LatestInfo = {
  version: string;
  url: string;
  sha256: string;
  release_date: string;
  notes?: string;
};

export const dynamic = "force-dynamic";

async function getLatest(): Promise<LatestInfo | null> {
  try {
    const file = path.join(
      process.cwd(),
      "public",
      "plkplatform",
      "latest.json",
    );
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as LatestInfo;
  } catch {
    return null;
  }
}

export default async function Home() {
  const info = await getLatest();

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <section className="w-full max-w-[640px] rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-9 py-10 shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
        <h1 className="m-0 mb-2 text-[28px] font-bold tracking-[0.3px]">
          Plk Platform
        </h1>
        <p className="m-0 mb-7 text-[15px] text-[var(--muted)]">
          ระบบสนับสนุนงาน HIS
        </p>

        <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-[18px] gap-y-[10px] rounded-[10px] border border-[var(--border)] bg-[var(--inset)] px-5 py-[18px] text-[14px]">
          <dt className="text-[var(--muted)]">เวอร์ชัน</dt>
          <dd className="m-0 break-all">
            {info ? info.version : "โหลดข้อมูลไม่สำเร็จ"}
          </dd>

          <dt className="text-[var(--muted)]">วันที่เผยแพร่</dt>
          <dd className="m-0 break-all">{info?.release_date ?? "—"}</dd>

          <dt className="text-[var(--muted)]">SHA256</dt>
          <dd className="m-0 break-all">
            <code className="font-mono text-[12px] text-[#a5f3fc]">
              {info?.sha256 ?? "—"}
            </code>
          </dd>
        </dl>

        <a
          href={info?.url ?? "/plkplatform/PlkPlatform.exe"}
          download
          className="inline-flex items-center gap-[10px] rounded-[10px] bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] px-[22px] py-[14px] text-[16px] font-bold text-[#00212f] shadow-[0_8px_20px_rgba(14,165,233,0.35)] transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[0_10px_26px_rgba(14,165,233,0.5)] active:translate-y-0"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-[18px] w-[18px]"
            aria-hidden
          >
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
          ดาวน์โหลด PlkPlatform.exe
        </a>

        {info?.notes && (
          <div className="mt-6 rounded-lg border border-[var(--border)] border-l-[3px] border-l-[var(--accent)] bg-[var(--inset)] px-[18px] py-4 text-[14px] leading-[1.6] text-[var(--muted)]">
            {info.notes}
          </div>
        )}

        <div className="mt-7 text-center text-[12px] text-[var(--muted)]">
          © PlkHealth ·{" "}
          <a
            href="/plkplatform/latest.json"
            className="text-[var(--muted)] underline-offset-2 hover:underline"
          >
            latest.json
          </a>
        </div>
      </section>
    </main>
  );
}
