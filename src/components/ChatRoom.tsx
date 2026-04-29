"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { RealtimeClient } from "@supabase/realtime-js";
import {
  REALTIME_ANON_KEY,
  REALTIME_URL,
} from "@/lib/realtime-config";

export type ChatRole = "user" | "admin";

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
  client_id?: string | null;
  attachments: Attachment[];
};

type ServerMessage = {
  id: string;
  hoscode: string;
  role: ChatRole;
  body: string;
  client_id: string | null;
  created_at: string;
  read_at: string | null;
  attachments: Array<{
    id: string;
    kind: "image" | "video" | "doc";
    filename: string;
    mime_type: string;
    size_bytes: number;
    duration_ms: number | null;
  }>;
};

const MAX_IMAGES = 2;
const MAX_VIDEO_SECONDS = 20;
const MAX_DOCS = 3;
const MAX_DOC_BYTES = 5 * 1024 * 1024;
const DOC_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv";

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

function probeVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = url;
    v.onloadedmetadata = () => {
      const d = v.duration;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("ไม่สามารถอ่านไฟล์วิดีโอได้"));
    };
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
}: {
  hoscode: string;
  role: ChatRole;
  embedded?: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<Attachment[]>([]);
  const [video, setVideo] = useState<Attachment | null>(null);
  const [docs, setDocs] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [typingFrom, setTypingFrom] = useState<ChatRole | null>(null);

  const channelRef = useRef<ReturnType<RealtimeClient["channel"]> | null>(null);
  const typingClearRef = useRef<number | null>(null);
  const typingBroadcastSentAtRef = useRef(0);
  const typingStopTimerRef = useRef<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

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
      } catch (err) {
        console.error("load messages failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hoscode]);

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
        async (payload: {
          payload?: {
            id?: string;
            client_id?: string | null;
            role?: ChatRole;
          };
        }) => {
          const id = payload.payload?.id;
          const clientId = payload.payload?.client_id ?? null;
          const senderRole = payload.payload?.role;
          if (!id) return;
          // The sender just sent — they have stopped typing.
          if (senderRole && senderRole !== role) {
            setTypingFrom((cur) => (cur === senderRole ? null : cur));
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
        { event: "typing" },
        (payload: { payload?: { role?: ChatRole; state?: "start" | "stop" } }) => {
          const senderRole = payload.payload?.role;
          const state = payload.payload?.state;
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
  }, [hoscode, role]);

  // Auto-scroll on new messages OR when the other side starts typing
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typingFrom]);

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

  function refocusOnPanelClick(e: React.MouseEvent<HTMLElement>) {
    const t = e.target as HTMLElement;
    if (t.closest("button, a, input, textarea, video, [contenteditable]")) {
      return;
    }
    inputRef.current?.focus();
  }

  function pickImages(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (!files.length) return;
    setError(null);
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

  async function pickVideo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (video) {
      setError("แนบคลิปได้แค่ 1 คลิป — ลบของเดิมก่อน");
      return;
    }
    try {
      const duration = await probeVideoDuration(file);
      if (duration > MAX_VIDEO_SECONDS + 0.5) {
        setError(
          `คลิปยาว ${duration.toFixed(1)} วินาที — เกินจำกัด ${MAX_VIDEO_SECONDS} วินาที`,
        );
        return;
      }
      setVideo({
        id: genId(),
        kind: "video",
        filename: file.name,
        mime_type: file.type,
        localUrl: URL.createObjectURL(file),
        file,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "ไม่สามารถอ่านไฟล์ได้");
    }
  }

  function pickDocs(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (!files.length) return;
    setError(null);
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
  function broadcastTyping(state: "start" | "stop") {
    const ch = channelRef.current;
    if (!ch) return;
    void ch.send({
      type: "broadcast",
      event: "typing",
      payload: { role, state },
    });
  }

  function notifyTyping(value: string) {
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
    const now = Date.now();
    // Throttle "start" to once per 1.5s
    if (now - typingBroadcastSentAtRef.current > 1500) {
      broadcastTyping("start");
      typingBroadcastSentAtRef.current = now;
    }
    // Auto-stop after 2s of no typing
    typingStopTimerRef.current = window.setTimeout(() => {
      broadcastTyping("stop");
      typingBroadcastSentAtRef.current = 0;
      typingStopTimerRef.current = null;
    }, 2000);
  }

  function removeVideo() {
    if (video?.localUrl) URL.revokeObjectURL(video.localUrl);
    setVideo(null);
  }

  const send = useCallback(async () => {
    const trimmed = draft.trim();
    const atts: Attachment[] = [
      ...images,
      ...(video ? [video] : []),
      ...docs,
    ];
    if (!trimmed && atts.length === 0) return;
    if (sending) return;

    const clientId = genId();
    const optimistic: Message = {
      id: clientId,
      role,
      body: trimmed,
      client_id: clientId,
      created_at: new Date().toISOString(),
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
    setVideo(null);
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
  }, [draft, images, video, docs, hoscode, role, sending]);

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

  const adminInitial = "A";
  const canSend =
    (draft.trim().length > 0 ||
      images.length > 0 ||
      !!video ||
      docs.length > 0) &&
    !sending;
  const imagesFull = images.length >= MAX_IMAGES;
  const videoFull = !!video;
  const docsFull = docs.length >= MAX_DOCS;

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
        className={sectionClass}>
        <header className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--inset)]/60 px-6 py-4 backdrop-blur">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] font-bold text-[#00212f]">
            {role === "admin" ? hoscode.slice(-2) : adminInitial}
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--inset)] ${
                connected ? "bg-emerald-400" : "bg-amber-400"
              }`}
              title={connected ? "realtime ออนไลน์" : "กำลังเชื่อมต่อ realtime"}
            />
          </div>
          <div className="flex flex-col leading-tight">
            {role === "admin" ? (
              <span className="text-[15px] font-semibold">
                {headerTitle} <span className="text-[var(--muted)]">{hoscode}</span>
              </span>
            ) : (
              <>
                <span className="text-[15px] font-semibold">{headerTitle}</span>
                <span className="text-[12px] text-[var(--muted)]">{headerSub}</span>
              </>
            )}
          </div>
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
                  showAvatar={showAvatar}
                  adminInitial={adminInitial}
                />
              </Fragment>
            );
          })}
          {typingFrom && (
            <TypingIndicator
              from={typingFrom}
              adminInitial={adminInitial}
            />
          )}
        </div>

        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-2 border-t border-[var(--border)] bg-[var(--inset)]/40 px-4 py-3"
        >
          {(images.length > 0 || video || docs.length > 0 || error) && (
            <div className="flex flex-wrap items-center gap-2 px-1">
              {images.map((img) => (
                <PreviewChip
                  key={img.id}
                  attachment={img}
                  onRemove={() => removeImage(img.id)}
                />
              ))}
              {video && (
                <PreviewChip attachment={video} onRemove={removeVideo} />
              )}
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
              multiple
              hidden
              onChange={pickImages}
            />
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              hidden
              onChange={pickVideo}
            />
            <input
              ref={docInputRef}
              type="file"
              accept={DOC_ACCEPT}
              multiple
              hidden
              onChange={pickDocs}
            />

            <AttachButton
              onClick={() => imageInputRef.current?.click()}
              disabled={imagesFull || sending}
              title={
                imagesFull
                  ? `แนบครบ ${MAX_IMAGES} รูปแล้ว`
                  : `แนบรูป (${images.length}/${MAX_IMAGES})`
              }
              icon={<ImageIcon />}
              badge={images.length > 0 ? `${images.length}/${MAX_IMAGES}` : null}
            />
            <AttachButton
              onClick={() => videoInputRef.current?.click()}
              disabled={videoFull || sending}
              title={
                videoFull
                  ? "แนบคลิปแล้ว"
                  : `แนบคลิป (สูงสุด ${MAX_VIDEO_SECONDS} วินาที)`
              }
              icon={<VideoIcon />}
              badge={video ? "1/1" : null}
            />
            <AttachButton
              onClick={() => docInputRef.current?.click()}
              disabled={docsFull || sending}
              title={
                docsFull
                  ? `แนบเอกสารครบ ${MAX_DOCS} ไฟล์แล้ว`
                  : `แนบเอกสาร PDF/Word/Excel/TXT/CSV (≤5MB, สูงสุด ${MAX_DOCS} ไฟล์)`
              }
              icon={<DocIcon />}
              badge={docs.length > 0 ? `${docs.length}/${MAX_DOCS}` : null}
            />

            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                notifyTyping(e.target.value);
              }}
              onBlur={() => broadcastTyping("stop")}
              onKeyDown={onKeyDown}
              rows={1}
              disabled={sending}
              placeholder="พิมพ์ข้อความ… (Shift+Enter ขึ้นบรรทัดใหม่)"
              className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--inset)] px-4 py-3 text-[15px] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/40 disabled:opacity-60"
            />

            <button
              type="submit"
              disabled={!canSend}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] px-5 font-bold text-[#00212f] shadow-[0_6px_18px_rgba(14,165,233,0.35)] transition-[transform,opacity] hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0"
              aria-label="ส่งข้อความ"
            >
              <SendIcon />
              ส่ง
            </button>
          </div>
        </form>
      </section>
    </Outer>
  );
}

function Bubble({
  msg,
  mine,
  showAvatar,
  adminInitial,
}: {
  msg: Message;
  mine: boolean;
  showAvatar: boolean;
  adminInitial: string;
}) {
  const hasText = msg.body.length > 0;
  const hasAttachments = msg.attachments.length > 0;
  const imageAtts = msg.attachments.filter((a) => a.kind === "image");
  const videoAtt = msg.attachments.find((a) => a.kind === "video");
  const docAtts = msg.attachments.filter((a) => a.kind === "doc");

  return (
    <div
      className={`flex items-end gap-2 chat-bubble-in ${
        mine ? "flex-row-reverse" : "flex-row"
      }`}
    >
      <div className="w-8 shrink-0">
        {showAvatar &&
          (msg.role === "user" ? (
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--inset)] text-[12px] font-semibold text-[var(--muted)]">
              คุณ
            </div>
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[12px] font-bold text-[#00212f]">
              {adminInitial}
            </div>
          ))}
      </div>

      <div
        className={`flex max-w-[78%] flex-col gap-1 ${
          mine ? "items-end" : "items-start"
        }`}
      >
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
                  <a
                    key={img.id}
                    href={attachmentSrc(img)}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-xl border border-[var(--border)]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={attachmentSrc(img)}
                      alt={img.filename}
                      className="h-44 w-44 object-cover transition-opacity hover:opacity-90"
                    />
                  </a>
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
          <div
            className={
              mine
                ? "rounded-2xl rounded-br-md bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] px-4 py-2.5 text-[15px] leading-[1.5] text-[#00212f] shadow-[0_4px_14px_rgba(14,165,233,0.25)]"
                : "rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--inset)] px-4 py-2.5 text-[15px] leading-[1.5] text-[var(--text)]"
            }
          >
            <span className="whitespace-pre-wrap break-words">{msg.body}</span>
          </div>
        )}
        <span className="px-1 text-[11px] text-[var(--muted)]">
          {formatTime(msg.created_at)}
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
  adminInitial,
}: {
  from: ChatRole;
  adminInitial: string;
}) {
  return (
    <div className="flex items-end gap-2 chat-bubble-in">
      <div className="w-8 shrink-0">
        {from === "user" ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--inset)] text-[12px] font-semibold text-[var(--muted)]">
            คุณ
          </div>
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[12px] font-bold text-[#00212f]">
            {adminInitial}
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

function VideoIcon() {
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
      <path d="m22 8-6 4 6 4V8Z" />
      <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
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
