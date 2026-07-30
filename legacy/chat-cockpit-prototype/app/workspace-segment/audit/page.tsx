import { redirect } from "next/navigation";
import {
  Bot,
  CheckCircle2,
  FileText,
  MessageSquare,
  Send,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { relativeTime } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { listAuditEvents } from "@/lib/services/audit-log";

const DESCRIPTIONS: Record<string, string> = {
  "assistant.thread.created": "Started an assistant chat",
  "assistant.thread.archived": "Archived an assistant chat",
  "assistant.message.created": "Assistant message",
  "assistant.tool.proposed": "Proposed a tool action",
  "assistant.tool.executed": "Ran a tool",
  "assistant.tool.failed": "A tool failed",
  "approval.requested": "Requested approval",
  "approval.approved": "Approved an action",
  "approval.rejected": "Rejected an action",
  "approval.edited": "Edited a proposed action",
  "customer.reply.sent": "Sent a customer message",
  "social.post.queued": "Queued a social post",
  "viewing.scheduled": "Scheduled a viewing",
  "conversation.reply": "Replied to a conversation",
  "task.create": "Created a task",
};

function describe(action: string): string {
  return DESCRIPTIONS[action] ?? action.replace(/\./g, " ").replace(/_/g, " ");
}

function iconFor(action: string) {
  if (action.startsWith("approval.approved") || action.endsWith(".executed"))
    return <CheckCircle2 className="size-4 text-success" />;
  if (action.endsWith(".failed") || action.startsWith("approval.rejected"))
    return <XCircle className="size-4 text-danger" />;
  if (action.startsWith("approval")) return <ShieldAlert className="size-4 text-warning" />;
  if (action.startsWith("customer.reply") || action.startsWith("social")) return <Send className="size-4 text-primary" />;
  if (action.startsWith("assistant")) return <Bot className="size-4 text-muted-foreground" />;
  if (action.startsWith("conversation")) return <MessageSquare className="size-4 text-muted-foreground" />;
  return <FileText className="size-4 text-muted-foreground" />;
}

export default async function AuditPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspace(slug);
  if (!can(ctx.member.role, "reports:view")) redirect(`/${slug}/command`);

  const events = await listAuditEvents(ctx, { limit: 150 });

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Audit log"
        description="Every AI action, approval, and external effect — who, what, when."
      />
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        {events.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            No activity yet.
          </p>
        ) : (
          <ol className="divide-y divide-border rounded-lg border border-border">
            {events.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-3 py-2.5">
                <div className="mt-0.5">{iconFor(e.action)}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm">
                    <span className="font-medium">{describe(e.action)}</span>{" "}
                    <span className="text-muted-foreground">· {e.entity}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {e.actor?.name ?? "System"} · {relativeTime(e.createdAt)}
                    {e.correlationId ? ` · turn ${e.correlationId.slice(-6)}` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
