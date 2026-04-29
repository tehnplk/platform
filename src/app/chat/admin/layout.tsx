import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin Chat Console",
};

export default function AdminChatLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
