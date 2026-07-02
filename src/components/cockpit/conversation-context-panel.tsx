import Link from "next/link";
import { Building2, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/utils";
import type { getConversationContext } from "@/lib/services/conversation-context";

type ContextData = Awaited<ReturnType<typeof getConversationContext>>;

function money(v: number | null | undefined, currency = "EUR") {
  if (v == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${v} ${currency}`;
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

/** Right-hand structured context for a customer-conversation cockpit thread. */
export function ConversationContextPanel({ slug, data }: { slug: string; data: ContextData }) {
  const { conversation: c, opportunity: opp, propertyLinks } = data;
  const req = opp?.requirements as
    | { budgetMin?: number; budgetMax?: number; locations?: string[]; propertyType?: string; bedrooms?: number; timeline?: string }
    | null;

  return (
    <aside className="hidden w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l bg-card px-4 py-4 xl:flex">
      <Section title="Contact">
        <div className="rounded-lg border border-border p-3">
          <div className="text-sm font-medium">{c.customer?.name ?? "Unknown"}</div>
          <dl className="mt-1 space-y-0.5">
            <Row label="Email" value={c.customer?.email} />
            <Row label="Phone" value={c.customer?.phone} />
            <Row label="Location" value={c.customer?.location} />
            <Row label="Language" value={c.customer?.language} />
          </dl>
        </div>
      </Section>

      {opp && (
        <Section title="Opportunity">
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Target className="size-3.5 text-muted-foreground" />
                {opp.title}
              </span>
              <Badge variant="primary" className="capitalize">{opp.stage}</Badge>
            </div>
            <dl className="mt-1.5 space-y-0.5">
              <Row label="Value" value={money(opp.value, opp.currency)} />
              <Row label="Lead score" value={opp.leadScore ?? undefined} />
              <Row label="Budget" value={req?.budgetMax ? `≤ ${money(req.budgetMax, opp.currency)}` : undefined} />
              <Row label="Area" value={req?.locations?.length ? req.locations.join(", ") : undefined} />
              <Row label="Timeline" value={req?.timeline} />
              <Row label="Owner" value={opp.owner?.name} />
            </dl>
            <Link href={`/${slug}/opportunities`} className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
              Open pipeline →
            </Link>
          </div>
        </Section>
      )}

      {propertyLinks.length > 0 && (
        <Section title="Interested property">
          <div className="space-y-1.5">
            {propertyLinks.map((l) => (
              <Link
                key={l.id}
                href={`/${slug}/properties`}
                className="flex items-center justify-between rounded-lg border border-border p-2.5 hover:bg-muted"
              >
                <span className="flex items-center gap-1.5 text-sm">
                  <Building2 className="size-3.5 text-muted-foreground" />
                  {l.label ?? l.recordId}
                </span>
                <span className="text-xs text-muted-foreground">Ask the assistant to check availability</span>
              </Link>
            ))}
          </div>
        </Section>
      )}

      <Section title="Assigned agent">
        <div className="rounded-lg border border-border p-3 text-sm">
          {c.assignedTo?.name ?? "Unassigned"}
        </div>
      </Section>

      {c.tasks.length > 0 && (
        <Section title="Tasks">
          <div className="space-y-1">
            {c.tasks.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-xs">
                <span className="truncate">{t.title}</span>
                <Badge variant="outline" className="capitalize">{t.status.replace("_", " ")}</Badge>
              </div>
            ))}
          </div>
        </Section>
      )}

      {c.internalNotes.length > 0 && (
        <Section title="Internal notes">
          <div className="space-y-1.5">
            {c.internalNotes.map((n) => (
              <div key={n.id} className="rounded-lg bg-warning/10 p-2.5 text-xs">
                <p>{n.body}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {n.user?.name ?? "Someone"} · {relativeTime(n.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}
    </aside>
  );
}
