import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  alternates: { canonical: "/real-estate" },
  openGraph: {
    type: "website",
    siteName: "Operanto",
    url: "/real-estate",
    title: "For real estate",
    description: "Property inquiries become leads with full context: the person, the property, the source, and a follow-up with a due time. Pronatona is the first implementation, in progress.",
  },
  title: "For real estate",
  description:
    "Property inquiries become leads with full context: the person, the property, the source, and a follow-up with a due time. Pronatona is the first implementation, in progress.",
};

const realities = [
  {
    title: "Inquiries are perishable",
    detail:
      "Someone asking about an apartment today is comparing options this week, not this quarter. An inquiry that waits in an inbox loses value by the hour.",
  },
  {
    title: "Context is scattered",
    detail:
      "The listing lives on the website, the conversation in someone’s phone, the history in someone’s memory. When an agent is away, the thread often goes with them.",
  },
  {
    title: "Buyers come back",
    detail:
      "The person asking about a two-bedroom this month asked about a studio last spring. Treating them as a new lead every time discards the most useful thing you know.",
  },
] as const;

const outcomes = [
  {
    title: "Every inquiry becomes a lead with context",
    detail:
      "A property inquiry on the website arrives in Operanto as a signed event and becomes a lead that carries the person, the property, and the source with it — nothing retyped, nothing lost in transit.",
  },
  {
    title: "Returning buyers are recognized",
    detail:
      "When the same person inquires again, the lead continues an existing relationship instead of starting a duplicate. The agent sees every earlier inquiry before replying.",
  },
  {
    title: "Follow-ups have names and due times",
    detail:
      "Each lead is assigned to a responsible agent with a follow-up task and a due time. Whether it happened is visible to the office, not a private matter of diligence.",
  },
  {
    title: "The website remains the system of record",
    detail:
      "Listings and inquiries stay where they are managed today. Operanto adds the operational layer — memory, assignment, follow-through — around them.",
  },
] as const;

export default function RealEstatePage() {
  return (
    <>
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 pb-16 pt-20 sm:pb-20 sm:pt-28">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            For real estate
          </p>
          <h1 className="mt-5 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            From property inquiry to a lead someone owns.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Real estate runs on inquiries: high intent, time-sensitive, and
            easy to lose between a listing page and an agent’s day. Operanto’s
            first vertical turns each inquiry into a lead with full context and
            a named, dated follow-up.
          </p>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            The operational reality
          </h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {realities.map((item) => (
              <div key={item.title} className="border-t border-border pt-6">
                <h3 className="text-base font-semibold">{item.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            What changes with Operanto
          </h2>
          <div className="mt-10 grid gap-x-12 gap-y-10 md:grid-cols-2">
            {outcomes.map((item) => (
              <div key={item.title}>
                <h3 className="text-base font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <div className="rounded-lg border border-border bg-card p-8 sm:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              First implementation — in progress
            </p>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">
              Pronatona
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Pronatona, a real-estate company, is the first production
              implementation of Operanto. Its property website sends signed
              domain events into Operanto: each property inquiry is verified,
              processed exactly once, and becomes a lead with the property and
              the person attached, assigned to a responsible agent with a
              follow-up task.
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              The implementation is in progress. We would rather report real
              outcomes than projected ones, so this page will describe results
              only when there are results to describe.
            </p>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <h2 className="text-2xl font-semibold tracking-tight">
            Running a real-estate operation?
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Early access is invitation-based, and real estate is where we are
            focused first. Tell us how inquiries reach your team today.
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
              See the event journey
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
