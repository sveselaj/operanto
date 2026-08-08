import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Operanto",
    url: "/",
    title: {
    absolute: "Operanto — Customer operations that remember, continue, and resolve",
  },
    description: "Operanto is the operational cockpit between your source systems and the people who run customer operations. Every inquiry arrives with its history, and every commitment has a name and a due time.",
  },
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

/**
 * The public capability model (docs/operanto-product-architecture.md).
 * `status` is deliberately part of the data: a capability a customer
 * cannot switch on today is never presented as if they could.
 */
const capabilities = [
  {
    name: "Memory",
    status: "available",
    detail:
      "Customer identity and history, organisational knowledge, and the record of what was said, promised, and decided.",
  },
  {
    name: "Conversations",
    status: "available",
    detail:
      "Customer messages in one stream beside the records they concern, with assignment, internal notes, and handover between people.",
  },
  {
    name: "Workflows",
    status: "available",
    detail:
      "Tasks, approvals, assignments, and follow-ups with due times — every step audited.",
  },
  {
    name: "Intelligence",
    status: "available",
    detail:
      "Summaries, classification, drafted replies, and suggested next steps. A person reviews and decides before anything reaches a customer.",
  },
  {
    name: "Integrations",
    status: "available",
    detail:
      "Signed events from the systems that already run your business. They stay the system of record.",
  },
  {
    name: "Growth",
    status: "development",
    detail:
      "Brand and campaign tooling for outreach, built on the same customer context. In development.",
  },
  {
    name: "Computer",
    status: "validation",
    detail:
      "For software with no usable API: you share a browser tab, Operanto reads the page and recommends where to look next, and — only with your explicit approval — opens one link and verifies where it landed. In supervised validation, not generally available.",
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
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            It remembers who the customer is, what was promised, and what is
            still open — then helps the responsible person do the next piece of
            work in the systems they already use. People approve; Operanto
            keeps the record.
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
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
            What Operanto does
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            One product, organised as capabilities. We say plainly which of
            them you can use today and which are still being built — a
            capability you cannot switch on is not a feature we will sell you.
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {capabilities.map((capability) => (
              <div
                key={capability.name}
                className="rounded-lg border border-border bg-card p-5"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-base font-semibold">{capability.name}</h3>
                  <span
                    className={
                      capability.status === "available"
                        ? "shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                        : "shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                    }
                  >
                    {capability.status === "available"
                      ? "Available"
                      : capability.status === "development"
                        ? "In development"
                        : "In validation"}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {capability.detail}
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
                <li className="text-sm leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Not an agent that runs off on its own.
                  </span>{" "}
                  Where Operanto can act inside other software, it proposes one
                  step at a time, waits for approval, does exactly that step,
                  and checks the result. It cannot move money, change
                  credentials, or submit forms.
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
              time, starting with{" "}
              <Link
                href="/industries"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                real estate
              </Link>
              . If the way your customer operations run today loses context
              between systems and people, we would like to hear about it.
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
