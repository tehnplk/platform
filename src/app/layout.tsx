import type { Metadata } from "next";
import { Sarabun } from "next/font/google";
import "sweetalert2/dist/sweetalert2.min.css";
import "./globals.css";

const sarabun = Sarabun({
  variable: "--font-sarabun",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Plk Platform — ดาวน์โหลด",
  description: "ระบบสนับสนุนงาน HIS",
  icons: { icon: "data:," },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" className={`${sarabun.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
