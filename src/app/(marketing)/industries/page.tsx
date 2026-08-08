import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  alternates: { canonical: "/industries" },
  openGraph: {
    type: "website",
    siteName: "Operanto",
    url: "/industries",
    title: "Industries",
    description:
      "Where Operanto fits: operations where inquiries arrive across channels, the context lives in several systems, and someone has to keep the commitment.",
  },
  title: "Industries",
  description:
    "Where Operanto fits: operations where inquiries arrive across channels, the context lives in several systems, and someone has to keep the commitment.",
};

/**
 * Industry fit, not a customer list. `status` distinguishes the vertical we
 * actually run in production from the ones the same pattern applies to —
 * we describe fit, we do not imply customers we do not have.
 */
const industries = [
  {
    name: "Real estate",
    status: "live",
    situation:
      "Inquiries arrive on portals and listing pages at all hours, each one high-intent and time-sensitive. They are easy to lose between the listing, the inbox, and an agent's day.",
    change:
      "Every inquiry becomes a lead with its history attached and a named person responsible, so a returning buyer is recognised rather than re-registered.",
    href: "/real-estate",
  },
  {
    name: "E-commerce and retail",
    status: "fit",
    situation:
      "“Where is my order?” arrives on WhatsApp, email, and social — while the answer lives in a shop platform, a carrier portal, and sometimes a supplier's system.",
    change:
      "The conversation, the customer's order history, and the open follow-up sit in one place, so the person replying is not the one assembling the answer from four tabs.",
  },
  {
    name: "Logistics and delivery",
    status: "fit",
    situation:
      "Exceptions are the work: a delayed shipment, a customs hold, a failed delivery. The systems holding the answer are often portals with no usable API.",
    change:
      "Context and history stay with the case, and where an interface has to be read rather than queried, that step is proposed, approved, and recorded like any other.",
  },
  {
    name: "Professional and financial services",
    status: "fit",
    situation:
      "Client requests carry obligations. Who said what, who approved it, and when it happened matters as much as the answer itself.",
    change:
      "Approvals and an audit trail are part of the workflow rather than a reconstruction afterwards, and nothing reaches a client without a person choosing to send it.",
  },
  {
    name: "Field service and trades",
    status: "fit",
    situation:
      "Appointments, callbacks, and quotes are promised in conversation and then live in someone's memory until they do not.",
    change:
      "Each commitment becomes a follow-up with a due time and an owner, so the question is when it happens, not whether anyone remembered.",
  },
] as const;

export default function IndustriesPage() {
  return (
    <>
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 pb-16 pt-20 sm:pb-20 sm:pt-28">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Industries
          </p>
          <h1 className="mt-5 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Different industries, the same broken seam.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Operanto is not built for one sector. It is built for a shape of
            work: inquiries arriving across channels, the context spread over
            several systems, and a commitment someone has to keep. Wherever
            that shape appears, the same layer helps.
          </p>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <h2 className="text-sm font-medium text-muted-foreground">
            Where Operanto fits
          </h2>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {industries.map((industry) => (
              <div
                key={industry.name}
                className="flex flex-col rounded-lg border border-border bg-card p-6"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-base font-semibold">{industry.name}</h3>
                  <span
                    className={
                      industry.status === "live"
                        ? "shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                        : "shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                    }
                  >
                    {industry.status === "live"
                      ? "First live implementation"
                      : "Same pattern"}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {industry.situation}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">
                    What changes:
                  </span>{" "}
                  {industry.change}
                </p>
                {"href" in industry && industry.href ? (
                  <Link
                    href={industry.href}
                    className="mt-4 text-sm font-medium text-primary transition-colors hover:text-accent-foreground"
                  >
                    How it works in real estate
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
          <p className="mt-8 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Real estate is where Operanto runs in production today. The others
            describe the same operational pattern, not customers we already
            serve — we would rather be accurate about that than imply a
            reference list we have not earned.
          </p>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                When Operanto helps
              </h2>
              <ul className="mt-6 space-y-4 text-sm leading-relaxed text-muted-foreground">
                <li>
                  Customers reach you on more than one channel, and the thread
                  matters.
                </li>
                <li>
                  The answer to a routine question lives in two or three
                  different systems.
                </li>
                <li>
                  Work is handed between people, shifts, or offices and must
                  survive the handover.
                </li>
                <li>
                  Someone has to be accountable for a commitment, and you need
                  to be able to show what happened.
                </li>
              </ul>
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                When it does not
              </h2>
              <ul className="mt-6 space-y-4 text-sm leading-relaxed text-muted-foreground">
                <li>
                  One system already answers everything and nobody loses
                  context between tools.
                </li>
                <li>
                  Volume is low enough that one person holds the whole picture
                  in their head.
                </li>
                <li>
                  You want a bot to answer customers without a person in the
                  loop — that is not what we build.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <div className="rounded-lg border border-border bg-card p-8 sm:p-10">
            <h2 className="text-2xl font-semibold tracking-tight">
              Does this describe your operation?
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              We implement alongside a small number of organisations at a time,
              vertical by vertical. If the shape above sounds like your week, we
              would like to hear how it actually runs today.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Link
                href="/contact"
                className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Contact
              </Link>
              <Link
                href="/how-it-works"
                className="text-sm font-medium text-primary transition-colors hover:text-accent-foreground"
              >
                See how it works
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
