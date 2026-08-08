import type { Metadata } from "next";
import Link from "next/link";
import {
  ClipboardCheck,
  History,
  Inbox,
  ListChecks,
  Route,
  UserCheck,
  Users,
  Webhook,
} from "lucide-react";

export const metadata: Metadata = {
  alternates: { canonical: "/product" },
  openGraph: {
    type: "website",
    siteName: "Operanto",
    url: "/product",
    title: "Product",
    description: "One cockpit for conversations, customers, opportunities, tasks, and the people responsible for them — with AI assistance that proposes and people who decide.",
  },
  title: "Product",
  description:
    "One cockpit for conversations, customers, opportunities, tasks, and the people responsible for them — with AI assistance that proposes and people who decide.",
};

const features = [
  {
    icon: Inbox,
    title: "Conversations in one stream",
    detail:
      "Customer conversations live next to the records they concern. Whoever opens a thread sees what was said before, by whom, and what remains open.",
  },
  {
    icon: Users,
    title: "Customers with memory",
    detail:
      "A customer record accumulates every inquiry, conversation, and opportunity over time. Returning customers are recognized, not re-registered.",
  },
  {
    icon: Route,
    title: "Opportunities from real events",
    detail:
      "Opportunities are created and updated from what actually happened in your source systems — not from manual data entry that drifts out of date.",
  },
  {
    icon: ListChecks,
    title: "Tasks with due times",
    detail:
      "Every open item becomes a follow-up task with a due time. The question is never whether something will be followed up, only when and by whom.",
  },
  {
    icon: UserCheck,
    title: "Named responsibility",
    detail:
      "Each customer, opportunity, and task has a responsible person. Roles define what staff can see and do inside their organisation.",
  },
  {
    icon: ClipboardCheck,
    title: "AI assistance, human decisions",
    detail:
      "The assistant summarizes context, drafts replies, and suggests next steps. A person reviews, edits, and approves — nothing reaches a customer on its own.",
  },
  {
    icon: Webhook,
    title: "Source systems stay in charge",
    detail:
      "Operanto connects to the systems you already run through signed, verified events. They remain the system of record; Operanto adds the operational layer.",
  },
  {
    icon: History,
    title: "A full audit trail",
    detail:
      "Every action — human or assisted — is recorded: who did what, when, and to which record. Accountability is built in, not bolted on.",
  },
] as const;

export default function ProductPage() {
  return (
    <>
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 pb-16 pt-20 sm:pb-20 sm:pt-28">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Product
          </p>
          <h1 className="mt-5 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            One cockpit for the work between systems and people.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Customer operations usually live in fragments: an inbox here, a
            spreadsheet there, a system of record nobody checks in the moment.
            Operanto brings the operational picture — who, what, and what next —
            into one place, without replacing the systems underneath it.
          </p>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <div className="grid gap-x-12 gap-y-12 md:grid-cols-2">
            {features.map((feature) => (
              <div key={feature.title} className="flex gap-4">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                  <feature.icon
                    aria-hidden
                    className="h-4 w-4 text-primary"
                    strokeWidth={1.5}
                  />
                </div>
                <div>
                  <h2 className="text-base font-semibold">{feature.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {feature.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
            What we are building next
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            These are real and running, but not yet switched on for customers.
            We would rather tell you where they stand than imply you can buy
            them today.
          </p>
          <div className="mt-10 grid gap-8 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-6">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-base font-semibold">Growth</h3>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  In development
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Brand and campaign tooling that works from the same customer
                context as everything else, so outreach knows what already
                happened with a person. Drafting and approval are separate
                acts here too — nothing goes out because software decided it
                should.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-6">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-base font-semibold">Computer</h3>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  In supervised validation
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Plenty of real work lives in software with no usable API — a
                carrier portal, a bank screen, an old internal application. You
                log in yourself and share the tab. Operanto reads the page,
                combines it with what it already knows about the customer and
                the case, and tells you where to look next.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                It can then open <em>one</em> link — but only the specific link
                you approved, only on the same site, and only after you say so.
                Then it checks where the page actually landed and stops. It
                cannot type, submit a form, move money, or change your
                security settings, and it never sees your password for the
                other system.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_1fr]">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Built around one rule: AI proposes, people decide.
              </h2>
              <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground">
                We think the useful place for AI in customer operations is
                before the decision, not instead of it. The assistant reads the
                context a person would otherwise assemble by hand — the
                history, the open items, the source event — and proposes what
                to do with it. The person stays the author of every message and
                the owner of every commitment.
              </p>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
                That is why there are no autonomous replies in Operanto, and why
                every assisted action lands in the same audit trail as a manual
                one.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-6 sm:p-8">
              <p className="text-sm font-semibold">
                What the assistant does
              </p>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
                <li>Summarizes a customer’s history before you open the thread</li>
                <li>Drafts replies you can edit, approve, or discard</li>
                <li>Suggests the next step and a due time for it</li>
                <li>Answers questions about your own operational data</li>
              </ul>
              <p className="mt-6 border-t border-border pt-4 text-sm font-semibold">
                What it never does
              </p>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
                <li>Send a message to a customer on its own</li>
                <li>Close, reassign, or commit anything without approval</li>
                <li>Act outside the organisation and role of the signed-in user</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <h2 className="text-2xl font-semibold tracking-tight">
            See the journey of a single inquiry
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            The clearest way to understand Operanto is to follow one event from
            the source system to a resolved follow-up.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Link
              href="/how-it-works"
              className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              How it works
            </Link>
            <Link
              href="/security"
              className="text-sm font-medium text-primary transition-colors hover:text-accent-foreground"
            >
              Read about security
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
