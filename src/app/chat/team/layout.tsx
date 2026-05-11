import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Team Chat Console",
};

export default function TeamChatLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="theme-light-blue min-h-screen">{children}</div>;
}
