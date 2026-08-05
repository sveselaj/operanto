import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg } from "@/lib/org-context";
import { getWorkQueue } from "@/lib/services/crm/queue";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatStage } from "@/lib/format";

export const metadata: Metadata = { title: "Work queue" };

/** Human labels for the engine's categories (the engine returns keys only). */
const CATEGORY_LABEL: Record<string, string> = {
  CALLBACK_OVERDUE: "Callback overdue",
  CALLBACK_DUE: "Callback due",
  APPOINTMENT_PREP: "Appointment prep",
  TASK_OVERDUE: "Task overdue",
  NEW_LEAD: "New lead",
  NO_ACTIVITY: "No activity",
  DUE_TODAY: "Due today",
  OTHER_ACTIVE: "Active",
};

function overdueLabel(ms: number | null): string | null {
  if (ms === null) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min overdue`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h overdue`;
  return `${Math.floor(hours / 24)} d overdue`;
}

export default async function WorkQueuePage() {
  const ctx = await requireOrg();
  const queue = await getWorkQueue(ctx);
  const first = queue[0];

  return (
    <>
      <PageHeader
        title="Work queue"
        description="What to do next, in order — overdue callbacks first, then due work, then leads going cold."
      >
        {first ? (
          <Button asChild size="sm">
            <Link href={`/crm/leads/${first.lead.id}`}>Start working</Link>
          </Button>
        ) : null}
      </PageHeader>

      {queue.length === 0 ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          Nothing is due right now. Leads with a future callback rest until their
          time comes.
        </div>
      ) : (
        <ol className="divide-y divide-border rounded-lg border border-border bg-card">
          {queue.map((entry, index) => (
            <li key={entry.lead.id} className="flex items-center gap-3 px-4 py-3">
              <span className="w-6 shrink-0 text-xs text-muted-foreground">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/crm/leads/${entry.lead.id}`}
                  className="font-medium hover:underline"
                >
                  {entry.lead.fullName}
                </Link>
                {entry.lead.companyName ? (
                  <span className="ml-2 text-sm text-muted-foreground">
                    {entry.lead.companyName}
                  </span>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {formatStage(entry.lead.status)}
                  {entry.lead.phone ? ` · ${entry.lead.phone}` : ""}
                  {entry.dueAt ? ` · due ${formatDateTime(entry.dueAt)}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {entry.overdueMs ? (
                  <span className="text-xs text-danger">{overdueLabel(entry.overdueMs)}</span>
                ) : null}
                <Badge variant="outline">
                  {CATEGORY_LABEL[entry.category] ?? entry.category}
                </Badge>
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
