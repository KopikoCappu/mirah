import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import Link from "next/link";
import { currentUser } from "@/lib/session";
import { NavLinks } from "./components";
import { BrandMark } from "./ui";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const serif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Mirah",
  description: "Your inbox, sorted: what's important, what to review, what's junk.",
  appleWebApp: { capable: true, title: "Mirah", statusBarStyle: "default" },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#121210" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${serif.variable}`}>
      <body className={user ? "has-nav" : ""}>
        {user && (
          <header className="topbar">
            <Link href="/" className="brand">
              <BrandMark />
              Mirah
            </Link>
            <NavLinks />
          </header>
        )}
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
