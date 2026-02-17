import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "@/app/globals.css";
import SessionProvider from "@/app/components/SessionProvider";
import Nav from "@/app/components/Nav";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MORANA",
  description: "[ MORANA ] Slovanska boginja smrti // internal AI ops terminal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistMono.variable} antialiased min-h-screen`}
        style={{
          fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
          backgroundColor: "#0a0a0a",
          color: "#c9d1d9",
        }}
      >
        <SessionProvider>
          <Nav />
          <main
            className="mx-auto max-w-5xl px-4 py-6"
            style={{ position: "relative" }}
          >
            {children}
          </main>
        </SessionProvider>
      </body>
    </html>
  );
}
