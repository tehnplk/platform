"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { ChatRoom } from "@/components/ChatRoom";

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

export default function UserChatPage() {
  return (
    <Suspense fallback={null}>
      <UserChat />
    </Suspense>
  );
}

function UserChat() {
  const search = useSearchParams();
  const hoscode = search.get("hoscode")?.trim();
  useTitle("Admin Team");
  if (!hoscode) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-6">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-8 py-6 text-[var(--muted)]">
          ระบุ <code className="text-[var(--text)]">?hoscode=xxxxx</code>{" "}
          เพื่อเข้าห้องสนทนา
        </div>
      </main>
    );
  }
  return <ChatRoom hoscode={hoscode} role="user" />;
}
