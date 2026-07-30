"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  FileText,
  Home,
  Languages,
  Send,
  Sparkles,
  User,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, relativeTime } from "@/lib/utils";
import { ApprovalCard } from "@/components/cockpit/approval-card";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

type Block =
  | { type: "text"; text: string }
  | {
      type: "tool";
      invocationId: string;
      toolName: string;
      title: string;
      category: string;
      risk: string;
      status: string;
      card: string;
      data: Any;
      summary: string;
    }
  | {
      type: "approval";
      approvalId: string;
      invocationId: string;
      toolName: string;
      title: string;
      summary: string;
      risk: string;
      status: string;
      card: string;
      data: Any;
    }
  | { type: "error"; code: string; message: string; toolName?: string };

function money(v: number | null | undefined, currency = "EUR"): string {
  if (v == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${v} ${currency}`;
  }
}

const PROPERTY_STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "default"> = {
  available: "success",
  reserved: "warning",
  under_offer: "warning",
  sold: "danger",
  off_market: "default",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex justify-between gap-3 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function MiniLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
    >
      {children}
      <ArrowRight className="size-3" />
    </Link>
  );
}

// ── record renderers ──────────────────────────────────────────

function ContactList({ data, slug }: { data: Any; slug: string }) {
  void slug;
  if (!data?.contacts?.length) return <Empty label="No contacts matched." />;
  return (
    <div className="space-y-1.5">
      {data.contacts.map((c: Any) => (
        <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2.5 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{c.name ?? "Unknown"}</div>
            <div className="truncate text-xs text-muted-foreground">
              {[c.location, c.email, c.phone].filter(Boolean).join(" · ") || "No details"}
            </div>
          </div>
          <Badge variant="outline">{c.conversationCount} conv.</Badge>
        </div>
      ))}
    </div>
  );
}

function ConversationList({ data, slug }: { data: Any; slug: string }) {
  if (!data?.conversations?.length) return <Empty label="No conversations matched." />;
  return (
    <div className="space-y-1.5">
      {data.conversations.map((c: Any) => (
        <div key={c.id} className="rounded-md border border-border bg-card px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {c.customerName ?? c.subject ?? "Conversation"}
              </div>
              <div className="truncate text-xs text-muted-foreground">{c.summary ?? c.subject ?? "—"}</div>
            </div>
            <MiniLink href={`/${slug}/inbox/${c.id}`}>Open</MiniLink>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="capitalize">{c.channelType}</Badge>
            <Badge variant="default" className="capitalize">{String(c.status).replace("_", " ")}</Badge>
            {typeof c.leadScore === "number" && c.leadScore >= 70 && (
              <Badge variant="warning">Lead {c.leadScore}</Badge>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ConversationSummary({ data }: { data: Any }) {
  return (
    <div className="space-y-1.5 text-sm">
      <p>{data.summary}</p>
      <p className="text-xs">
        <span className="font-semibold text-foreground">Next: </span>
        <span className="text-muted-foreground">{data.recommendedNextAction}</span>
      </p>
      {data.unresolvedQuestion && (
        <p className="text-xs text-muted-foreground">Open question: {data.unresolvedQuestion}</p>
      )}
    </div>
  );
}

function OpportunityList({ data, slug }: { data: Any; slug: string }) {
  const items = data.opportunities ?? (data.opportunity ? [data.opportunity] : []);
  if (!items.length) return <Empty label="No opportunities matched." />;
  return (
    <div className="space-y-1.5">
      {items.map((o: Any) => (
        <div key={o.id} className="rounded-md border border-border bg-card px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{o.title}</div>
              <div className="truncate text-xs text-muted-foreground">
                {[o.contactName, o.ownerName ? `owner ${o.ownerName}` : null].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold">{money(o.value, o.currency)}</div>
              <Badge variant="primary" className="capitalize">{o.stage}</Badge>
            </div>
          </div>
          {o.requirements && (
            <div className="mt-1 text-xs text-muted-foreground">
              {[
                o.requirements.budgetMax ? `≤ ${money(o.requirements.budgetMax, o.currency)}` : null,
                o.requirements.locations?.length ? o.requirements.locations.join(", ") : null,
                o.requirements.timeline,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}
          <div className="mt-1.5">
            <MiniLink href={`/${slug}/opportunities`}>Open pipeline</MiniLink>
          </div>
        </div>
      ))}
    </div>
  );
}

function PropertyList({ data, slug }: { data: Any; slug: string }) {
  const items = data.properties ?? (data.property ? [data.property] : []);
  if (!items.length) return <Empty label="No properties matched." />;
  return (
    <div className="space-y-2">
      {data.basis && <p className="text-xs text-muted-foreground">Matched on: {data.basis}</p>}
      {items.map((p: Any) => (
        <PropertyDetail key={p.id} data={{ property: p }} slug={slug} compact />
      ))}
    </div>
  );
}

function PropertyDetail({ data, slug, compact }: { data: Any; slug: string; compact?: boolean }) {
  const p = data.property ?? data;
  if (!p) return <Empty label="Property not found." />;
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Home className="size-3.5 text-muted-foreground" />
            <span className="text-sm font-semibold">{p.code}</span>
            <span className="truncate text-xs text-muted-foreground">
              {[p.district, p.city].filter(Boolean).join(", ")}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{p.title}</div>
        </div>
        <Badge variant={PROPERTY_STATUS_VARIANT[p.status] ?? "default"} className="capitalize">
          {String(p.status).replace("_", " ")}
        </Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-base font-semibold">{money(p.price, p.currency)}</span>
        {p.areaSqm && <span className="text-xs text-muted-foreground">{p.areaSqm} m²</span>}
        {typeof p.bedrooms === "number" && (
          <span className="text-xs text-muted-foreground">{p.bedrooms} bd</span>
        )}
        {typeof p.bathrooms === "number" && (
          <span className="text-xs text-muted-foreground">{p.bathrooms} ba</span>
        )}
        <Badge variant="outline" className="capitalize">{p.type}</Badge>
        <Badge variant="outline" className="capitalize">{p.listingType}</Badge>
      </div>
      {!compact && p.availabilityNote && (
        <p className="mt-1.5 text-xs text-muted-foreground">{p.availabilityNote}</p>
      )}
      <div className="mt-2">
        <MiniLink href={`/${slug}/properties`}>Open catalogue</MiniLink>
      </div>
    </div>
  );
}

function PropertyAvailability({ data }: { data: Any }) {
  if (!data.found) return <Empty label="Property not found in the catalogue." />;
  const available = data.available;
  return (
    <div
      className={cn(
        "rounded-md border p-3",
        available ? "border-success/40 bg-success/5" : "border-danger/40 bg-danger/5",
      )}
    >
      <div className="flex items-center gap-2">
        {available ? (
          <CheckCircle2 className="size-4 text-success" />
        ) : (
          <XCircle className="size-4 text-danger" />
        )}
        <span className="text-sm font-semibold">{data.code}</span>
        <Badge variant={available ? "success" : "danger"} className="capitalize">
          {String(data.status).replace("_", " ")}
        </Badge>
      </div>
      <p className="mt-1.5 text-sm">
        {available
          ? "Currently marked available in the catalogue."
          : "Not available — do not offer as available."}
      </p>
      <dl className="mt-2 space-y-0.5">
        <Field label="Price" value={money(data.price, data.currency ?? "EUR")} />
        <Field label="Last updated" value={data.lastUpdated ? relativeTime(data.lastUpdated) : null} />
      </dl>
    </div>
  );
}

function TaskDetail({ data, slug }: { data: Any; slug: string }) {
  const t = data.task ?? data;
  return (
    <div className="rounded-md border border-border bg-card px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{t.title}</span>
        <Badge variant="primary" className="capitalize">{String(t.status).replace("_", " ")}</Badge>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {t.dueAt ? `Due ${new Date(t.dueAt).toLocaleDateString()}` : "No due date"}
        </span>
        <MiniLink href={`/${slug}/tasks`}>Open tasks</MiniLink>
      </div>
    </div>
  );
}

function SocialDraft({ data }: { data: Any }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-primary" />
        <span className="text-sm font-semibold">{data.title}</span>
        <Badge variant="outline" className="capitalize">{data.channel}</Badge>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-xs">{data.body}</p>
      {data.hashtags?.length > 0 && (
        <p className="mt-1.5 text-xs text-primary">{data.hashtags.map((h: string) => `#${h}`).join(" ")}</p>
      )}
      <p className="mt-2 text-xs font-medium text-muted-foreground">Draft — not published.</p>
    </div>
  );
}

function SocialQueued({ data }: { data: Any }) {
  return (
    <div className="rounded-md border border-success/40 bg-success/5 p-3">
      <div className="flex items-center gap-1.5">
        <BadgeCheck className="size-4 text-success" />
        <span className="text-sm font-semibold capitalize">{data.channel} post queued</span>
      </div>
      <dl className="mt-1.5 space-y-0.5">
        <Field label="Publish at" value={new Date(data.scheduledAt).toLocaleString()} />
        <Field label="Adapter" value={data.adapter} />
        <Field label="Reference" value={data.externalRef} />
      </dl>
      {data.adapter === "mock" && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Mock publisher — no external platform received this (no live connector configured).
        </p>
      )}
    </div>
  );
}

function ViewingRequest({ data }: { data: Any }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center gap-1.5">
        <CalendarClock className="size-3.5 text-muted-foreground" />
        <span className="text-sm font-semibold">Viewing invitation — {data.propertyCode}</span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-xs">{data.body}</p>
      <p className="mt-2 text-xs font-medium text-muted-foreground">Draft — not sent.</p>
    </div>
  );
}

function ViewingScheduled({ data }: { data: Any }) {
  return (
    <div className="rounded-md border border-success/40 bg-success/5 p-3">
      <div className="flex items-center gap-1.5">
        <CheckCircle2 className="size-4 text-success" />
        <span className="text-sm font-semibold">Viewing booked — {data.propertyCode}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{new Date(data.at).toLocaleString()}</p>
    </div>
  );
}

function AgentAvailability({ data }: { data: Any }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-sm font-semibold">
        Suggested slots{data.agentName ? ` — ${data.agentName}` : ""}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {data.slots?.map((s: Any) => (
          <Badge key={s.at} variant="outline">{s.label}</Badge>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{data.note}</p>
    </div>
  );
}

function MessageDraft({ data, slug }: { data: Any; slug: string }) {
  const riskVariant = data.risk === "high" ? "danger" : data.risk === "medium" ? "warning" : "success";
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center gap-1.5">
        <FileText className="size-3.5 text-muted-foreground" />
        <span className="text-sm font-semibold capitalize">{data.channel} reply draft</span>
        <Badge variant={riskVariant as "danger" | "warning" | "success"}>{data.risk} risk</Badge>
        {typeof data.confidence === "number" && (
          <Badge variant="outline">{Math.round(data.confidence * 100)}%</Badge>
        )}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-xs">{data.body}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Draft — not sent.</span>
        {data.conversationId && <MiniLink href={`/${slug}/inbox/${data.conversationId}`}>Open conversation</MiniLink>}
      </div>
    </div>
  );
}

function MessageTranslation({ data }: { data: Any }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center gap-1.5">
        <Languages className="size-3.5 text-muted-foreground" />
        <span className="text-sm font-semibold">Translation → {data.targetLanguage}</span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-xs">{data.translated}</p>
    </div>
  );
}

function MessageSent({ data }: { data: Any }) {
  return (
    <div className="rounded-md border border-success/40 bg-success/5 p-3">
      <div className="flex items-center gap-1.5">
        <Send className="size-3.5 text-success" />
        <span className="text-sm font-semibold capitalize">Sent on {data.channel}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Delivered through the channel adapter.</p>
    </div>
  );
}

function ContactDetail({ data }: { data: Any }) {
  const c = data.contact ?? data;
  if (!c) return <Empty label="Contact not found." />;
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center gap-1.5">
        <User className="size-3.5 text-muted-foreground" />
        <span className="text-sm font-semibold">{c.name ?? "Unknown"}</span>
      </div>
      <dl className="mt-1.5 space-y-0.5">
        <Field label="Email" value={c.email} />
        <Field label="Phone" value={c.phone} />
        <Field label="Location" value={c.location} />
        <Field label="Language" value={c.language} />
        <Field label="Conversations" value={c.conversationCount} />
      </dl>
    </div>
  );
}

function GenericRecord({ data }: { data: Any }) {
  const entries = Object.entries(data ?? {}).filter(([, v]) => typeof v !== "object");
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <dl className="space-y-0.5">
        {entries.map(([k, v]) => (
          <Field key={k} label={k} value={String(v)} />
        ))}
      </dl>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="rounded-md border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground">{label}</p>;
}

function renderCard(kind: string, data: Any, slug: string): React.ReactNode {
  switch (kind) {
    case "contact.list":
      return <ContactList data={data} slug={slug} />;
    case "contact.detail":
      return <ContactDetail data={data} />;
    case "conversation.list":
      return <ConversationList data={data} slug={slug} />;
    case "conversation.summary":
      return <ConversationSummary data={data} />;
    case "opportunity.list":
    case "opportunity.detail":
      return <OpportunityList data={data} slug={slug} />;
    case "task.detail":
      return <TaskDetail data={data} slug={slug} />;
    case "property.list":
      return <PropertyList data={data} slug={slug} />;
    case "property.detail":
      return <PropertyDetail data={data} slug={slug} />;
    case "property.availability":
      return <PropertyAvailability data={data} />;
    case "social.draft":
      return <SocialDraft data={data} />;
    case "social.queued":
      return <SocialQueued data={data} />;
    case "viewing.request":
      return <ViewingRequest data={data} />;
    case "viewing.scheduled":
      return <ViewingScheduled data={data} />;
    case "agent.availability":
      return <AgentAvailability data={data} />;
    case "message.draft":
      return <MessageDraft data={data} slug={slug} />;
    case "message.translation":
      return <MessageTranslation data={data} />;
    case "message.sent":
      return <MessageSent data={data} />;
    default:
      return <GenericRecord data={data} />;
  }
}

function ToolCard({ block, slug }: { block: Extract<Block, { type: "tool" }>; slug: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <BadgeCheck className="size-3.5 text-success" />
        <span className="font-medium text-foreground">{block.title}</span>
        <span>·</span>
        <span>{block.summary}</span>
      </div>
      {renderCard(block.card, block.data, slug)}
    </div>
  );
}

function ErrorCard({ block }: { block: Extract<Block, { type: "error" }> }) {
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/5 p-2.5">
      <div className="flex items-center gap-1.5 text-sm font-medium text-danger">
        <AlertTriangle className="size-4" />
        {block.toolName ? `${block.toolName} failed` : "Action failed"}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{block.message} — nothing external happened.</p>
    </div>
  );
}

export function CockpitBlocks({ blocks, slug }: { blocks: Block[]; slug: string }) {
  if (!blocks?.length) return null;
  return (
    <div className="mt-2 space-y-2">
      {blocks.map((b, i) => {
        if (b.type === "error") return <ErrorCard key={i} block={b} />;
        if (b.type === "approval") return <ApprovalCard key={i} slug={slug} block={b} />;
        if (b.type === "tool") return <ToolCard key={i} block={b} slug={slug} />;
        return null;
      })}
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
