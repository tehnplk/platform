"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { RealtimeClient } from "@supabase/realtime-js";
import { ChatRoom } from "@/components/ChatRoom";
import { REALTIME_ANON_KEY, REALTIME_URL } from "@/lib/realtime-config";

function useTitle(value: string) {
  useEffect(() => {
    document.title = value;
    const obs = new MutationObserver(() => {
      if (document.title !== value) document.title = value;
    });
    obs.observe(document.head, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [value]);
}

type Conversation = {
  hoscode: string;
  display_name: string | null;
  last_message_at: string | null;
  admin_unread: number;
  last_body: string | null;
  last_role: "user" | "admin" | null;
};

type AdminMessagePayload = {
  payload?: {
    id?: string;
    hoscode?: string;
    role?: "user" | "admin";
  };
};

function supportsBrowserNotification() {
  return typeof window !== "undefined" && "Notification" in window;
}

function browserCanNotify() {
  if (typeof document === "undefined") return false;
  return document.visibilityState !== "visible" || !document.hasFocus();
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const previousListRef = useRef<Conversation[] | null>(null);
  const selectedRef = useRef<string | null>(selected);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    let cancelled = false;
    try {
      const v = localStorage.getItem("chat:sidebarOpen");
      if (v === "0") {
        window.requestAnimationFrame(() => {
          if (!cancelled) setSidebarOpen(false);
        });
      }
    } catch {}
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("chat:sidebarOpen", sidebarOpen ? "1" : "0");
    } catch {}
  }, [sidebarOpen]);

  const registerAdminPush = useCallback(async () => {
    if (!supportsBrowserNotification()) return;
    if (Notification.permission !== "granted") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    try {
      const keyRes = await fetch("/api/chat/push-subscriptions", {
        cache: "no-store",
      });
      if (!keyRes.ok) return;
      const { publicKey } = (await keyRes.json()) as { publicKey?: string };
      if (!publicKey) return;

      await navigator.serviceWorker.register("/service-worker.js");
      const readyRegistration = await navigator.serviceWorker.ready;
      const existingSubscription =
        await readyRegistration.pushManager.getSubscription();
      const subscription =
        existingSubscription ??
        (await readyRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      await fetch("/api/chat/push-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      });
    } catch (err) {
      console.warn("register admin push failed", err);
    }
  }, []);

  useEffect(() => {
    void registerAdminPush();
  }, [registerAdminPush]);

  useEffect(() => {
    if (!supportsBrowserNotification()) return;
    if (Notification.permission !== "default") return;

    let cancelled = false;
    const requestPermission = async () => {
      if (cancelled || Notification.permission !== "default") return;
      const permission = await Notification.requestPermission().catch(() => null);
      if (!cancelled && permission === "granted") {
        await registerAdminPush();
      }
    };
    const events: Array<keyof WindowEventMap> = ["click", "keydown", "pointerdown"];
    const opts: AddEventListenerOptions = { passive: true };
    events.forEach((eventName) => {
      window.addEventListener(eventName, requestPermission, opts);
    });
    return () => {
      cancelled = true;
      events.forEach((eventName) => {
        window.removeEventListener(eventName, requestPermission);
      });
    };
  }, [registerAdminPush]);

  const notifyNewUnreadMessages = useCallback(
    (nextList: Conversation[]) => {
      if (!supportsBrowserNotification()) return;
      if (Notification.permission !== "granted") return;
      if (!browserCanNotify()) return;

      const previousList = previousListRef.current;
      if (!previousList) return;

      const previousMap = new Map(previousList.map((item) => [item.hoscode, item]));
      for (const item of nextList) {
        const prev = previousMap.get(item.hoscode);
        const previousUnread = prev?.admin_unread ?? 0;
        const unreadIncreased = item.admin_unread > previousUnread;
        const fromUser = item.last_role === "user";
        const activeThread = selectedRef.current === item.hoscode;
        if (!unreadIncreased || !fromUser || activeThread) continue;

        const notification = new Notification(
          item.display_name ?? `หน่วยบริการ ${item.hoscode}`,
          {
            body: item.last_body?.trim() || "มีข้อความใหม่เข้ามา",
            tag: `chat-admin-${item.hoscode}`,
            icon: "/favicon.ico",
          },
        );
        notification.onclick = () => {
          window.focus();
          router.replace(`/chat/admin?hoscode=${encodeURIComponent(item.hoscode)}`);
          notification.close();
        };
        window.setTimeout(() => notification.close(), 10000);
      }
    },
    [router],
  );


  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/chat/conversations", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { conversations: Conversation[] };
      const sel = params.get("hoscode")?.trim() || null;
      const nextList = sel
        ? j.conversations.map((c) =>
            c.hoscode === sel ? { ...c, admin_unread: 0 } : c,
          )
        : j.conversations;
      notifyNewUnreadMessages(nextList);
      previousListRef.current = nextList;
      setList(nextList);
      if (sel && j.conversations.some((c) => c.hoscode === sel && c.admin_unread > 0)) {
        void fetch(
          `/api/chat/conversations/${encodeURIComponent(sel)}/read?role=admin`,
          { method: "POST" },
        );
      }
    } finally {
      setLoading(false);
    }
  }, [notifyNewUnreadMessages, params]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const client = new RealtimeClient(REALTIME_URL, {
      params: { apikey: REALTIME_ANON_KEY },
    });
    client.connect();

    const channel = client.channel("chat:admin", {
      config: { broadcast: { self: false, ack: false } },
    });

    channel
      .on(
        "broadcast",
        { event: "new-message" },
        (payload?: AdminMessagePayload) => {
          const message = payload?.payload;
          if (!message?.id || !message.hoscode || message.role !== "user") {
            return;
          }
          void load();
        },
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
      client.disconnect();
    };
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    window.requestAnimationFrame(() => {
      if (cancelled) return;
      setList((prev) => {
        const exists = prev.some((c) => c.hoscode === selected);
        if (!exists) {
          return [
            {
              hoscode: selected,
              display_name: null,
              last_message_at: null,
              admin_unread: 0,
              last_body: null,
              last_role: null,
            },
            ...prev,
          ];
        }
        return prev.map((c) =>
          c.hoscode === selected ? { ...c, admin_unread: 0 } : c,
        );
      });
    });
    void (async () => {
      await fetch(
        `/api/chat/conversations/${encodeURIComponent(selected)}/unhide`,
        { method: "POST" },
      );
      if (!cancelled) {
        await load();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, selected]);

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

  useTitle(selected ?? "Admin Chat Console");

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-6">
      <section className="flex h-[min(880px,90vh)] w-full max-w-[1200px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
        <aside
          className={`flex shrink-0 flex-col border-r border-[var(--border)] bg-[var(--inset)]/40 transition-[width] duration-200 ${
            sidebarOpen ? "w-[300px]" : "w-[64px]"
          }`}
        >
          <header
            className={`border-b border-[var(--border)] ${
              sidebarOpen ? "px-5 py-4" : "px-2 py-3 text-center"
            }`}
          >
            {sidebarOpen ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[15px] font-semibold">หน่วยบริการ</div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-[var(--muted)]">
                      {loading ? "กำลังโหลด…" : `${list.length} ห้อง`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSidebarOpen(false)}
                      title="ย่อรายการห้อง"
                      aria-label="ย่อรายการห้อง"
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--inset)] hover:text-[var(--text)]"
                    >
                      ‹
                    </button>
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
              </>
            ) : (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                title="ขยายรายการห้อง"
                aria-label="ขยายรายการห้อง"
                className="mx-auto flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--inset)] hover:text-[var(--text)]"
              >
                ›
              </button>
            )}
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
              if (!sidebarOpen) {
                return (
                  <button
                    key={c.hoscode}
                    onClick={() => selectHoscode(c.hoscode)}
                    title={`${c.display_name ?? c.hoscode}${c.admin_unread > 0 ? ` (ใหม่ ${c.admin_unread})` : ""}`}
                    className={`relative flex w-full items-center justify-center border-b border-[var(--border)]/60 py-3 transition-colors hover:bg-[var(--inset)] ${
                      active ? "bg-[var(--inset)]" : ""
                    }`}
                  >
                    <div className="relative">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] font-bold text-[#00212f]">
                        {c.hoscode.slice(-2)}
                      </div>
                      {c.admin_unread > 0 && (
                        <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[11px] font-bold text-[#00212f] ring-2 ring-[var(--inset)]">
                          {c.admin_unread}
                        </span>
                      )}
                    </div>
                  </button>
                );
              }
              return (
                <div
                  key={c.hoscode}
                  className={`group relative flex w-full items-start gap-3 border-b border-[var(--border)]/60 transition-colors hover:bg-[var(--inset)] ${
                    active ? "bg-[var(--inset)]" : ""
                  }`}
                >
                  <button
                    onClick={() => selectHoscode(c.hoscode)}
                    className="flex min-w-0 flex-1 items-start gap-3 px-5 py-3 text-left"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] font-bold text-[#00212f]">
                      {c.hoscode.slice(-2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="block min-w-0 flex-1 truncate text-[14px] font-semibold">
                          {c.display_name ?? c.hoscode}
                        </span>
                        <span className="shrink-0 text-[11px] text-[var(--muted)]">
                          {formatTime(c.last_message_at)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="block max-w-[180px] min-w-0 flex-1 truncate text-[12px] text-[var(--muted)]">
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
          <div
            className={`border-t border-[var(--border)] ${
              sidebarOpen ? "p-4" : "p-2"
            }`}
          >
            <Link
              href="/chat/admin/manage"
              title="Manage conversations"
              aria-label="Manage conversations"
              className={`flex items-center rounded-xl border border-[var(--border)] bg-[var(--panel)] text-[13px] font-semibold text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] ${
                sidebarOpen
                  ? "justify-center px-3 py-2.5"
                  : "mx-auto h-10 w-10 justify-center"
              }`}
            >
              {sidebarOpen ? "Manage" : "M"}
            </Link>
          </div>
        </aside>

        <div className="relative flex flex-1 flex-col">
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
