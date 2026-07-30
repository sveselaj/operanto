import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Follow one inquiry from a source system to a resolved follow-up: a signed domain event, verified and processed exactly once, becomes context and a task for a responsible person.",
};

const steps = [
  {
    title: "An inquiry happens on the source system",
    detail:
      "A customer asks about something where your business already lives — say, a property website. Someone requests a viewing of a two-bedroom apartment. That system is where the inquiry originates, and it remains the system of record for it.",
  },
  {
    title: "The source system emits a signed domain event",
    detail:
      "Instead of an email that gets lost or a row that nobody watches, the source system sends Operanto a domain event — for example, “property inquiry received” — signed with HMAC-SHA256 and timestamped, addressed to the organisation that owns the data.",
  },
  {
    title: "Operanto verifies, stores, and processes it exactly once",
    detail:
      "The signature is verified before anything else happens. Stale timestamps and replayed deliveries are rejected. Processing is idempotent, so a retried delivery can never become a duplicate customer or a duplicate lead.",
  },
  {
    title: "Customer and opportunity projections update",
    detail:
      "The event updates Operanto’s projections: a new customer is created, or a returning one is recognized and their history extended. An opportunity opens or continues — the same person asking about a second property is one relationship, not two records.",
  },
  {
    title: "The responsible person sees context, not a notification",
    detail:
      "Whoever is responsible sees the whole picture in one view: who the customer is, what they asked, which property it concerns, where the inquiry came from, and what should happen next — with a follow-up task carrying a due time.",
  },
  {
    title: "Every action is audited",
    detail:
      "From the moment the event is received to the moment the follow-up is closed, each action is recorded — who did it, when, and to which record. The history of an inquiry is never a matter of memory.",
  },
] as const;

export default function HowItWorksPage() {
  return (
    <>
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 pb-16 pt-20 sm:pb-20 sm:pt-28">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            How it works
          </p>
          <h1 className="mt-5 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            The journey of one inquiry, end to end.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Operanto is easiest to understand by following a single event from
            the system where it starts to the person who resolves it. Nothing
            in this journey depends on anyone remembering to copy data across
            systems.
          </p>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <ol className="relative max-w-3xl space-y-12 border-l border-border pl-10">
            {steps.map((step, index) => (
              <li key={step.title} className="relative">
                <span className="absolute -left-[3.25rem] flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-sm font-semibold text-primary">
                  {index + 1}
                </span>
                <h2 className="text-base font-semibold">{step.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {step.detail}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <div className="grid gap-10 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-6 sm:p-8">
              <h2 className="text-base font-semibold">
                Why signed events, not integrations that poll
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                A signed event states a fact: this happened, in this system, at
                this time, for this organisation. Because each delivery is
                verified and processed exactly once, the operational picture in
                Operanto can be trusted without anyone reconciling it by hand.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-6 sm:p-8">
              <h2 className="text-base font-semibold">
                Why the source system stays the system of record
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Your listings, orders, or bookings belong where they are.
                Operanto projects them into an operational view — customers,
                opportunities, tasks — without claiming ownership of the data
                or asking you to migrate anything.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <h2 className="text-2xl font-semibold tracking-tight">
            The first vertical is real estate
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Property inquiries are exactly the kind of event this journey was
            built for: high intent, perishable, and easy to lose between a
            website and an agent’s day.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Link
              href="/real-estate"
              className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Operanto for real estate
            </Link>
            <Link
              href="/security"
              className="text-sm font-medium text-primary transition-colors hover:text-accent-foreground"
            >
              The security model behind this
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
