"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ChatRoom } from "@/components/ChatRoom";

export default function AdminChatPage() {
  return (
    <Suspense fallback={null}>
      <AdminChat />
    </Suspense>
  );
}

function AdminChat() {
  const search = useSearchParams();
  const hoscode = search.get("hoscode")?.trim();
  if (!hoscode) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-6">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-8 py-6 text-[var(--muted)]">
          ระบุ <code className="text-[var(--text)]">?hoscode=xxxxx</code>{" "}
          เพื่อเข้าห้องสนทนาในฝั่ง admin
        </div>
      </main>
    );
  }
  return <ChatRoom hoscode={hoscode} role="admin" />;
}
