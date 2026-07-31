import type { Metadata } from "next";
import Link from "next/link";
import {
  EyeOff,
  History,
  KeyRound,
  Lock,
  Repeat,
  ShieldCheck,
  Signature,
  UserCheck,
} from "lucide-react";

export const metadata: Metadata = {
  alternates: { canonical: "/security" },
  openGraph: {
    type: "website",
    siteName: "Operanto",
    url: "/security",
    title: "Security",
    description: "The security model as it is built: invitation-only access, organisation-scoped authorization on every request, signed webhooks with replay protection, encrypted secrets, and a full audit trail.",
  },
  title: "Security",
  description:
    "The security model as it is built: invitation-only access, organisation-scoped authorization on every request, signed webhooks with replay protection, encrypted secrets, and a full audit trail.",
};

const controls = [
  {
    icon: KeyRound,
    title: "Invitation-only access",
    detail:
      "There is no self-serve signup. An account exists because an administrator of an organisation invited that specific person. Access starts closed and is opened deliberately.",
  },
  {
    icon: ShieldCheck,
    title: "Organisation-scoped authorization, re-checked per request",
    detail:
      "Operanto is multi-tenant, and every request re-verifies that the signed-in user belongs to the organisation that owns the data being touched. Scoping is enforced on each request, not assumed from a session.",
  },
  {
    icon: UserCheck,
    title: "Role-based permissions",
    detail:
      "What a user can see and do is bound to their role within their organisation. Responsibility in the product maps to permission in the system.",
  },
  {
    icon: Signature,
    title: "Signed webhooks with replay protection",
    detail:
      "Inbound events must carry a valid HMAC-SHA256 signature over the payload, computed with a per-integration secret. Deliveries are timestamped; stale or replayed deliveries are rejected before any processing happens.",
  },
  {
    icon: Repeat,
    title: "Idempotent event processing",
    detail:
      "Each event is processed exactly once. A network retry, a duplicate delivery, or a replay attempt cannot create duplicate customers, leads, or tasks.",
  },
  {
    icon: Lock,
    title: "Encrypted integration secrets",
    detail:
      "Secrets used to verify and connect integrations are stored encrypted with AES-256-GCM at the application layer, not kept in plaintext at rest.",
  },
  {
    icon: History,
    title: "Full audit trail",
    detail:
      "Actions are recorded with who performed them, when, and against which record — including AI-assisted actions, which are audited the same way as manual ones.",
  },
  {
    icon: EyeOff,
    title: "Session revocation",
    detail:
      "Sessions can be revoked server-side. When access is withdrawn, it ends — without waiting for a token to expire on its own.",
  },
] as const;

export default function SecurityPage() {
  return (
    <>
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 pb-16 pt-20 sm:pb-20 sm:pt-28">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Security
          </p>
          <h1 className="mt-5 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            The security model, described as it is built.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Operanto handles customer data on behalf of the organisations that
            trust it. This page describes the concrete controls in the system —
            not an abstraction of them, and not badges we have not earned.
          </p>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <div className="grid gap-x-12 gap-y-12 md:grid-cols-2">
            {controls.map((control) => (
              <div key={control.title} className="flex gap-4">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                  <control.icon
                    aria-hidden
                    className="h-4 w-4 text-primary"
                    strokeWidth={1.5}
                  />
                </div>
                <div>
                  <h2 className="text-base font-semibold">{control.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {control.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
          <div className="rounded-lg border border-border bg-card p-8 sm:p-10">
            <h2 className="text-xl font-semibold tracking-tight">
              What we do not claim
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              We do not display compliance logos or certifications here. If a
              specific certification or assessment matters to your
              organisation, ask us directly where we stand — we will give you a
              straight answer.
            </p>
            <div className="mt-6">
              <Link
                href="/contact"
                className="text-sm font-medium text-primary transition-colors hover:text-accent-foreground"
              >
                Ask a security question
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
