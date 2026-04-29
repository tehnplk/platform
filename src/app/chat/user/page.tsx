"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ChatRoom } from "@/components/ChatRoom";

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
  if (!hoscode) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-6">
        <title>Admin Tem</title>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-8 py-6 text-[var(--muted)]">
          ระบุ <code className="text-[var(--text)]">?hoscode=xxxxx</code>{" "}
          เพื่อเข้าห้องสนทนา
        </div>
      </main>
    );
  }
  return (
    <>
      <title>Admin Tem</title>
      <ChatRoom hoscode={hoscode} role="user" />
    </>
  );
}
