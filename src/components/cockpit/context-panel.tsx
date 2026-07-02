import Link from "next/link";
import { ShieldAlert, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { WorkspaceContext } from "@/lib/workspace";
import { getVisibleTools } from "@/lib/tools/registry";
import { getVertical } from "@/lib/verticals/registry";
import { countPendingApprovals } from "@/lib/services/approvals";

const RISK_LABEL: Record<string, string> = { read: "read-only", draft: "drafts", write: "needs approval" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

export async function AssistantContextPanel({
  ctx,
  slug,
}: {
  ctx: WorkspaceContext;
  slug: string;
}) {
  const tools = getVisibleTools(ctx);
  const vertical = getVertical(ctx.workspace.vertical);
  const pending = await countPendingApprovals(ctx);

  const byCategory = tools.reduce<Record<string, { count: number; risks: Set<string> }>>((acc, t) => {
    acc[t.category] ??= { count: 0, risks: new Set() };
    acc[t.category].count++;
    acc[t.category].risks.add(t.risk);
    return acc;
  }, {});

  return (
    <aside className="hidden w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l bg-card px-4 py-4 xl:flex">
      <Section title="Workspace">
        <div className="rounded-lg border border-border p-3 text-sm">
          <div className="font-medium">{ctx.workspace.name}</div>
          <div className="mt-1 flex items-center gap-1.5">
            <Badge variant="outline" className="capitalize">{ctx.member.role}</Badge>
            <Badge variant="primary">{vertical ? vertical.label : "Generic"}</Badge>
          </div>
        </div>
      </Section>

      <Section title="Approvals">
        <Link
          href={`/${slug}/approvals`}
          className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted"
        >
          <span className="flex items-center gap-2 text-sm">
            <ShieldAlert className={pending > 0 ? "size-4 text-warning" : "size-4 text-muted-foreground"} />
            {pending > 0 ? `${pending} awaiting review` : "Nothing pending"}
          </span>
          <span className="text-xs font-medium text-primary">Open →</span>
        </Link>
      </Section>

      <Section title="What I can do">
        <div className="space-y-1">
          {Object.entries(byCategory).map(([cat, info]) => (
            <div
              key={cat}
              className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-xs"
            >
              <span className="flex items-center gap-1.5 capitalize">
                <Wrench className="size-3 text-muted-foreground" />
                {cat}
              </span>
              <span className="text-muted-foreground">
                {info.count} {[...info.risks].map((r) => RISK_LABEL[r] ?? r).join(", ")}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Sensitive actions are prepared and queued for your approval — never sent automatically.
        </p>
      </Section>
    </aside>
  );
}
