"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
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
  unit_name: string | null;
  last_message_at: string | null;
  admin_unread: number;
  last_body: string | null;
  last_role: "user" | "admin" | null;
};

type UnitSuggestion = {
  hoscode: string;
  name: string;
};

type AdminMessagePayload = {
  payload?: {
    id?: string;
    hoscode?: string;
    role?: "user" | "admin";
  };
};

type TeamUserProfile = {
  name?: string | null;
  fullname?: string | null;
  department?: string | null;
  role?: string | null;
};

const LOCAL_HIDDEN_CONVERSATIONS_KEY = "chat:hiddenConversations";

type LocalHiddenConversations = Record<string, string>;

function readLocalHiddenConversations(): LocalHiddenConversations {
  try {
    const raw = localStorage.getItem(LOCAL_HIDDEN_CONVERSATIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function writeLocalHiddenConversations(hidden: LocalHiddenConversations) {
  try {
    localStorage.setItem(LOCAL_HIDDEN_CONVERSATIONS_KEY, JSON.stringify(hidden));
  } catch {}
}

function removeLocalHiddenConversation(hoscode: string) {
  const hidden = readLocalHiddenConversations();
  if (!(hoscode in hidden)) return;
  delete hidden[hoscode];
  writeLocalHiddenConversations(hidden);
}

function hideConversationLocally(hoscode: string) {
  writeLocalHiddenConversations({
    ...readLocalHiddenConversations(),
    [hoscode]: new Date().toISOString(),
  });
}

function isConversationLocallyHidden(
  conversation: Conversation,
  hidden: LocalHiddenConversations,
) {
  const hiddenAt = hidden[conversation.hoscode];
  if (!hiddenAt) return false;
  if (!conversation.last_message_at) return true;

  const hiddenTime = Date.parse(hiddenAt);
  const lastMessageTime = Date.parse(conversation.last_message_at);
  if (Number.isNaN(hiddenTime) || Number.isNaN(lastMessageTime)) return true;

  return lastMessageTime <= hiddenTime;
}

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
  const [userProfile, setUserProfile] = useState<TeamUserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<UnitSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const previousListRef = useRef<Conversation[] | null>(null);
  const selectedRef = useRef<string | null>(selected);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    let cancelled = false;
    try {
      const v = sessionStorage.getItem("chat:sidebarOpen");
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
      sessionStorage.setItem("chat:sidebarOpen", sidebarOpen ? "1" : "0");
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
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ user?: TeamUserProfile }>;
      })
      .then((session) => {
        if (!cancelled) setUserProfile(session.user ?? null);
      })
      .catch(() => {
        if (!cancelled) setUserProfile(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
          router.replace(`/chat/team?hoscode=${encodeURIComponent(item.hoscode)}`);
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
      const hidden = readLocalHiddenConversations();
      const visibleConversations = j.conversations.filter(
        (conversation) => !isConversationLocallyHidden(conversation, hidden),
      );
      notifyNewUnreadMessages(visibleConversations);
      previousListRef.current = visibleConversations;
      setList(visibleConversations);
    } catch (err) {
      console.warn("load conversations failed", err);
    } finally {
      setLoading(false);
    }
  }, [notifyNewUnreadMessages]);

  const handleConversationRead = useCallback(
    (readRole: "user" | "admin") => {
      if (readRole !== "admin" || !selectedRef.current) return;
      const currentSelected = selectedRef.current;
      setList((prev) =>
        prev.map((c) => {
          if (c.hoscode !== currentSelected || c.admin_unread === 0) return c;
          return { ...c, admin_unread: 0 };
        }),
      );
    },
    [],
  );

  useEffect(() => {
    let timer: number | null = null;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      timer = window.setTimeout(() => {
        if (cancelled) return;
        if (document.visibilityState === "visible") {
          void load();
        }
        schedule();
      }, 5000);
    };

    window.requestAnimationFrame(() => {
      if (!cancelled) void load();
    });
    schedule();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void load();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [load]);

  useEffect(() => {
    const cleanQuery = query.trim();
    if (cleanQuery.length < 3 || !sidebarOpen) {
      window.requestAnimationFrame(() => {
        setSuggestions([]);
        setSuggestionsLoading(false);
      });
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSuggestionsLoading(true);
      fetch(`/api/chat/units?q=${encodeURIComponent(cleanQuery)}`, {
        cache: "no-store",
      })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<{ units: UnitSuggestion[] }>;
        })
        .then((j) => {
          if (!cancelled) setSuggestions(j.units);
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setSuggestionsLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, sidebarOpen]);

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
              unit_name: null,
              last_message_at: null,
              admin_unread: 0,
              last_body: null,
              last_role: null,
            },
            ...prev,
          ];
        }
        return prev;
      });
    });
    removeLocalHiddenConversation(selected);
    window.requestAnimationFrame(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load, selected]);

  function selectHoscode(h: string) {
    router.replace(`/chat/team?hoscode=${encodeURIComponent(h)}`);
  }

  async function openSearch() {
    const h = query.trim();
    if (!h) return;
    setQuery("");
    setSuggestions([]);
    setSuggestionsOpen(false);
    removeLocalHiddenConversation(h);
    router.replace(`/chat/team?hoscode=${encodeURIComponent(h)}`);
    void load();
  }

  function openSuggestion(unit: UnitSuggestion) {
    setQuery("");
    setSuggestions([]);
    setSuggestionsOpen(false);
    removeLocalHiddenConversation(unit.hoscode);
    router.replace(`/chat/team?hoscode=${encodeURIComponent(unit.hoscode)}`);
    void load();
  }

  function hideHoscode(h: string) {
    hideConversationLocally(h);
    setList((prev) => prev.filter((c) => c.hoscode !== h));
    if (selected === h) {
      router.replace("/chat/team");
    }
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
                  className="relative mt-3 flex gap-2"
                >
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setSuggestionsOpen(true);
                    }}
                    onFocus={() => setSuggestionsOpen(true)}
                    onBlur={() => {
                      window.setTimeout(() => setSuggestionsOpen(false), 120);
                    }}
                    placeholder="ค้นรหัสหน่วยงาน…"
                    className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[13px] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/40"
                  />
                    <button
                    type="submit"
                    disabled={!query.trim()}
                    className="rounded-lg bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] px-3 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="เปิดห้อง"
                  >
                    เปิด
                  </button>
                  {suggestionsOpen && query.trim().length >= 3 && (
                    <div
                      role="listbox"
                      className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] py-1 shadow-[0_16px_36px_rgba(0,0,0,0.35)]"
                    >
                      {suggestionsLoading && (
                        <div className="px-3 py-2 text-[12px] text-[var(--muted)]">
                          กำลังค้นหา...
                        </div>
                      )}
                      {!suggestionsLoading && suggestions.length === 0 && (
                        <div className="px-3 py-2 text-[12px] text-[var(--muted)]">
                          ไม่พบหน่วยบริการ
                        </div>
                      )}
                      {!suggestionsLoading &&
                        suggestions.map((unit) => (
                          <button
                            key={unit.hoscode}
                            type="button"
                            role="option"
                            aria-selected="false"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => openSuggestion(unit)}
                            className="flex w-full flex-col px-3 py-2 text-left transition-colors hover:bg-[var(--inset)] focus:bg-[var(--inset)] focus:outline-none"
                          >
                            <span className="truncate text-[12px] text-[var(--muted)]">
                              {unit.name}
                            </span>
                            <span className="truncate text-[13px] font-semibold text-[var(--text)]">
                              {unit.hoscode}
                            </span>
                          </button>
                        ))}
                    </div>
                  )}
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
              const unitName = c.unit_name?.trim() || "ไม่มีชื่อ";
              const accessibleName = unitName ? `${unitName} ${c.hoscode}` : c.hoscode;
              const preview = c.last_body
                ? `${c.last_role === "admin" ? "คุณ: " : ""}${c.last_body}`
                : "—";
              if (!sidebarOpen) {
                return (
                  <button
                    key={c.hoscode}
                    onClick={() => selectHoscode(c.hoscode)}
                    aria-label={`${accessibleName}${c.admin_unread > 0 ? ` ใหม่ ${c.admin_unread}` : ""}`}
                    className={`relative flex w-full items-center justify-center border-b border-[var(--border)]/60 py-3 transition-colors hover:bg-[var(--inset)] ${
                      active ? "bg-[var(--inset)]" : ""
                    }`}
                  >
                    <div className="relative">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] px-1 text-center text-[10px] font-bold leading-none text-white">
                        <span className="block max-w-full truncate">
                          {c.hoscode}
                        </span>
                      </div>
                      {c.admin_unread > 0 && (
                        <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-200 px-1 text-[11px] font-bold text-emerald-950 ring-2 ring-[var(--inset)]">
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
                    aria-label={accessibleName}
                    className="flex min-w-0 flex-1 items-start gap-3 px-5 py-3 text-left"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] font-bold text-white">
                      <UserAvatarIcon />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                        <span className="block min-w-0 overflow-hidden">
                          <span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-medium leading-4 text-[var(--muted)]">
                            {unitName}
                          </span>
                          <span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[14px] font-semibold leading-5">
                            {c.hoscode}
                          </span>
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
                          <span className="ml-2 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-200 px-1.5 text-[11px] font-bold text-emerald-950">
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
            className={`shrink-0 border-t border-[var(--border)] ${
              sidebarOpen ? "p-4" : "p-2"
            }`}
          >
            <TeamProfileCard profile={userProfile} expanded={sidebarOpen} />
            <Link
              href="/chat/admin/manage/conversations"
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
              onConversationRead={handleConversationRead}
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

function TeamProfileCard({
  profile,
  expanded,
}: {
  profile: TeamUserProfile | null;
  expanded: boolean;
}) {
  const displayName =
    profile?.fullname?.trim() || profile?.name?.trim() || "Team user";
  const department = profile?.department?.trim() || "Chat team";
  const roleLabel = profile?.role === "admin" ? "Admin" : "Team";
  const initials = getInitials(displayName);
  const handleSignOut = async () => {
    await signOut({ redirect: false, redirectTo: "/login" });
    window.location.assign("/login");
  };

  if (!expanded) {
    return (
      <div className="mb-3 flex flex-col items-center gap-2">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--accent)] bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[12px] font-bold text-white shadow-sm"
          title={`${displayName} · ${roleLabel}`}
          aria-label={`${displayName} ${roleLabel}`}
        >
          {initials}
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          title="Sign out"
          aria-label="Sign out"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-300/35 bg-rose-500/10 text-rose-500 transition-colors hover:border-rose-400 hover:bg-rose-500/15"
        >
          <SignOutIcon />
        </button>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <div className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
        Profile
      </div>
      <div className="flex min-w-0 items-center gap-3 rounded-xl border border-[var(--accent)]/45 bg-[var(--inset)] px-3 py-3 shadow-sm">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[12px] font-bold text-white">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-[var(--text)]">
            {displayName}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2">
            <span className="truncate text-[11px] text-[var(--muted)]">
              {department}
            </span>
            <span className="shrink-0 rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[10px] font-bold text-[var(--accent)]">
              {roleLabel}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          title="Sign out"
          aria-label="Sign out"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rose-300/35 bg-rose-500/10 text-rose-500 transition-colors hover:border-rose-400 hover:bg-rose-500/15"
        >
          <SignOutIcon />
        </button>
      </div>
    </div>
  );
}

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1
      ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
      : value.slice(0, 2);

  return letters.toUpperCase() || "TU";
}

function UserAvatarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden
    >
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="8" r="4" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}
