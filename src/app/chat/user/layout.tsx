import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin Team",
};

export default function UserChatLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="theme-light-green min-h-screen">{children}</div>;
}
