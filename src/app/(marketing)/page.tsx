import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: {
    absolute: "Operanto — Customer operations that remember, continue, and resolve",
  },
  description:
    "Operanto is the operational cockpit between your source systems and the people who run customer operations. Every inquiry arrives with its history, and every commitment has a name and a due time.",
};

const journey = [
  {
    title: "Source system",
    detail: "A customer inquires on your website or line-of-business system.",
  },
  {
    title: "Signed event",
    detail: "The inquiry leaves as a signed domain event — verified, stored once.",
  },
  {
    title: "Operanto",
    detail: "Customer and opportunity records update with full history.",
  },
  {
    title: "Responsible person",
    detail: "Someone sees the context and a follow-up task with a due time.",
  },
] as const;

const pillars = [
  {
    name: "Recognize",
    detail:
      "A returning customer is never a stranger. New inquiries are matched to the people and opportunities already on record, so context arrives before the conversation starts.",
  },
  {
    name: "Resume",
    detail:
      "Work continues where it stopped. Conversations, opportunities, and tasks carry their full history with them — whoever picks them up, whenever they pick them up.",
  },
  {
    name: "Resolve",
    detail:
      "Nothing trails off. Every open item has a responsible person and a follow-up with a due time until it is closed, and every action along the way is on the record.",
  },
] as const;

export default function HomePage() {
  return (
    <>
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 pb-20 pt-24 sm:pb-24 sm:pt-32">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            The operational cockpit for customer operations
          </p>
          <h1 className="mt-5 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Customer operations that remember, continue, and resolve.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Operanto sits between your source systems and the people who answer
            for your customers. Every inquiry arrives with its history, every
            conversation can be picked up where it left off, and every
            commitment has a name and a due time next to it.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Sign in
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center rounded-md border border-border bg-card px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              Contact
            </Link>
            <p className="w-full text-sm text-muted-foreground">
              Sign-in leads to the Operanto staging environment. Access is by
              invitation while the first implementation is in progress.
            </p>
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <h2 className="text-sm font-medium text-muted-foreground">
            From inquiry to resolution, one continuous line
          </h2>
          <div className="mt-8 grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
            {journey.map((stage, index) => (
              <div key={stage.title} className="contents">
                {index > 0 ? (
                  <div className="hidden items-center justify-center md:flex">
                    <ArrowRight
                      aria-hidden
                      className="h-4 w-4 text-muted-foreground"
                      strokeWidth={1.5}
                    />
                  </div>
                ) : null}
                <div className="rounded-lg border border-border bg-card p-5">
                  <p className="text-sm font-semibold">{stage.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {stage.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Your source systems remain the system of record. Operanto adds
            memory and follow-through around them.
          </p>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
            Recognize. Resume. Resolve.
          </h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {pillars.map((pillar) => (
              <div key={pillar.name} className="border-t border-border pt-6">
                <h3 className="text-base font-semibold text-primary">
                  {pillar.name}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {pillar.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                What Operanto is
              </h2>
              <ul className="mt-6 space-y-5">
                <li className="text-sm leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">
                    An operational cockpit.
                  </span>{" "}
                  One place where conversations, customers, opportunities,
                  tasks, and the people responsible for them meet.
                </li>
                <li className="text-sm leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">
                    A continuity layer.
                  </span>{" "}
                  Signed events from your source systems become durable
                  customer and opportunity records that keep their history.
                </li>
                <li className="text-sm leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">
                    An integration layer around your source systems.
                  </span>{" "}
                  They remain the system of record. Operanto receives what they
                  emit and turns it into work a person can act on.
                </li>
                <li className="text-sm leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Human-in-the-loop AI.
                  </span>{" "}
                  Assistance that drafts, summarizes, and suggests — a person
                  reviews and decides before anything reaches a customer.
                </li>
              </ul>
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                What Operanto is not
              </h2>
              <ul className="mt-6 space-y-5">
                <li className="text-sm leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Not a CRM replacement.
                  </span>{" "}
                  We do not ask you to migrate your data or abandon the systems
                  your business already runs on.
                </li>
                <li className="text-sm leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Not a chatbot builder.
                  </span>{" "}
                  Operanto does not put a bot between you and your customers.
                </li>
                <li className="text-sm leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">
                    No autonomous AI replies.
                  </span>{" "}
                  Nothing is sent to a customer without a person choosing to
                  send it. Responsibility stays human.
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
              Early access is invitation-based
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Operanto is deployed with a small number of organisations at a
              time, starting with real estate. If the way your customer
              operations run today loses context between systems and people, we
              would like to hear about it.
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
