import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "@/app/globals.css";
import SessionProvider from "@/app/components/SessionProvider";
import { ThemeProvider } from "@/app/components/ThemeProvider";
import { I18nProvider } from "@/app/components/I18nProvider";
import Nav from "@/app/components/Nav";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MORANA",
  description: "[ MORANA ] Slovanska boginja smrti // internal AI ops terminal",
};

const noFlashScript = `(function(){
  var t=(document.cookie.match(/morana_theme=([^;]+)/)||[])[1]||'system';
  var d=t==='system'
    ?(window.matchMedia('(prefers-color-scheme:light)').matches?'light':'dark')
    :t;
  document.documentElement.className=d;
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body
        className={`${geistMono.variable} antialiased min-h-screen`}
        style={{
          fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        }}
      >
        <SessionProvider>
          <ThemeProvider>
            <I18nProvider>
              <Nav />
              <main
                className="mx-auto max-w-5xl px-4 py-6"
                style={{ position: "relative" }}
              >
                {children}
              </main>
            </I18nProvider>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
