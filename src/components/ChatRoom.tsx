"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
} from "react";
import { RealtimeClient } from "@supabase/realtime-js";
import {
  REALTIME_ANON_KEY,
  REALTIME_URL,
} from "@/lib/realtime-config";

export type ChatRole = "user" | "admin";

type PyQtBridge = {
  notify?: (title: string, message: string) => void;
};

type QWebChannelConstructor = new (
  transport: unknown,
  callback: (channel: { objects?: { pyqtBridge?: PyQtBridge } }) => void,
) => void;

declare global {
  interface Window {
    qt?: { webChannelTransport?: unknown };
    QWebChannel?: QWebChannelConstructor;
    pyqtBridge?: PyQtBridge;
    __chatQtBridgeLoading?: boolean;
  }
}

type Attachment = {
  id: string; // server id once persisted; for previews this is a local uuid
  kind: "image" | "video" | "doc";
  filename: string;
  mime_type?: string;
  size_bytes?: number;
  // For pending uploads (not yet persisted)
  localUrl?: string;
  file?: File;
};

type Message = {
  id: string;
  role: ChatRole;
  body: string;
  created_at: string; // ISO
  read_at: string | null;
  cancelled_at: string | null;
  client_id?: string | null;
  attachments: Attachment[];
};

type UnitInfo = {
  hoscode: string;
  displayName: string;
  district?: string | null;
  province?: string | null;
};

type ServerMessage = {
  id: string;
  hoscode: string;
  role: ChatRole;
  body: string;
  client_id: string | null;
  created_at: string;
  read_at: string | null;
  cancelled_at: string | null;
  attachments: Array<{
    id: string;
    kind: "image" | "video" | "doc";
    filename: string;
    mime_type: string;
    size_bytes: number;
    duration_ms: number | null;
  }>;
};

const MAX_IMAGES = 1;
const MAX_DOCS = 1;
const MAX_DOC_BYTES = 5 * 1024 * 1024;
const CANCELLED_MESSAGE_BODY = "ยกเลิกข้อความ";
const DOC_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv";
const EMOJI_OPTIONS = [
  "😀",
  "😄",
  "😊",
  "🙏",
  "👍",
  "❤️",
  "🎉",
  "✅",
  "😂",
  "🥰",
  "👌",
  "🙇",
  "😮",
  "😢",
  "🔥",
  "💬",
];

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function docKindLabel(mime: string | undefined, filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (mime === "application/pdf" || ext === "pdf") return "PDF";
  if (
    mime?.includes("wordprocessingml") ||
    mime === "application/msword" ||
    ext === "doc" ||
    ext === "docx"
  )
    return "Word";
  if (
    mime?.includes("spreadsheetml") ||
    mime === "application/vnd.ms-excel" ||
    ext === "xls" ||
    ext === "xlsx"
  )
    return "Excel";
  if (mime === "text/csv" || ext === "csv") return "CSV";
  return "TXT";
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dateKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatDateSeparator(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  ) {
    return "วันนี้";
  }
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear() + 543;
  return `${dd}/${mm}/${yyyy}`;
}

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Notification chime — preloaded MP3 served from /public/sounds/notify.mp3.
// Using a plain <audio> element instead of Web Audio API simplifies the
// autoplay-policy story: a single user interaction unlocks future
// .play() calls, no context resume gymnastics needed.
let _audio: HTMLAudioElement | null = null;
function ensureAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (_audio) return _audio;
  _audio = new Audio("/sounds/notify.mp3");
  _audio.preload = "auto";
  _audio.volume = 0.7;
  return _audio;
}

function playKnock() {
  const a = ensureAudio();
  if (!a) return Promise.resolve(false);
  try {
    a.muted = false;
    a.currentTime = 0;
    return a.play().then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

function unlockAudio({ audible }: { audible: boolean }) {
  const a = ensureAudio();
  if (!a) return Promise.resolve();
  const prevMuted = a.muted;
  a.muted = !audible;
  a.currentTime = 0;
  return a
    .play()
    .then(() => {
      if (!audible) {
        a.pause();
        a.currentTime = 0;
        a.muted = prevMuted;
      }
    })
    .catch((err) => {
      a.muted = prevMuted;
      throw err;
    });
}

function attachmentSrc(att: Attachment) {
  return att.localUrl ?? `/api/chat/attachments/${att.id}`;
}

function toMessage(s: ServerMessage): Message {
  return {
    id: s.id,
    role: s.role,
    body: s.body,
    created_at: s.created_at,
    read_at: s.read_at,
    cancelled_at: s.cancelled_at,
    client_id: s.client_id,
    attachments: s.attachments.map((a) => ({
      id: a.id,
      kind: a.kind,
      filename: a.filename,
      mime_type: a.mime_type,
      size_bytes: a.size_bytes,
    })),
  };
}

export function ChatRoom({
  hoscode,
  role,
  embedded = false,
  onConversationRead,
}: {
  hoscode: string;
  role: ChatRole;
  embedded?: boolean;
  onConversationRead?: (role: ChatRole) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<Attachment[]>([]);
  const [docs, setDocs] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [typingFrom, setTypingFrom] = useState<ChatRole | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [selectedImage, setSelectedImage] = useState<Attachment | null>(null);
  const [unitInfoOpen, setUnitInfoOpen] = useState(false);
  const [unitInfo, setUnitInfo] = useState<UnitInfo | null>(null);
  const [unitInfoLoading, setUnitInfoLoading] = useState(false);
  const [unitInfoError, setUnitInfoError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Message | null>(null);
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const soundOnRef = useRef(true);
  const soundPreferenceLoadedRef = useRef(false);
  const pendingSoundRef = useRef(false);
  const pyqtBridgeRef = useRef<PyQtBridge | null>(null);

  useEffect(() => {
    let cancelled = false;
    try {
      const v = localStorage.getItem("chat:soundOn");
      const enabled = v !== "0";
      soundOnRef.current = enabled;
      window.requestAnimationFrame(() => {
        if (!cancelled) {
          soundPreferenceLoadedRef.current = true;
          setSoundOn(enabled);
        }
      });
    } catch {
      soundPreferenceLoadedRef.current = true;
      soundOnRef.current = true;
      window.requestAnimationFrame(() => {
        if (!cancelled) setSoundOn(true);
      });
    }
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!soundPreferenceLoadedRef.current) return;
    soundOnRef.current = soundOn;
    try {
      localStorage.setItem("chat:soundOn", soundOn ? "1" : "0");
    } catch {}
  }, [soundOn]);

  const triggerChatSound = useCallback(async () => {
    if (!soundOnRef.current) return;
    const played = await playKnock();
    if (!played) {
      pendingSoundRef.current = true;
    }
  }, []);

  const triggerPendingChatSound = useCallback(() => {
    if (!soundOnRef.current || !pendingSoundRef.current) return;
    pendingSoundRef.current = false;
    void unlockAudio({ audible: true }).catch(() => {});
  }, []);

  // Browsers block .play() until a user gesture. If sound is already enabled
  // from localStorage, the first interaction must play audibly to unlock later
  // notification sounds reliably across browsers.
  useEffect(() => {
    let unlocked = false;
    const unlock = () => {
      if (unlocked) return;
      unlockAudio({ audible: soundOnRef.current })
        .then(() => {
          unlocked = true;
          pendingSoundRef.current = false;
          detach();
        })
        .catch(() => {});
    };
    const events: Array<keyof DocumentEventMap> = [
      "pointerdown",
      "click",
      "keydown",
      "touchstart",
    ];
    const opts = { capture: true, passive: true } as const;
    const detach = () => {
      events.forEach((e) => document.removeEventListener(e, unlock, opts));
    };
    events.forEach((e) => document.addEventListener(e, unlock, opts));
    return detach;
  }, []);

  useEffect(() => {
    const trigger = () => triggerPendingChatSound();
    const events: Array<keyof DocumentEventMap> = [
      "pointerdown",
      "click",
      "keydown",
      "touchstart",
      "visibilitychange",
    ];
    const opts = { capture: true, passive: true } as const;
    events.forEach((eventName) => document.addEventListener(eventName, trigger, opts));
    window.addEventListener("focus", trigger);
    return () => {
      events.forEach((eventName) =>
        document.removeEventListener(eventName, trigger, opts),
      );
      window.removeEventListener("focus", trigger);
    };
  }, [triggerPendingChatSound]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.qt?.webChannelTransport) return;

    const connectBridge = () => {
      if (!window.QWebChannel || !window.qt?.webChannelTransport) return;
      new window.QWebChannel(window.qt.webChannelTransport, (channel) => {
        const bridge = channel.objects?.pyqtBridge ?? null;
        pyqtBridgeRef.current = bridge;
        window.pyqtBridge = bridge ?? undefined;
      });
    };

    if (window.QWebChannel) {
      connectBridge();
      return;
    }
    if (window.__chatQtBridgeLoading) return;

    window.__chatQtBridgeLoading = true;
    const script = document.createElement("script");
    script.src = "qrc:///qtwebchannel/qwebchannel.js";
    script.onload = connectBridge;
    script.onerror = () => {
      window.__chatQtBridgeLoading = false;
    };
    document.head.appendChild(script);
  }, []);

  const channelRef = useRef<ReturnType<RealtimeClient["channel"]> | null>(null);
  const typingClearRef = useRef<number | null>(null);
  const typingBroadcastSentAtRef = useRef(0);
  const typingStopTimerRef = useRef<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const canMarkConversationRead = useCallback(() => {
    if (typeof document === "undefined") return false;
    return document.visibilityState === "visible" && document.hasFocus();
  }, []);

  const markConversationRead = useCallback(async () => {
    if (!canMarkConversationRead()) return;
    try {
      const r = await fetch(
        `/api/chat/conversations/${encodeURIComponent(hoscode)}/read?role=${role}`,
        { method: "POST" },
      );
      if (!r.ok) return;
      const j = (await r.json()) as { read_at?: string };
      if (!j.read_at) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.role !== role && !m.read_at ? { ...m, read_at: j.read_at ?? null } : m,
        ),
      );
      onConversationRead?.(role);
    } catch (err) {
      console.error("mark conversation read failed", err);
    }
  }, [canMarkConversationRead, hoscode, onConversationRead, role]);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/chat/messages?hoscode=${encodeURIComponent(hoscode)}`,
          { cache: "no-store" },
        );
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { messages: ServerMessage[] };
        if (cancelled) return;
        setMessages(j.messages.map(toMessage));
        void markConversationRead();
      } catch (err) {
        console.error("load messages failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hoscode, markConversationRead]);

  // Realtime subscription
  useEffect(() => {
    const client = new RealtimeClient(REALTIME_URL, {
      params: { apikey: REALTIME_ANON_KEY },
    });
    client.connect();

    const channel = client.channel(`chat:${hoscode}`, {
      config: { broadcast: { self: false, ack: false } },
    });
    channelRef.current = channel;

    channel
      .on(
        "broadcast",
        { event: "new-message" },
        async (payload?: {
          payload?: {
            id?: string;
            client_id?: string | null;
            role?: ChatRole;
          };
        }) => {
          const id = payload?.payload?.id;
          const clientId = payload?.payload?.client_id ?? null;
          const senderRole = payload?.payload?.role;
          if (!id) return;
          // The sender just sent — they have stopped typing.
          if (senderRole && senderRole !== role) {
            setTypingFrom((cur) => (cur === senderRole ? null : cur));
            pyqtBridgeRef.current?.notify?.(
              senderRole === "admin" ? "Admin Team" : `หน่วยบริการ ${hoscode}`,
              "มีข้อความใหม่",
            );
            void triggerChatSound();
            void markConversationRead();
          }
          try {
            const r = await fetch(
              `/api/chat/messages?hoscode=${encodeURIComponent(hoscode)}&limit=500`,
              { cache: "no-store" },
            );
            if (!r.ok) return;
            const j = (await r.json()) as { messages: ServerMessage[] };
            const fresh = j.messages.find((m) => m.id === id);
            if (!fresh) return;
            setMessages((prev) => {
              if (prev.some((m) => m.id === id)) return prev;
              if (clientId) {
                const idx = prev.findIndex((m) => m.client_id === clientId);
                if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = toMessage(fresh);
                  return next;
                }
              }
              return [...prev, toMessage(fresh)];
            });
          } catch (err) {
            console.error("fetch new message failed", err);
          }
        },
      )
      .on(
        "broadcast",
        { event: "read-receipt" },
        (payload?: { payload?: { role?: ChatRole; read_at?: string } }) => {
          const readerRole = payload?.payload?.role;
          const readAt = payload?.payload?.read_at;
          if (!readerRole || readerRole === role || !readAt) return;
          setMessages((prev) =>
            prev.map((m) =>
              m.role !== readerRole && !m.read_at ? { ...m, read_at: readAt } : m,
            ),
          );
        },
      )
      .on(
        "broadcast",
        { event: "cancel-message" },
        (payload?: {
          payload?: {
            id?: string;
            body?: string;
            cancelled_at?: string;
          };
        }) => {
          const id = payload?.payload?.id;
          const cancelledAt = payload?.payload?.cancelled_at;
          if (!id || !cancelledAt) return;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id
                ? {
                    ...m,
                    body: payload?.payload?.body ?? CANCELLED_MESSAGE_BODY,
                    cancelled_at: cancelledAt,
                    attachments: [],
                  }
                : m,
            ),
          );
        },
      )
      .on(
        "broadcast",
        { event: "typing" },
        (payload?: { payload?: { role?: ChatRole; state?: "start" | "stop" } }) => {
          const senderRole = payload?.payload?.role;
          const state = payload?.payload?.state;
          if (!senderRole || senderRole === role) return;
          if (state === "start") {
            setTypingFrom(senderRole);
            if (typingClearRef.current) {
              window.clearTimeout(typingClearRef.current);
            }
            // Auto-clear if the sender goes silent (in case the stop event is lost)
            typingClearRef.current = window.setTimeout(() => {
              setTypingFrom((cur) => (cur === senderRole ? null : cur));
            }, 4000);
          } else if (state === "stop") {
            setTypingFrom((cur) => (cur === senderRole ? null : cur));
          }
        },
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    return () => {
      channelRef.current = null;
      channel.unsubscribe();
      client.disconnect();
    };
  }, [hoscode, markConversationRead, role, triggerChatSound]);

  useEffect(() => {
    const markVisibleUnread = () => {
      if (!canMarkConversationRead()) return;
      setMessages((current) => {
        if (current.some((m) => m.role !== role && !m.read_at)) {
          void markConversationRead();
        }
        return current;
      });
    };

    document.addEventListener("visibilitychange", markVisibleUnread);
    window.addEventListener("focus", markVisibleUnread);
    return () => {
      document.removeEventListener("visibilitychange", markVisibleUnread);
      window.removeEventListener("focus", markVisibleUnread);
    };
  }, [canMarkConversationRead, markConversationRead, role]);

  // Auto-scroll on new messages OR when the other side starts typing
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typingFrom]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    el.style.height = "44px";
    const nextHeight = Math.min(el.scrollHeight, 160);
    el.style.height = `${Math.max(44, nextHeight)}px`;
    el.style.overflowY = el.scrollHeight > 160 ? "auto" : "hidden";
  }, [draft]);

  // Keep the textarea focused: on mount, when new messages arrive, when the
  // window regains focus, and when the user clicks anywhere on the panel.
  useEffect(() => {
    inputRef.current?.focus();
  }, [messages.length]);

  useEffect(() => {
    function refocus() {
      // Don't steal focus if the user is interacting with another input/button
      const ae = document.activeElement;
      if (
        ae instanceof HTMLInputElement ||
        ae instanceof HTMLButtonElement ||
        ae instanceof HTMLAnchorElement ||
        (ae instanceof HTMLElement && ae.isContentEditable)
      ) {
        return;
      }
      inputRef.current?.focus();
    }
    window.addEventListener("focus", refocus);
    return () => window.removeEventListener("focus", refocus);
  }, []);

  useEffect(() => {
    if (!selectedImage) return;

    function closeOnEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedImage(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedImage]);

  useEffect(() => {
    if (!unitInfoOpen) return;

    function closeOnEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setUnitInfoOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [unitInfoOpen]);

  useEffect(() => {
    if (!unitInfoOpen || role !== "admin") return;

    let cancelled = false;
    window.requestAnimationFrame(() => {
      if (cancelled) return;
      setUnitInfoLoading(true);
      setUnitInfoError(null);
    });

    (async () => {
      try {
        const r = await fetch(
          `/api/chat/units/${encodeURIComponent(hoscode)}`,
          { cache: "no-store" },
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { unit: UnitInfo };
        if (!cancelled) setUnitInfo(j.unit);
      } catch (err) {
        if (!cancelled) {
          setUnitInfoError(err instanceof Error ? err.message : "load failed");
          setUnitInfo({
            hoscode,
            displayName: `หน่วยบริการ ${hoscode}`,
            district: null,
            province: null,
          });
        }
      } finally {
        if (!cancelled) setUnitInfoLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hoscode, role, unitInfoOpen]);

  function refocusOnPanelClick(e: React.MouseEvent<HTMLElement>) {
    const t = e.target as HTMLElement;
    if (t.closest("button, a, input, textarea, video, [contenteditable]")) {
      triggerPendingChatSound();
      return;
    }
    triggerPendingChatSound();
    inputRef.current?.focus();
  }

  function addImageFiles(files: File[]) {
    if (docs.length > 0) {
      setError("ส่งรูปและไฟล์ในข้อความเดียวกันไม่ได้");
      return false;
    }
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return false;

    setError(null);
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      setError(`แนบรูปได้สูงสุด ${MAX_IMAGES} รูป`);
      return true;
    }

    const accepted = imageFiles.slice(0, remaining).map<Attachment>((f) => ({
      id: genId(),
      kind: "image",
      filename: f.name || `clipboard-${Date.now()}.png`,
      mime_type: f.type,
      localUrl: URL.createObjectURL(f),
      file: f,
    }));
    setImages((prev) => [...prev, ...accepted]);

    if (imageFiles.length > remaining) {
      setError(`แนบรูปเพิ่มได้แค่ ${remaining} รูป (สูงสุด ${MAX_IMAGES})`);
    }
    return true;
  }

  function pickImages(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (!files.length) return;
    setError(null);
    if (docs.length > 0) {
      setError("ส่งรูปและไฟล์ในข้อความเดียวกันไม่ได้");
      return;
    }
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      setError(`แนบรูปได้สูงสุด ${MAX_IMAGES} รูป`);
      return;
    }
    const accepted = files.slice(0, remaining).map<Attachment>((f) => ({
      id: genId(),
      kind: "image",
      filename: f.name,
      mime_type: f.type,
      localUrl: URL.createObjectURL(f),
      file: f,
    }));
    setImages((prev) => [...prev, ...accepted]);
    if (files.length > remaining) {
      setError(`แนบรูปเพิ่มได้แค่ ${remaining} รูป (สูงสุด ${MAX_IMAGES})`);
    }
  }

  function pickDocs(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (!files.length) return;
    setError(null);
    if (images.length > 0) {
      setError("ส่งรูปและไฟล์ในข้อความเดียวกันไม่ได้");
      return;
    }
    const remaining = MAX_DOCS - docs.length;
    if (remaining <= 0) {
      setError(`แนบไฟล์เอกสารได้สูงสุด ${MAX_DOCS} ไฟล์`);
      return;
    }
    const accepted: Attachment[] = [];
    const rejected: string[] = [];
    for (const f of files.slice(0, remaining)) {
      if (f.size > MAX_DOC_BYTES) {
        rejected.push(`${f.name} (${formatBytes(f.size)})`);
        continue;
      }
      accepted.push({
        id: genId(),
        kind: "doc",
        filename: f.name,
        mime_type: f.type,
        size_bytes: f.size,
        file: f,
      });
    }
    if (accepted.length) setDocs((prev) => [...prev, ...accepted]);
    if (rejected.length) {
      setError(`ไฟล์เกิน 5MB: ${rejected.join(", ")}`);
    } else if (files.length > remaining) {
      setError(`แนบไฟล์เอกสารเพิ่มได้แค่ ${remaining} ไฟล์`);
    }
  }

  function removeDoc(id: string) {
    setDocs((prev) => prev.filter((a) => a.id !== id));
  }

  function removeImage(id: string) {
    setImages((prev) => {
      const found = prev.find((a) => a.id === id);
      if (found?.localUrl) URL.revokeObjectURL(found.localUrl);
      return prev.filter((a) => a.id !== id);
    });
  }

  // Throttled "typing-start" + debounced "typing-stop" broadcast.
  const broadcastTyping = useCallback((state: "start" | "stop") => {
    const ch = channelRef.current;
    if (!ch) return;
    void ch.send({
      type: "broadcast",
      event: "typing",
      payload: { role, state },
    });
  }, [role]);

  function notifyTyping(value: string, timestamp: number) {
    if (typingStopTimerRef.current) {
      window.clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }
    if (value.trim().length === 0) {
      // Field cleared → tell the other side we stopped
      broadcastTyping("stop");
      typingBroadcastSentAtRef.current = 0;
      return;
    }
    // Throttle "start" to once per 1.5s
    if (timestamp - typingBroadcastSentAtRef.current > 1500) {
      broadcastTyping("start");
      typingBroadcastSentAtRef.current = timestamp;
    }
    // Auto-stop after 2s of no typing
    typingStopTimerRef.current = window.setTimeout(() => {
      broadcastTyping("stop");
      typingBroadcastSentAtRef.current = 0;
      typingStopTimerRef.current = null;
    }, 2000);
  }

  function insertEmoji(emoji: string) {
    const input = inputRef.current;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? draft.length;
    const nextDraft = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`;

    setDraft(nextDraft);
    notifyTyping(nextDraft, typingBroadcastSentAtRef.current + 1501);
    setEmojiOpen(false);
    window.requestAnimationFrame(() => {
      input?.focus();
      const nextCursor = start + emoji.length;
      input?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  const closeCancelModal = useCallback(() => {
    setCancelTarget(null);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  const cancelMessage = useCallback(
    async (messageId: string) => {
      closeCancelModal();
      setCancellingIds((prev) => new Set(prev).add(messageId));
      setError(null);
      try {
        const r = await fetch(
          `/api/chat/messages/${encodeURIComponent(messageId)}/cancel`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hoscode, role }),
          },
        );
        if (!r.ok) {
          throw new Error("ยกเลิกข้อความไม่สำเร็จ");
        }
        const j = (await r.json()) as { message: ServerMessage };
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? toMessage(j.message) : m)),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "ยกเลิกข้อความไม่สำเร็จ");
      } finally {
        setCancellingIds((prev) => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
      }
    },
    [closeCancelModal, hoscode, role],
  );

  const send = useCallback(async () => {
    const trimmed = draft.trim();
    const atts: Attachment[] = [...images, ...docs];
    if (!trimmed && atts.length === 0) return;
    if (sending) return;

    const clientId = genId();
    const optimistic: Message = {
      id: clientId,
      role,
      body: trimmed,
      client_id: clientId,
      created_at: new Date().toISOString(),
      read_at: null,
      cancelled_at: null,
      attachments: atts.map((a) => ({
        id: a.id,
        kind: a.kind,
        filename: a.filename,
        mime_type: a.mime_type,
        localUrl: a.localUrl,
      })),
    };
    setMessages((prev) => [...prev, optimistic]);

    const fd = new FormData();
    fd.append("hoscode", hoscode);
    fd.append("role", role);
    fd.append("body", trimmed);
    fd.append("client_id", clientId);
    for (const a of atts) {
      if (a.file) fd.append("attachments", a.file, a.filename);
    }

    // Stop the typing indicator on the other side immediately
    if (typingStopTimerRef.current) {
      window.clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }
    typingBroadcastSentAtRef.current = 0;
    broadcastTyping("stop");

    setSending(true);
    setDraft("");
    setImages([]);
    setDocs([]);
    setError(null);
    inputRef.current?.focus();

    try {
      const r = await fetch("/api/chat/messages", {
        method: "POST",
        body: fd,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { message: ServerMessage };
      // Replace optimistic with server message
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.client_id === clientId);
        if (idx < 0) return prev;
        const next = [...prev];
        next[idx] = toMessage(j.message);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "ส่งไม่สำเร็จ");
      // Mark optimistic as failed (or just leave it)
      setMessages((prev) => prev.filter((m) => m.client_id !== clientId));
    } finally {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [broadcastTyping, draft, images, docs, hoscode, role, sending]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const imageFiles = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);

    if (!imageFiles.length) return;

    e.preventDefault();
    addImageFiles(imageFiles);

    const pastedText = e.clipboardData.getData("text/plain");
    if (!pastedText) return;

    const target = e.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const nextDraft = draft.slice(0, start) + pastedText + draft.slice(end);
    setDraft(nextDraft);
    notifyTyping(nextDraft, e.timeStamp);
    requestAnimationFrame(() => {
      const cursorPos = start + pastedText.length;
      target.setSelectionRange(cursorPos, cursorPos);
    });
  }

  const composerLocked = !!cancelTarget;
  const canSend =
    (draft.trim().length > 0 ||
      images.length > 0 ||
      docs.length > 0) &&
    !sending &&
    !composerLocked;
  const imagesFull = images.length >= MAX_IMAGES;
  const docsFull = docs.length >= MAX_DOCS;
  const hasImageAttachment = images.length > 0;
  const hasDocAttachment = docs.length > 0;
  const headerTitle = role === "admin" ? "หน่วยบริการ" : "Admin Team";
  const headerSub =
    role === "admin"
      ? `hoscode ${hoscode}`
      : "ออนไลน์";

  const Outer = embedded ? "div" : "main";
  const outerClass = embedded
    ? "flex h-full w-full"
    : "flex min-h-screen items-center justify-center px-4 py-6";
  const sectionClass = embedded
    ? "flex h-full w-full flex-col overflow-hidden bg-[var(--panel)]"
    : "flex h-[min(880px,90vh)] w-full max-w-[860px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-[0_20px_60px_rgba(0,0,0,0.4)]";

  return (
    <Outer className={outerClass}>
      <section
        onClick={refocusOnPanelClick}
        className={`${sectionClass} relative`}>
        <header className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--inset)]/60 px-6 py-4 backdrop-blur">
          {role === "admin" ? (
            <button
              type="button"
              onClick={() => setUnitInfoOpen(true)}
              title="ดูข้อมูลหน่วยบริการ"
              aria-label="ดูข้อมูลหน่วยบริการ"
              className="flex min-w-0 items-center gap-3 rounded-xl px-1 py-1 text-left transition-colors hover:bg-[var(--panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/70"
            >
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] font-bold text-[#00212f]">
                <UserAvatarIcon />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--inset)] ${
                    connected ? "bg-emerald-400" : "bg-amber-400"
                  }`}
                  title={connected ? "realtime ออนไลน์" : "กำลังเชื่อมต่อ realtime"}
                />
              </div>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[15px] font-semibold">
                  {headerTitle} <span className="text-[var(--muted)]">{hoscode}</span>
                </span>
              </span>
            </button>
          ) : (
            <>
              <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] font-bold text-[#00212f]">
                <UserAvatarIcon />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--inset)] ${
                    connected ? "bg-emerald-400" : "bg-amber-400"
                  }`}
                  title={connected ? "realtime ออนไลน์" : "กำลังเชื่อมต่อ realtime"}
                />
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-[15px] font-semibold">{headerTitle}</span>
                <span className="text-[12px] text-[var(--muted)]">{headerSub}</span>
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setSoundOn((v) => {
                const next = !v;
                soundOnRef.current = next;
                soundPreferenceLoadedRef.current = true;
                if (next) {
                  void unlockAudio({ audible: true }).catch(() => {});
                } else {
                  pendingSoundRef.current = false;
                }
                return next;
              });
            }}
            title={soundOn ? "ปิดเสียงเตือน" : "เปิดเสียงเตือน"}
            aria-label={soundOn ? "ปิดเสียงเตือน" : "เปิดเสียงเตือน"}
            className="ml-2 flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--inset)] hover:text-[var(--text)]"
          >
            {soundOn ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
          </button>
          <div className="ml-auto rounded-full border border-[var(--border)] bg-[var(--inset)] px-3 py-1 font-mono text-[11px] text-[var(--muted)]">
            {role === "admin" ? "admin" : "user"}
          </div>
        </header>

        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto px-6 py-6 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]"
        >
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const mine = m.role === role;
            const showAvatar = !prev || prev.role !== m.role;
            const showDateSep =
              !prev || dateKey(prev.created_at) !== dateKey(m.created_at);
            return (
              <Fragment key={m.id}>
                {showDateSep && (
                  <div className="flex items-center justify-center py-2">
                    <span className="rounded-full bg-[var(--inset)] px-3 py-1 text-[11px] text-[var(--muted)]">
                      {formatDateSeparator(m.created_at)}
                    </span>
                  </div>
                )}
                <Bubble
                  msg={m}
                  mine={mine}
                  canCancel={
                    mine &&
                    !m.cancelled_at
                  }
                  cancelling={cancellingIds.has(m.id)}
                  onCancel={() => setCancelTarget(m)}
                  showAvatar={showAvatar}
                  viewerRole={role}
                  onImageOpen={setSelectedImage}
                />
              </Fragment>
            );
          })}
          {typingFrom && (
            <TypingIndicator
              from={typingFrom}
              viewerRole={role}
            />
          )}
        </div>

        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-2 border-t border-[var(--border)] bg-[var(--inset)]/40 px-4 py-3"
        >
          {(images.length > 0 || docs.length > 0 || error) && (
            <div className="flex flex-wrap items-center gap-2 px-1">
              {images.map((img) => (
                <PreviewChip
                  key={img.id}
                  attachment={img}
                  onRemove={() => removeImage(img.id)}
                />
              ))}
              {docs.map((d) => (
                <PreviewChip
                  key={d.id}
                  attachment={d}
                  onRemove={() => removeDoc(d.id)}
                />
              ))}
              {error && (
                <span className="ml-auto text-[12px] text-rose-400">
                  {error}
                </span>
              )}
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={pickImages}
            />
            <input
              ref={docInputRef}
              type="file"
              accept={DOC_ACCEPT}
              hidden
              onChange={pickDocs}
            />

            <AttachButton
              onClick={() => imageInputRef.current?.click()}
              disabled={imagesFull || hasDocAttachment || sending || composerLocked}
              title={
                hasDocAttachment
                  ? "ส่งรูปและไฟล์ในข้อความเดียวกันไม่ได้"
                  : imagesFull
                    ? `แนบครบ ${MAX_IMAGES} รูปแล้ว`
                    : `แนบรูป (${images.length}/${MAX_IMAGES})`
              }
              icon={<ImageIcon />}
              badge={images.length > 0 ? `${images.length}/${MAX_IMAGES}` : null}
            />
            <AttachButton
              onClick={() => docInputRef.current?.click()}
              disabled={docsFull || hasImageAttachment || sending || composerLocked}
              title={
                hasImageAttachment
                  ? "ส่งรูปและไฟล์ในข้อความเดียวกันไม่ได้"
                  : docsFull
                    ? `แนบเอกสารครบ ${MAX_DOCS} ไฟล์แล้ว`
                    : `แนบเอกสาร PDF/Word/Excel/TXT/CSV (≤5MB, สูงสุด ${MAX_DOCS} ไฟล์)`
              }
              icon={<DocIcon />}
              badge={docs.length > 0 ? `${docs.length}/${MAX_DOCS}` : null}
            />
            <div className="relative shrink-0">
              <AttachButton
                onClick={() => setEmojiOpen((open) => !open)}
                disabled={sending || composerLocked}
                title="เลือก emoji"
                icon={<SmileIcon />}
                badge={null}
              />
              {emojiOpen && (
                <div className="absolute bottom-full left-0 z-20 mb-2 grid w-[184px] grid-cols-4 gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-2 shadow-[0_12px_36px_rgba(0,0,0,0.35)]">
                  {EMOJI_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => insertEmoji(emoji)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-[20px] transition-colors hover:bg-[var(--inset)]"
                      aria-label={`เลือก ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                notifyTyping(e.target.value, e.timeStamp);
              }}
              onBlur={() => broadcastTyping("stop")}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              rows={1}
              disabled={sending || composerLocked}
              placeholder="พิมพ์ข้อความ…"
              className="max-h-40 min-h-[44px] min-w-[180px] flex-1 resize-none overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--inset)] px-4 py-3 text-[15px] leading-5 outline-none placeholder:text-[13px] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/40 disabled:opacity-60"
            />

            <button
              type="submit"
              disabled={!canSend}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] px-5 font-bold text-[#00212f] shadow-[0_6px_18px_rgba(14,165,233,0.35)] transition-[transform,opacity] hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0 max-[640px]:w-11 max-[640px]:gap-0 max-[640px]:px-0 max-[640px]:text-[0px]"
              aria-label="ส่งข้อความ"
            >
              <SendIcon />
              ส่ง
            </button>
          </div>
        </form>
        {cancelTarget && (
          <CancelMessageModal
            onClose={closeCancelModal}
            onConfirm={() => void cancelMessage(cancelTarget.id)}
            busy={cancellingIds.has(cancelTarget.id)}
          />
        )}
        {unitInfoOpen && role === "admin" && (
          <UnitInfoModal
            hoscode={hoscode}
            displayName={unitInfo?.displayName ?? `หน่วยบริการ ${hoscode}`}
            district={unitInfo?.district}
            province={unitInfo?.province}
            loading={unitInfoLoading}
            error={unitInfoError}
            onClose={() => setUnitInfoOpen(false)}
          />
        )}
      </section>
      {selectedImage && (
        <ImageModal
          image={selectedImage}
          onClose={() => setSelectedImage(null)}
        />
      )}
    </Outer>
  );
}

function Bubble({
  msg,
  mine,
  canCancel,
  cancelling,
  onCancel,
  showAvatar,
  viewerRole,
  onImageOpen,
}: {
  msg: Message;
  mine: boolean;
  canCancel: boolean;
  cancelling: boolean;
  onCancel: () => void;
  showAvatar: boolean;
  viewerRole: ChatRole;
  onImageOpen: (image: Attachment) => void;
}) {
  const cancelled = !!msg.cancelled_at;
  const hasText = msg.body.length > 0;
  const hasAttachments = !cancelled && msg.attachments.length > 0;
  const imageAtts = cancelled
    ? []
    : msg.attachments.filter((a) => a.kind === "image");
  const videoAtt = cancelled
    ? null
    : msg.attachments.find((a) => a.kind === "video");
  const docAtts = cancelled
    ? []
    : msg.attachments.filter((a) => a.kind === "doc");

  return (
    <div
      className={`flex items-end gap-2 chat-bubble-in ${
        mine ? "flex-row-reverse" : "flex-row"
      }`}
    >
      <div className="w-8 shrink-0">
        {showAvatar &&
          (msg.role === "user" ? (
            viewerRole === "admin" ? (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[12px] font-bold text-[#00212f]">
                <UserAvatarIcon small />
              </div>
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--inset)] text-[12px] font-semibold text-[var(--muted)]">
                <UserAvatarIcon small />
              </div>
            )
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[12px] font-bold text-[#00212f]">
              <UserAvatarIcon small />
            </div>
          ))}
      </div>

      <div
        className={`group relative flex max-w-[78%] flex-col gap-1 ${
          mine ? "items-end" : "items-start"
        }`}
      >
        {canCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            className="absolute right-full top-1/2 z-10 mr-2 -translate-y-1/2 rounded-full border border-rose-300/30 bg-[var(--panel)]/80 px-2 py-1 text-[10px] font-medium text-rose-200/70 opacity-0 shadow-sm transition-opacity hover:text-rose-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="ยกเลิกข้อความ"
            title="ยกเลิกข้อความ"
          >
            {cancelling ? "..." : "ยกเลิก"}
          </button>
        )}
        {hasAttachments && (
          <div
            className={`flex flex-col gap-2 ${
              mine ? "items-end" : "items-start"
            }`}
          >
            {imageAtts.length > 0 && (
              <div
                className={`grid gap-1.5 ${
                  imageAtts.length === 2 ? "grid-cols-2" : "grid-cols-1"
                }`}
              >
                {imageAtts.map((img) => (
                  <button
                    type="button"
                    key={img.id}
                    onClick={() => onImageOpen(img)}
                    className="block overflow-hidden rounded-xl border border-[var(--border)] text-left transition-colors hover:border-[var(--accent)]"
                    aria-label={`เปิดรูป ${img.filename}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={attachmentSrc(img)}
                      alt={img.filename}
                      className="h-44 w-44 object-cover transition-opacity hover:opacity-90"
                    />
                  </button>
                ))}
              </div>
            )}
            {videoAtt && (
              <video
                src={attachmentSrc(videoAtt)}
                controls
                playsInline
                className="max-w-[360px] rounded-xl border border-[var(--border)] bg-black"
              />
            )}
            {docAtts.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {docAtts.map((d) => (
                  <a
                    key={d.id}
                    href={attachmentSrc(d)}
                    target="_blank"
                    rel="noreferrer"
                    download={d.filename}
                    className="flex w-[280px] items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--inset)] px-3 py-2.5 transition-colors hover:border-[var(--accent)]"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/15 text-[var(--accent)]">
                      <DocIcon />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-[var(--text)]">
                        {d.filename}
                      </span>
                      <span className="block text-[11px] text-[var(--muted)]">
                        {docKindLabel(d.mime_type, d.filename)}
                        {d.size_bytes
                          ? ` · ${formatBytes(d.size_bytes)}`
                          : ""}
                      </span>
                    </span>
                    <span className="text-[var(--muted)]">
                      <DownloadIcon />
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {hasText && (
          <div className="relative">
            <div
              className={
                cancelled
                  ? "rounded-2xl border border-[var(--border)]/60 bg-[var(--inset)]/45 px-4 py-2.5 text-[14px] italic leading-[1.5] text-[var(--muted)] opacity-70"
                  : mine
                    ? "rounded-2xl rounded-br-md bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] px-4 py-2.5 text-[15px] leading-[1.5] text-[#00212f] shadow-[0_4px_14px_rgba(14,165,233,0.25)]"
                    : "rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--inset)] px-4 py-2.5 text-[15px] leading-[1.5] text-[var(--text)]"
              }
            >
              <span className="whitespace-pre-wrap break-words">{msg.body}</span>
            </div>
          </div>
        )}
        <span className="px-1 text-[10px] text-[var(--muted)] opacity-70">
          {formatTime(msg.created_at)}
          {mine && msg.read_at ? (
            <span className="ml-1">อ่านแล้ว</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function PreviewChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  return (
    <div className="group relative overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--inset)]">
      {attachment.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachmentSrc(attachment)}
          alt={attachment.filename}
          className="h-14 w-14 object-cover"
        />
      ) : attachment.kind === "video" ? (
        <div className="flex h-14 w-20 items-center justify-center bg-black">
          <video
            src={attachmentSrc(attachment)}
            muted
            className="h-full w-full object-cover"
          />
          <span className="absolute inset-0 flex items-center justify-center text-white/90">
            <PlayIcon />
          </span>
        </div>
      ) : (
        <div className="flex h-14 max-w-[180px] items-center gap-2 px-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--accent)]/15 text-[var(--accent)]">
            <DocIcon />
          </span>
          <div className="min-w-0 flex-1 pr-3">
            <div className="truncate text-[12px] font-medium text-[var(--text)]">
              {attachment.filename}
            </div>
            <div className="text-[10px] text-[var(--muted)]">
              {docKindLabel(attachment.mime_type, attachment.filename)}
              {attachment.size_bytes
                ? ` · ${formatBytes(attachment.size_bytes)}`
                : ""}
            </div>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label="ลบไฟล์แนบ"
        className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white transition-colors hover:bg-rose-500"
      >
        <XIcon />
      </button>
    </div>
  );
}

function ImageModal({
  image,
  onClose,
}: {
  image: Attachment;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={image.filename}
      onClick={onClose}
    >
      <div
        className="relative max-h-full max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิดรูป"
          className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white shadow-lg transition-colors hover:bg-rose-500"
        >
          <XIcon />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={attachmentSrc(image)}
          alt={image.filename}
          className="max-h-[88vh] max-w-[92vw] rounded-xl border border-white/15 bg-black object-contain shadow-2xl"
        />
      </div>
    </div>
  );
}

function UnitInfoModal({
  hoscode,
  displayName,
  district,
  province,
  loading,
  error,
  onClose,
}: {
  hoscode: string;
  displayName: string;
  district?: string | null;
  province?: string | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const rows = [
    ["รหัส", hoscode],
    ["ชื่อหน่วยบริการ", displayName],
    ["อำเภอ", district?.trim() || "-"],
    ["จังหวัด", province?.trim() || "-"],
  ];

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="ข้อมูลหน่วยบริการ"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-[var(--text)]">
              ข้อมูลหน่วยบริการ
            </div>
            <div className="mt-1 truncate text-[12px] text-[var(--muted)]">
              {displayName}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--inset)] text-[var(--muted)] transition-colors hover:border-rose-300/70 hover:text-rose-200"
          >
            <XIcon />
          </button>
        </div>
        <dl className="grid gap-2">
          {error && (
            <div className="rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-[12px] text-amber-100">
              โหลดข้อมูลหน่วยบริการไม่สำเร็จ: {error}
            </div>
          )}
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="grid grid-cols-[110px_1fr] gap-3 rounded-md border border-[var(--border)]/70 bg-[var(--inset)] px-3 py-2.5"
            >
              <dt className="text-[12px] text-[var(--muted)]">{label}</dt>
              <dd className="min-w-0 break-words text-[13px] font-medium text-[var(--text)]">
                {loading ? "กำลังโหลด..." : value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function CancelMessageModal({
  onClose,
  onConfirm,
  busy,
}: {
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <div
      className="absolute left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)]/95 p-2 shadow-[0_12px_36px_rgba(0,0,0,0.38)] backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-label="ยืนยันยกเลิกข้อความ"
    >
      <button
        type="button"
        onClick={onClose}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-[12px] font-bold text-white transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <XIcon />
        ปิด
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-500 px-3 py-2 text-[12px] font-bold text-white transition-colors hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <CheckIcon />
        {busy ? "..." : "ยืนยัน"}
      </button>
    </div>
  );
}

function AttachButton({
  onClick,
  disabled,
  title,
  icon,
  badge,
}: {
  onClick: () => void;
  disabled: boolean;
  title: string;
  icon: React.ReactNode;
  badge: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--inset)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--muted)]"
    >
      {icon}
      {badge && (
        <span className="absolute -right-1 -top-1 rounded-full bg-[var(--accent)] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#00212f]">
          {badge}
        </span>
      )}
    </button>
  );
}

function TypingIndicator({
  from,
  viewerRole,
}: {
  from: ChatRole;
  viewerRole: ChatRole;
}) {
  return (
    <div className="flex items-end gap-2 chat-bubble-in">
      <div className="w-8 shrink-0">
        {from === "user" ? (
          viewerRole === "admin" ? (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[12px] font-bold text-[#00212f]">
              <UserAvatarIcon small />
            </div>
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--inset)] text-[12px] font-semibold text-[var(--muted)]">
              <UserAvatarIcon small />
            </div>
          )
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[12px] font-bold text-[#00212f]">
            <UserAvatarIcon small />
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--inset)] px-4 py-3">
        <Dot delay="0ms" />
        <Dot delay="150ms" />
        <Dot delay="300ms" />
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-2 w-2 animate-bounce rounded-full bg-[var(--muted)]"
      style={{ animationDelay: delay }}
    />
  );
}

function UserAvatarIcon({ small = false }: { small?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={small ? "h-4 w-4" : "h-5 w-5"}
      aria-hidden
    >
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="8" r="4" />
    </svg>
  );
}

function SendIcon() {
  return (
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
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h6" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-5 w-5 drop-shadow"
      aria-hidden
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3"
      aria-hidden
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function SmileIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <path d="M9 9h.01" />
      <path d="M15 9h.01" />
    </svg>
  );
}

function SpeakerOnIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function SpeakerOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
  );
}
