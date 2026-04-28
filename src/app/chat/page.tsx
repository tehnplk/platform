"use client";

import {
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useSearchParams } from "next/navigation";

type Role = "user" | "admin";

type Message = {
  id: string;
  role: Role;
  text: string;
  at: number;
};

const TYPING_DELAY_MS = 700;

function formatTime(ms: number) {
  const d = new Date(ms);
  return d.toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatRoom />
    </Suspense>
  );
}

function ChatRoom() {
  const search = useSearchParams();
  const hoscode = search.get("hoscode") ?? "—";

  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: genId(),
      role: "admin",
      text: `สวัสดีครับ — เชื่อมต่อจากโรงพยาบาลรหัส ${
        search.get("hoscode") ?? "—"
      } พิมพ์ข้อความเพื่อเริ่มสนทนา`,
      at: Date.now(),
    },
  ]);
  const [draft, setDraft] = useState("");
  const [adminTyping, setAdminTyping] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, adminTyping]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const userMsg: Message = {
      id: genId(),
      role: "user",
      text: trimmed,
      at: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setDraft("");
    setAdminTyping(true);
    window.setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: genId(),
          role: "admin",
          text: trimmed,
          at: Date.now(),
        },
      ]);
      setAdminTyping(false);
    }, TYPING_DELAY_MS);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(draft);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  }

  const adminInitial = "A";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-6">
      <section className="flex h-[min(880px,90vh)] w-full max-w-[860px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
        <header className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--inset)]/60 px-6 py-4 backdrop-blur">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] font-bold text-[#00212f]">
            {adminInitial}
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--inset)] bg-emerald-400" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[15px] font-semibold">Plk Admin</span>
            <span className="text-[12px] text-[var(--muted)]">
              ออนไลน์ · hoscode {hoscode}
            </span>
          </div>
          <div className="ml-auto rounded-full border border-[var(--border)] bg-[var(--inset)] px-3 py-1 font-mono text-[11px] text-[var(--muted)]">
            mockup
          </div>
        </header>

        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto px-6 py-6 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]"
        >
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const showAvatar = !prev || prev.role !== m.role;
            return (
              <Bubble
                key={m.id}
                msg={m}
                showAvatar={showAvatar}
                adminInitial={adminInitial}
              />
            );
          })}
          {adminTyping && <TypingIndicator adminInitial={adminInitial} />}
        </div>

        <form
          onSubmit={onSubmit}
          className="flex items-end gap-3 border-t border-[var(--border)] bg-[var(--inset)]/40 px-4 py-4"
        >
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="พิมพ์ข้อความ… (Shift+Enter ขึ้นบรรทัดใหม่)"
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--inset)] px-4 py-3 text-[15px] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/40"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] px-5 font-bold text-[#00212f] shadow-[0_6px_18px_rgba(14,165,233,0.35)] transition-[transform,opacity] hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0"
            aria-label="ส่งข้อความ"
          >
            <SendIcon />
            ส่ง
          </button>
        </form>
      </section>
    </main>
  );
}

function Bubble({
  msg,
  showAvatar,
  adminInitial,
}: {
  msg: Message;
  showAvatar: boolean;
  adminInitial: string;
}) {
  const isUser = msg.role === "user";
  return (
    <div
      className={`flex items-end gap-2 ${
        isUser ? "flex-row-reverse" : "flex-row"
      }`}
    >
      <div className="w-8 shrink-0">
        {showAvatar &&
          (isUser ? (
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
          isUser ? "items-end" : "items-start"
        }`}
      >
        <div
          className={
            isUser
              ? "rounded-2xl rounded-br-md bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] px-4 py-2.5 text-[15px] leading-[1.5] text-[#00212f] shadow-[0_4px_14px_rgba(14,165,233,0.25)]"
              : "rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--inset)] px-4 py-2.5 text-[15px] leading-[1.5] text-[var(--text)]"
          }
        >
          <span className="whitespace-pre-wrap break-words">{msg.text}</span>
        </div>
        <span className="px-1 text-[11px] text-[var(--muted)]">
          {formatTime(msg.at)}
        </span>
      </div>
    </div>
  );
}

function TypingIndicator({ adminInitial }: { adminInitial: string }) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[12px] font-bold text-[#00212f]">
        {adminInitial}
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
