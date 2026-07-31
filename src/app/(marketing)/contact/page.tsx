import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  alternates: { canonical: "/contact" },
  openGraph: {
    type: "website",
    siteName: "Operanto",
    url: "/contact",
    title: "Contact",
    description: "Write to hello@operanto.ai. Early access to Operanto is invitation-based, deployed with a small number of organisations at a time.",
  },
  title: "Contact",
  description:
    "Write to hello@operanto.ai. Early access to Operanto is invitation-based, deployed with a small number of organisations at a time.",
};

export default function ContactPage() {
  return (
    <>
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 pb-16 pt-20 sm:pb-20 sm:pt-28">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Contact
          </p>
          <h1 className="mt-5 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Write to us. A person reads it.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            No forms, no queues. Email us directly and we will reply directly.
          </p>
          <div className="mt-10">
            <a
              href="mailto:hello@operanto.ai"
              className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              hello@operanto.ai
            </a>
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <div className="grid gap-10 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-6 sm:p-8">
              <h2 className="text-base font-semibold">
                Early access is invitation-based
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Operanto is deployed with a small number of organisations at a
                time, so that each implementation gets real attention. There is
                no self-serve signup; access begins with a conversation and an
                invitation.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-6 sm:p-8">
              <h2 className="text-base font-semibold">
                Useful things to mention
              </h2>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
                <li>What your organisation does and where it operates</li>
                <li>Which systems customer inquiries arrive through today</li>
                <li>Who follows up on them, and how that is tracked now</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <h2 className="text-2xl font-semibold tracking-tight">
            Not sure what to ask yet?
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Start with the product and the journey of a single inquiry — they
            explain most of what Operanto is.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Link
              href="/product"
              className="inline-flex items-center justify-center rounded-md border border-border bg-card px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              Product
            </Link>
            <Link
              href="/how-it-works"
              className="inline-flex items-center justify-center rounded-md border border-border bg-card px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              How it works
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
