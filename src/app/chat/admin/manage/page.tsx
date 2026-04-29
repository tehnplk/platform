"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";

type ManagedConversation = {
  hoscode: string;
  last_chat_date_time: string | null;
  count_message: number;
};

type SortKey = keyof ManagedConversation | "action";
type SortDirection = "asc" | "desc";

function formatDateTime(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("th-TH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, "th-TH", { numeric: true, sensitivity: "base" });
}

function sortConversations(
  rows: ManagedConversation[],
  key: SortKey,
  direction: SortDirection,
) {
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let result = 0;

    if (key === "last_chat_date_time") {
      const at = a.last_chat_date_time
        ? new Date(a.last_chat_date_time).getTime()
        : 0;
      const bt = b.last_chat_date_time
        ? new Date(b.last_chat_date_time).getTime()
        : 0;
      result = at - bt;
    } else if (key === "count_message") {
      result = a.count_message - b.count_message;
    } else {
      result = compareText(a.hoscode, b.hoscode);
    }

    return result === 0 ? compareText(a.hoscode, b.hoscode) : result * factor;
  });
}

export default function AdminManagePage() {
  const [items, setItems] = useState<ManagedConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingHoscode, setDeletingHoscode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoscodeFilter, setHoscodeFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("last_chat_date_time");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch("/api/chat/conversations/manage", {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { conversations: ManagedConversation[] };
      setItems(j.conversations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.requestAnimationFrame(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const filteredItems = items.filter((item) =>
    item.hoscode.toLowerCase().includes(hoscodeFilter.trim().toLowerCase()),
  );
  const visibleItems = sortConversations(filteredItems, sortKey, sortDirection);

  function changeSort(key: SortKey) {
    if (key === sortKey) {
      setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "last_chat_date_time" ? "desc" : "asc");
  }

  function sortLabel(key: SortKey) {
    if (sortKey !== key) return "↕";
    return sortDirection === "asc" ? "↑" : "↓";
  }

  async function deleteConversation(hoscode: string) {
    const result = await Swal.fire({
      title: "ยืนยันการลบ",
      text: `ลบ conversation history ของ hoscode ${hoscode} ทั้งหมดใช่ไหม?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "ลบ",
      cancelButtonText: "ยกเลิก",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#475569",
      background: "#111c33",
      color: "#e2e8f0",
    });

    if (!result.isConfirmed) return;

    setDeletingHoscode(hoscode);
    setError(null);
    try {
      const r = await fetch(
        `/api/chat/conversations/${encodeURIComponent(hoscode)}`,
        { method: "DELETE" },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setItems((prev) => prev.filter((item) => item.hoscode !== hoscode));
      await Swal.fire({
        title: "ลบแล้ว",
        text: `ลบ conversation history ของ ${hoscode} เรียบร้อยแล้ว`,
        icon: "success",
        confirmButtonText: "ตกลง",
        confirmButtonColor: "#0ea5e9",
        background: "#111c33",
        color: "#e2e8f0",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "delete failed";
      setError(message);
      await Swal.fire({
        title: "ลบไม่สำเร็จ",
        text: message,
        icon: "error",
        confirmButtonText: "ตกลง",
        confirmButtonColor: "#0ea5e9",
        background: "#111c33",
        color: "#e2e8f0",
      });
    } finally {
      setDeletingHoscode(null);
    }
  }

  return (
    <main className="min-h-screen px-4 py-6">
      <section className="mx-auto flex w-full max-w-[1120px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--inset)]/50 px-6 py-4">
          <div>
            <h1 className="text-[20px] font-bold">จัดการ Conversation</h1>
            <p className="mt-1 text-[13px] text-[var(--muted)]">
              รายการ conversation ทั้งหมดในระบบแชท
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void load();
              }}
              className="rounded-lg border border-[var(--border)] bg-[var(--inset)] px-3 py-2 text-[13px] font-semibold text-[var(--text)] transition-colors hover:border-[var(--accent)]"
            >
              รีเฟรช
            </button>
            <Link
              href="/chat/admin"
              className="rounded-lg bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] px-3 py-2 text-[13px] font-bold text-[#00212f]"
            >
              กลับหน้าแชท
            </Link>
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-6 py-4">
          <label className="flex min-w-[260px] flex-1 flex-col gap-1 text-[12px] font-semibold text-[var(--muted)]">
            กรอง hoscode
            <input
              type="text"
              value={hoscodeFilter}
              onChange={(e) => setHoscodeFilter(e.target.value)}
              placeholder="พิมพ์ hoscode..."
              className="rounded-lg border border-[var(--border)] bg-[var(--inset)] px-3 py-2 text-[14px] font-normal text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/40"
            />
          </label>
          <div className="text-[13px] text-[var(--muted)]">
            แสดง {visibleItems.length.toLocaleString("th-TH")} /{" "}
            {items.length.toLocaleString("th-TH")} รายการ
          </div>
        </div>

        {error && (
          <div className="border-b border-red-500/30 bg-red-500/10 px-6 py-3 text-[13px] text-red-200">
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead className="bg-[var(--inset)]/70 text-[12px] text-[var(--muted)]">
              <tr>
                <th className="px-6 py-3 font-semibold">
                  <button
                    type="button"
                    onClick={() => changeSort("last_chat_date_time")}
                    className="inline-flex items-center gap-2 transition-colors hover:text-[var(--text)]"
                  >
                    last_chat_date_time <span>{sortLabel("last_chat_date_time")}</span>
                  </button>
                </th>
                <th className="px-6 py-3 font-semibold">
                  <button
                    type="button"
                    onClick={() => changeSort("hoscode")}
                    className="inline-flex items-center gap-2 transition-colors hover:text-[var(--text)]"
                  >
                    hoscode <span>{sortLabel("hoscode")}</span>
                  </button>
                </th>
                <th className="px-6 py-3 text-right font-semibold">
                  <button
                    type="button"
                    onClick={() => changeSort("count_message")}
                    className="inline-flex items-center gap-2 transition-colors hover:text-[var(--text)]"
                  >
                    count_message <span>{sortLabel("count_message")}</span>
                  </button>
                </th>
                <th className="px-6 py-3 text-right font-semibold">
                  <button
                    type="button"
                    onClick={() => changeSort("action")}
                    className="inline-flex items-center gap-2 transition-colors hover:text-[var(--text)]"
                  >
                    action <span>{sortLabel("action")}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-10 text-center text-[14px] text-[var(--muted)]"
                  >
                    กำลังโหลด...
                  </td>
                </tr>
              ) : visibleItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-10 text-center text-[14px] text-[var(--muted)]"
                  >
                    ไม่พบ conversation
                  </td>
                </tr>
              ) : (
                visibleItems.map((item) => {
                  const deleting = deletingHoscode === item.hoscode;
                  return (
                    <tr
                      key={item.hoscode}
                      className="border-t border-[var(--border)]/70 transition-colors hover:bg-[var(--inset)]/45"
                    >
                      <td className="px-6 py-4 text-[14px]">
                        {formatDateTime(item.last_chat_date_time)}
                      </td>
                      <td className="px-6 py-4 font-mono text-[14px]">
                        {item.hoscode}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-[14px]">
                        {item.count_message.toLocaleString("th-TH")}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          disabled={deleting}
                          onClick={() => void deleteConversation(item.hoscode)}
                          className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-[13px] font-semibold text-red-200 transition-colors hover:bg-red-500/20 disabled:cursor-wait disabled:opacity-50"
                        >
                          {deleting ? "กำลังลบ..." : "ลบ"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
