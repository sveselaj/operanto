import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL
    ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
    : undefined,
  title: {
    default: "Operanto — Customer operations that remember, continue, and resolve",
    template: "%s · Operanto",
  },
  description:
    "Operanto connects customers, conversations, opportunities, tasks, staff, and source systems into one operational cockpit.",
  // Canonical URLs always point at the marketing domain, even when a page is
  // served from another host.
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Operanto",
    url: "/",
    title: "Operanto — Customer operations that remember, continue, and resolve",
    description:
      "Operanto connects customers, conversations, opportunities, tasks, staff, and source systems into one operational cockpit.",
    locale: "en",
  },
  // No image is declared: shipping an og:image URL we do not serve would be
  // a broken promise to every social preview that fetches it.
  twitter: {
    card: "summary",
    title: "Operanto — Customer operations that remember, continue, and resolve",
    description:
      "Operanto connects customers, conversations, opportunities, tasks, staff, and source systems into one operational cockpit.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
