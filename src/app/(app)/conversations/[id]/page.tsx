import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/org-context";
import { can } from "@/lib/rbac";
import {
  CONVERSATION_PRIORITIES,
  CONVERSATION_STATUSES,
  getConversation,
  listLinkableCustomers,
} from "@/lib/services/conversations";
import { listAssignableMembers } from "@/lib/services/opportunities";
import { PageHeader } from "@/components/app/page-header";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  assignAction,
  changePriorityAction,
  changeStatusAction,
  createTaskFromConversationAction,
  linkCustomerAction,
  setHandlingAction,
  toggleConversationTaskAction,
  unlinkCustomerAction,
} from "./actions";
import { MessageComposer, NoteForm } from "./composer-forms";
import { CustomerContextPanel } from "./customer-context-panel";
import { AiPanel, type AiResultView, type ApprovalView } from "./ai-panel";
import { WhatsAppSendPanel } from "./whatsapp-send-panel";
import { retryWhatsAppSendAction } from "./actions";
import { listApprovedTemplates } from "@/lib/services/templates";
import { serviceWindowState } from "@/lib/channels/service-window";
import { listAiActions } from "@/lib/services/ai";
import { getConversationApproval } from "@/lib/services/approvals";
import { getAiConfiguration } from "@/lib/services/ai-config";

export const metadata: Metadata = { title: "Conversation" };

const CHANNEL_LABELS: Record<string, string> = {
  MANUAL: "Manual",
  SIMULATOR: "Simulator",
  WHATSAPP: "WhatsApp",
};

export default async function ConversationDetailPage({
  params,
  searchParams,
}: PageProps<"/conversations/[id]">) {
  const ctx = await requireOrg();
  const { id } = await params;
  const { error } = await searchParams;

  const conversation = await getConversation(ctx, id);
  if (!conversation) notFound();

  const canUpdate = can(ctx.membership.role, "conversations:update");
  const canArchive = can(ctx.membership.role, "conversations:archive");
  const canAssign = can(ctx.membership.role, "conversations:assign");
  const canLink = can(ctx.membership.role, "conversations:link_customer");
  const canMessage = can(ctx.membership.role, "conversations:message");
  const canNote = can(ctx.membership.role, "conversations:note");

  const canAiRead = can(ctx.membership.role, "ai:read");
  const canTakeover = can(ctx.membership.role, "conversations:takeover");
  const canConfigureAi = can(ctx.membership.role, "ai:configure");
  const canSend = can(ctx.membership.role, "messages:send");

  // The send panel appears only when every static gate is open; the dynamic
  // gates (consent, window, template, credential) are re-decided server-side
  // at the moment of the send.
  const whatsappSendable =
    canSend &&
    conversation.channelType === "WHATSAPP" &&
    conversation.connection?.type === "WHATSAPP" &&
    conversation.connection.status === "ACTIVE" &&
    conversation.connection.outboundEnabled &&
    process.env.OPERANTO_WHATSAPP_OUTBOUND_ENABLED === "1" &&
    conversation.status !== "ARCHIVED";
  const sendWindow = serviceWindowState(conversation.lastInboundAt, new Date());
  const approvedTemplates = whatsappSendable ? await listApprovedTemplates(ctx) : [];

  const [members, linkableCustomers, aiConfig, aiActions, approval] =
    await Promise.all([
      canAssign ? listAssignableMembers(ctx) : Promise.resolve([]),
      canLink && !conversation.customerId
        ? listLinkableCustomers(ctx)
        : Promise.resolve([]),
      canAiRead ? getAiConfiguration(ctx) : Promise.resolve(null),
      canAiRead ? listAiActions(ctx, conversation.id) : Promise.resolve([]),
      canAiRead ? getConversationApproval(ctx, conversation.id) : Promise.resolve(null),
    ]);

  const aiResults: AiResultView[] = aiActions.map((action) => ({
    id: action.id,
    taskType: action.taskType,
    status: action.status,
    provider: action.provider,
    model: action.model,
    confidence: action.confidence,
    riskLevel: action.riskLevel,
    createdAt: action.createdAt.toISOString(),
    output:
      action.outputJson && !action.redactedAt
        ? (action.outputJson as Record<string, unknown>)
        : null,
    requestedByName: action.requestedBy?.user.name ?? null,
  }));
  const approvalView: ApprovalView | null =
    approval && !approval.redactedAt
      ? {
          id: approval.id,
          status: approval.status,
          riskLevel: approval.riskLevel,
          lowConfidence: approval.lowConfidence,
          reply: String(
            ((approval.editedPayload ?? approval.originalPayload) as {
              reply?: string;
            }).reply ?? "",
          ),
          edited: approval.editedPayload !== null,
          executionClaimed: approval.executionClaimedAt !== null,
        }
      : null;
  const latestNextAction = aiResults.find(
    (r) => r.taskType === "NEXT_ACTION" && r.output,
  );
  const suggestedTaskTitle =
    typeof latestNextAction?.output?.suggestedTaskTitle === "string"
      ? latestNextAction.output.suggestedTaskTitle
      : null;
  const budgetWarning =
    aiConfig && aiConfig.enabled && aiConfig.periodRequestCount >= aiConfig.monthlyRequestLimit
      ? "The AI usage budget for this period is exhausted — requests will be refused until the period resets."
      : null;

  const customer = conversation.customer;
  const counterpart = customer
    ? customer.erasedAt
      ? "Erased customer"
      : (customer.name ?? "Customer")
    : (conversation.participants.find((p) => p.type === "CUSTOMER")?.displayName ??
      "Unlinked counterpart");
  const restricted = Boolean(customer?.restrictedAt);
  const statusOptions = CONVERSATION_STATUSES.filter(
    (status) => status !== "ARCHIVED" || canArchive,
  );

  return (
    <>
      <PageHeader
        title={conversation.subject ?? counterpart}
        description={`${counterpart} · ${
          CHANNEL_LABELS[conversation.channelType] ?? conversation.channelType
        } · opened ${formatDateTime(conversation.createdAt)}`}
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              conversation.handling === "HUMAN_CONTROLLED"
                ? "border-primary text-primary"
                : "border-border text-muted-foreground",
            )}
            title={
              conversation.handlingChangedAt
                ? `Changed ${formatDateTime(conversation.handlingChangedAt)}${
                    conversation.handlingChangedBy
                      ? ` by ${conversation.handlingChangedBy.user.name}`
                      : ""
                  }`
                : undefined
            }
          >
            {conversation.handling === "HUMAN_CONTROLLED"
              ? "Human controlled"
              : "AI assisted"}
          </span>
          {canTakeover ? (
            <form action={setHandlingAction}>
              <input type="hidden" name="conversationId" value={conversation.id} />
              <input
                type="hidden"
                name="handling"
                value={
                  conversation.handling === "HUMAN_CONTROLLED"
                    ? "AI_ASSISTED"
                    : "HUMAN_CONTROLLED"
                }
              />
              <button
                type="submit"
                className="h-8 rounded-md border border-border px-3 text-xs hover:bg-muted"
              >
                {conversation.handling === "HUMAN_CONTROLLED"
                  ? "Release to AI-assisted"
                  : "Take control"}
              </button>
            </form>
          ) : null}
        </div>
      </PageHeader>

      {typeof error === "string" && error ? (
        <p
          role="alert"
          className="mb-4 rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}
      {customer?.erasedAt ? (
        <p className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          The linked customer exercised their right to erasure on{" "}
          {formatDateTime(customer.erasedAt)}. Personal data in this conversation has
          been redacted.
        </p>
      ) : null}
      {restricted ? (
        <p className="mb-4 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning">
          Processing for this customer is restricted (GDPR Art. 18). Data may be
          viewed, but no new messages may be recorded.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="rounded-lg border border-border bg-card">
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
              Messages
            </h2>
            <div className="space-y-3 px-4 py-4">
              {conversation.messages.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground">
                  No messages yet.
                </p>
              ) : (
                conversation.messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "max-w-[85%] rounded-lg border px-3 py-2 text-sm",
                      message.direction === "OUTBOUND"
                        ? "ml-auto border-primary/30 bg-accent"
                        : "border-border bg-background",
                    )}
                  >
                    <p className="mb-1 text-xs text-muted-foreground">
                      {message.direction === "OUTBOUND"
                        ? (message.sender?.user.name ?? "Staff")
                        : counterpart}{" "}
                      · {formatDateTime(message.providerTimestamp ?? message.createdAt)}
                      {message.deliveryStatus !== "RECORDED"
                        ? ` · ${message.deliveryStatus.toLowerCase()}`
                        : null}
                    </p>
                    <p className={message.redactedAt ? "italic text-muted-foreground" : undefined}>
                      {message.redactedAt ? "(content redacted)" : message.body}
                    </p>
                    {!message.redactedAt &&
                    (message.metadata as { media?: { pending?: boolean; kind?: string } } | null)
                      ?.media?.pending ? (
                      <p className="mt-1 inline-block rounded-full border border-warning/50 px-2 py-0.5 text-xs text-warning">
                        {String(
                          (message.metadata as { media?: { kind?: string } }).media?.kind ??
                            "media",
                        )}{" "}
                        pending retrieval
                      </p>
                    ) : null}
                    {message.deliveryStatus === "FAILED" ? (
                      <div className="mt-1 flex items-center gap-2">
                        <p className="text-xs text-danger">
                          {message.errorMessage ?? "Send failed"}
                        </p>
                        {whatsappSendable ? (
                          <form action={retryWhatsAppSendAction}>
                            <input
                              type="hidden"
                              name="conversationId"
                              value={conversation.id}
                            />
                            <input type="hidden" name="messageId" value={message.id} />
                            <button
                              type="submit"
                              className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-muted"
                            >
                              Retry send
                            </button>
                          </form>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
            {canMessage ? (
              <div className="border-t border-border px-4 py-3">
                <MessageComposer
                  conversationId={conversation.id}
                  disabled={restricted}
                  disabledReason="Processing is restricted for this customer — recording new messages is blocked."
                />
              </div>
            ) : null}
          </section>

          {whatsappSendable ? (
            <WhatsAppSendPanel
              conversationId={conversation.id}
              withinWindow={sendWindow.withinWindow}
              windowExpiresAt={sendWindow.expiresAt?.toISOString() ?? null}
              templates={approvedTemplates.map((t) => ({
                id: t.id,
                name: t.name,
                language: t.language,
                body: t.body,
              }))}
              disabled={Boolean(customer?.erasedAt || customer?.restrictedAt)}
              disabledReason={
                customer?.erasedAt
                  ? "This customer has been erased — sending is not possible."
                  : "Processing is restricted for this customer — sending is blocked."
              }
            />
          ) : null}

          {canAiRead && aiConfig ? (
            <AiPanel
              conversationId={conversation.id}
              aiEnabled={aiConfig.enabled}
              aiMode={aiConfig.mode}
              budgetWarning={budgetWarning}
              restricted={restricted}
              canConfigure={canConfigureAi}
              results={aiResults}
              approval={approvalView}
              suggestedTaskTitle={suggestedTaskTitle}
            />
          ) : null}

          <section className="rounded-lg border border-border bg-card">
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
              Recent activity
            </h2>
            <div className="divide-y divide-border">
              {conversation.activities.length === 0 ? (
                <p className="px-4 py-4 text-center text-sm text-muted-foreground">
                  Nothing yet.
                </p>
              ) : (
                conversation.activities.map((activity) => (
                  <div key={activity.id} className="px-4 py-2.5 text-sm">
                    <p>{activity.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {activity.activityType} · {formatDateTime(activity.occurredAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Customer</h2>
            {customer ? (
              <div className="space-y-2 text-sm">
                <p>
                  <Link
                    href={`/customers/${customer.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {customer.erasedAt ? "Erased customer" : (customer.name ?? "Customer")}
                  </Link>
                </p>
                {!customer.erasedAt && customer.email ? (
                  <p className="text-muted-foreground">{customer.email}</p>
                ) : null}
                {canLink ? (
                  <form action={unlinkCustomerAction}>
                    <input type="hidden" name="conversationId" value={conversation.id} />
                    <button
                      type="submit"
                      className="text-xs text-muted-foreground underline hover:text-foreground"
                    >
                      Unlink customer
                    </button>
                  </form>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <p className="text-muted-foreground">
                  Not linked to a customer record.
                </p>
                {canLink && linkableCustomers.length > 0 ? (
                  <form action={linkCustomerAction} className="space-y-2">
                    <input type="hidden" name="conversationId" value={conversation.id} />
                    <select
                      name="customerId"
                      defaultValue=""
                      required
                      aria-label="Customer to link"
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="" disabled>
                        Choose a customer…
                      </option>
                      {linkableCustomers.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name ?? candidate.email ?? candidate.id}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="h-8 rounded-md border border-border px-3 text-xs hover:bg-muted"
                    >
                      Link customer
                    </button>
                  </form>
                ) : null}
              </div>
            )}
          </section>

          {customer && !customer.erasedAt ? (
            <CustomerContextPanel
              customerId={customer.id}
              excludeConversationId={conversation.id}
            />
          ) : null}

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Manage</h2>
            <div className="space-y-3 text-sm">
              <form action={changeStatusAction} className="flex items-center gap-2">
                <input type="hidden" name="conversationId" value={conversation.id} />
                <select
                  name="status"
                  defaultValue={conversation.status}
                  disabled={!canUpdate}
                  aria-label="Status"
                  className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status.charAt(0) + status.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={!canUpdate}
                  className="h-9 rounded-md border border-border px-3 text-xs hover:bg-muted disabled:opacity-50"
                >
                  Set status
                </button>
              </form>

              <form action={changePriorityAction} className="flex items-center gap-2">
                <input type="hidden" name="conversationId" value={conversation.id} />
                <select
                  name="priority"
                  defaultValue={conversation.priority}
                  disabled={!canUpdate}
                  aria-label="Priority"
                  className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {CONVERSATION_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority.charAt(0) + priority.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={!canUpdate}
                  className="h-9 rounded-md border border-border px-3 text-xs hover:bg-muted disabled:opacity-50"
                >
                  Set priority
                </button>
              </form>

              <form action={assignAction} className="flex items-center gap-2">
                <input type="hidden" name="conversationId" value={conversation.id} />
                <select
                  name="membershipId"
                  defaultValue={conversation.assignedMembershipId ?? ""}
                  disabled={!canAssign}
                  aria-label="Assignee"
                  className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {(canAssign ? members : []).map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.user.name}
                    </option>
                  ))}
                  {!canAssign && conversation.assignee ? (
                    <option value={conversation.assignedMembershipId ?? ""}>
                      {conversation.assignee.user.name}
                    </option>
                  ) : null}
                </select>
                <button
                  type="submit"
                  disabled={!canAssign}
                  className="h-9 rounded-md border border-border px-3 text-xs hover:bg-muted disabled:opacity-50"
                >
                  Assign
                </button>
              </form>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Tasks</h2>
            <div className="space-y-3">
              <form action={createTaskFromConversationAction} className="space-y-2">
                <input type="hidden" name="conversationId" value={conversation.id} />
                <input
                  name="title"
                  required
                  placeholder="Follow-up task for this conversation…"
                  aria-label="Task title"
                  disabled={restricted}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="datetime-local"
                    name="dueAt"
                    aria-label="Due date"
                    disabled={restricted}
                    className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                  />
                  {canAssign ? (
                    <select
                      name="assignedMembershipId"
                      defaultValue=""
                      aria-label="Task assignee"
                      disabled={restricted}
                      className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                    >
                      <option value="">Unassigned</option>
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.user.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
                <button
                  type="submit"
                  disabled={restricted}
                  className="h-8 rounded-md border border-border px-3 text-xs hover:bg-muted disabled:opacity-50"
                >
                  Create task
                </button>
                {restricted ? (
                  <p className="text-xs text-warning">
                    Processing is restricted — no new follow-up work may be created.
                  </p>
                ) : null}
              </form>
              {conversation.tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks yet.</p>
              ) : (
                conversation.tasks.map((task) => (
                  <div key={task.id} className="flex items-start gap-2 text-sm">
                    <form action={toggleConversationTaskAction}>
                      <input type="hidden" name="conversationId" value={conversation.id} />
                      <input type="hidden" name="taskId" value={task.id} />
                      <input
                        type="hidden"
                        name="nextStatus"
                        value={task.status === "OPEN" ? "COMPLETED" : "OPEN"}
                      />
                      <button
                        type="submit"
                        className="mt-0.5 h-4 w-4 rounded border border-input bg-background text-primary"
                        aria-label={task.status === "OPEN" ? "Complete task" : "Reopen task"}
                      >
                        {task.status === "COMPLETED" ? "✓" : ""}
                      </button>
                    </form>
                    <div className="min-w-0 flex-1">
                      <p
                        className={
                          task.status === "COMPLETED"
                            ? "text-muted-foreground line-through"
                            : undefined
                        }
                      >
                        {task.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {task.assignee?.user.name ?? "Unassigned"} · {task.priority}
                        {task.dueAt ? ` · due ${formatDateTime(task.dueAt)}` : null}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Internal notes</h2>
            <div className="space-y-3">
              {canNote ? <NoteForm conversationId={conversation.id} /> : null}
              {conversation.notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              ) : (
                conversation.notes.map((note) => (
                  <div key={note.id} className="rounded-md border border-border px-3 py-2 text-sm">
                    <p className="whitespace-pre-wrap">{note.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {note.author?.user.name ?? "Former member"} ·{" "}
                      {formatDateTime(note.createdAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
