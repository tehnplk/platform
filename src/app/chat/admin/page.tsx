"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ChatRoom } from "@/components/ChatRoom";

type Conversation = {
  hoscode: string;
  display_name: string | null;
  last_message_at: string | null;
  admin_unread: number;
  last_body: string | null;
  last_role: "user" | "admin" | null;
};

export default function AdminChatPage() {
  return (
    <Suspense fallback={null}>
      <AdminChat />
    </Suspense>
  );
}

function formatTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  }
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function AdminChat() {
  const params = useSearchParams();
  const router = useRouter();
  const selected = params.get("hoscode")?.trim() || null;
  const [list, setList] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");


  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/chat/conversations", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { conversations: Conversation[] };
      const sel = params.get("hoscode")?.trim() || null;
      setList(
        sel
          ? j.conversations.map((c) =>
              c.hoscode === sel ? { ...c, admin_unread: 0 } : c,
            )
          : j.conversations,
      );
      if (sel && j.conversations.some((c) => c.hoscode === sel && c.admin_unread > 0)) {
        void fetch(
          `/api/chat/conversations/${encodeURIComponent(sel)}/read?role=admin`,
          { method: "POST" },
        );
      }
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    setList((prev) =>
      prev.map((c) =>
        c.hoscode === selected ? { ...c, admin_unread: 0 } : c,
      ),
    );
    void fetch(
      `/api/chat/conversations/${encodeURIComponent(selected)}/read?role=admin`,
      { method: "POST" },
    );
  }, [selected]);

  function selectHoscode(h: string) {
    router.replace(`/chat/admin?hoscode=${encodeURIComponent(h)}`);
  }

  async function openSearch() {
    const h = query.trim();
    if (!h) return;
    setQuery("");
    await fetch(
      `/api/chat/conversations/${encodeURIComponent(h)}/unhide`,
      { method: "POST" },
    );
    router.replace(`/chat/admin?hoscode=${encodeURIComponent(h)}`);
    void load();
  }

  async function hideHoscode(h: string) {
    setList((prev) => prev.filter((c) => c.hoscode !== h));
    if (selected === h) {
      router.replace("/chat/admin");
    }
    await fetch(
      `/api/chat/conversations/${encodeURIComponent(h)}/hide`,
      { method: "POST" },
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-6">
      <title>{selected ?? "Admin"}</title>
      <section className="flex h-[min(880px,90vh)] w-full max-w-[1200px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--inset)]/40">
          <header className="border-b border-[var(--border)] px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="text-[15px] font-semibold">หน่วยบริการ</div>
              <div className="text-[11px] text-[var(--muted)]">
                {loading ? "กำลังโหลด…" : `${list.length} ห้อง`}
              </div>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void openSearch();
              }}
              className="mt-3 flex gap-2"
            >
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ค้นรหัสหน่วยงาน…"
                className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[13px] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/40"
              />
              <button
                type="submit"
                disabled={!query.trim()}
                className="rounded-lg bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] px-3 text-[13px] font-bold text-[#00212f] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="เปิดห้อง"
              >
                เปิด
              </button>
            </form>
          </header>
          <div className="flex-1 overflow-y-auto [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
            {list.length === 0 && !loading && (
              <div className="px-5 py-6 text-[13px] text-[var(--muted)]">
                ยังไม่มีหน่วยบริการที่ส่งข้อความเข้ามา
              </div>
            )}
            {list.map((c) => {
              const active = c.hoscode === selected;
              const preview = c.last_body
                ? `${c.last_role === "admin" ? "คุณ: " : ""}${c.last_body}`
                : "—";
              return (
                <div
                  key={c.hoscode}
                  className={`group relative flex w-full items-start gap-3 border-b border-[var(--border)]/60 transition-colors hover:bg-[var(--inset)] ${
                    active ? "bg-[var(--inset)]" : ""
                  }`}
                >
                  <button
                    onClick={() => selectHoscode(c.hoscode)}
                    className="flex flex-1 items-start gap-3 px-5 py-3 text-left"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] font-bold text-[#00212f]">
                      {c.hoscode.slice(-2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[14px] font-semibold">
                          {c.display_name ?? c.hoscode}
                        </span>
                        <span className="shrink-0 text-[11px] text-[var(--muted)]">
                          {formatTime(c.last_message_at)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[12px] text-[var(--muted)]">
                          {preview}
                        </span>
                        {c.admin_unread > 0 && (
                          <span className="ml-2 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] px-1.5 text-[11px] font-bold text-[#00212f]">
                            {c.admin_unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void hideHoscode(c.hoscode);
                    }}
                    title="ซ่อนห้องนี้"
                    aria-label="ซ่อนห้องนี้"
                    className="absolute right-2 top-2 hidden h-6 w-6 items-center justify-center rounded-full bg-[var(--panel)] text-[var(--muted)] opacity-0 transition-opacity hover:text-red-400 group-hover:flex group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        <div className="flex flex-1 flex-col">
          {selected ? (
            <ChatRoom
              key={selected}
              hoscode={selected}
              role="admin"
              embedded
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-[14px] text-[var(--muted)]">
              เลือกหน่วยบริการจากรายการด้านซ้ายเพื่อเริ่มสนทนา
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
