import type { ReactNode } from "react";
import Link from "next/link";

const navLinks = [
  { href: "/product", label: "Product" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/real-estate", label: "Real estate" },
  { href: "/security", label: "Security" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
] as const;

export default function MarketingLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight"
          >
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-[2px] bg-primary"
            />
            Operanto
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-6 lg:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <Link
            href="/login"
            className="text-sm font-medium text-primary transition-colors hover:text-accent-foreground"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-12">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-xs">
              <p className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-[2px] bg-primary"
                />
                Operanto
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Customer operations that remember, continue, and resolve.
              </p>
            </div>
            <nav
              aria-label="Footer"
              className="grid grid-cols-2 gap-x-12 gap-y-3 sm:grid-cols-3"
            >
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="mt-10 flex flex-col gap-2 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">© 2026 Operanto</p>
            <Link
              href="/security"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              How we handle security
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
