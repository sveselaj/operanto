import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About",
  description:
    "Operanto is a European technology company building the operations layer between source systems and the people who run customer operations.",
};

const beliefs = [
  {
    title: "Systems of record should stay where they are",
    detail:
      "The answer to fragmented operations is rarely another migration. We build around the systems a business already trusts, and add the layer they are missing: operational memory and follow-through.",
  },
  {
    title: "Responsibility is human",
    detail:
      "Software can carry context, propose actions, and keep the record straight. It should not answer customers on its own. In Operanto, every commitment has a person’s name on it.",
  },
  {
    title: "Say only what is true",
    detail:
      "No invented customer counts, no projected results presented as achieved ones, no badges we have not earned. We would rather have a shorter page that is accurate.",
  },
] as const;

export default function AboutPage() {
  return (
    <>
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 pb-16 pt-20 sm:pb-20 sm:pt-28">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            About
          </p>
          <h1 className="mt-5 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            The operations layer between systems and people.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Operanto is a European technology company. We build the layer
            between source systems — websites, line-of-business software,
            systems of record — and the people who run customer operations on
            top of them.
          </p>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Why this layer needs to exist
            </h2>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
              Most businesses do not lack systems. They lack continuity between
              them: the inquiry lives in one place, the conversation in
              another, the follow-up in someone’s head. When a person is away
              or a tool changes, the operation forgets — and the customer
              feels it.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              We are building Operanto so that customer operations remember by
              default: every event verified and kept, every relationship
              continuous, every open item owned by someone until it is
              resolved. We work vertical by vertical, starting with real
              estate, implementing alongside the organisations that use it.
            </p>
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            What we hold ourselves to
          </h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {beliefs.map((belief) => (
              <div key={belief.title} className="border-t border-border pt-6">
                <h3 className="text-base font-semibold">{belief.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {belief.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <h2 className="text-2xl font-semibold tracking-tight">
            Talk to us
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            If this way of working matches how you want your customer
            operations to run, we would like to hear from you.
          </p>
          <div className="mt-6">
            <Link
              href="/contact"
              className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Contact
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
