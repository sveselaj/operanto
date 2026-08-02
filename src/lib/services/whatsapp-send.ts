import "server-only";
import { Prisma, type Message } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import { getChannelAdapter } from "@/lib/channels/registry";
import { ChannelAdapterError } from "@/lib/channels/types";
import {
  SERVICE_WINDOW_MS,
  serviceWindowState,
} from "@/lib/channels/service-window";

/**
 * The ONE path to external WhatsApp transmission — an explicit, human-invoked
 * operation. Nothing else in the codebase calls the adapter's sendMessage:
 * no AI approval, Task, workflow event, cron or background process may invoke
 * transmission, and a RECORDED message is never moved — this operation
 * creates a NEW outbound message that starts at QUEUED.
 *
 * Every send re-runs the full server-side recheck chain at the moment of the
 * attempt; UI state is never trusted:
 *   deployment outbound flag → permission → active organisation (OrgContext)
 *   → record-level conversation access → conversation not archived →
 *   connection (WHATSAPP, ACTIVE, outbound-enabled, WABA/phone ownership,
 *   credential present) → recipient identity from the conversation's own
 *   participant record → customer erasure/restriction → consent → 24-hour
 *   service window recalculated server-side → organisation-authorized
 *   APPROVED template required outside the window → idempotency (unique
 *   clientDedupeKey claims BEFORE the provider call) → QUEUED→SENDING claim
 *   (duplicate-send protection) → provider call → SENT or FAILED.
 *
 * Consent policy: OPTED_OUT always refuses. UNKNOWN is permitted only inside
 * the service window (replying to the customer's own enquiry); template
 * sends outside the window require an explicit OPTED_IN.
 */

export class SendRefusedError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SendRefusedError";
  }
}

const refuse = (code: string, message: string): never => {
  throw new SendRefusedError(code, message);
};

export type SendWhatsAppInput = {
  conversationId: string;
  body: string | null;
  templateId: string | null;
  /** Client-generated per-attempt key; duplicate submits become refusals. */
  idempotencyKey: string;
};

export async function sendWhatsAppMessage(
  ctx: OrgContext,
  input: SendWhatsAppInput,
): Promise<{ messageId: string; deliveryStatus: Message["deliveryStatus"] }> {
  // 1. Deployment kill-switch — outbound defaults OFF everywhere.
  if (process.env.OPERANTO_WHATSAPP_OUTBOUND_ENABLED !== "1") {
    refuse("outbound_disabled", "WhatsApp outbound is not enabled in this deployment");
  }
  // 2. Permission (necessary, never sufficient) within the ACTIVE org context.
  requirePermission(ctx.membership.role, "messages:send");

  // 3. Record-level conversation access — operators reach only assigned work.
  const { conversationAccessWhere } = await import("@/lib/services/conversations");
  const conversation = await prisma.conversation.findFirst({
    where: { ...conversationAccessWhere(ctx), id: input.conversationId },
    include: {
      customer: true,
      connection: true,
      participants: { where: { type: "CUSTOMER" } },
    },
  });
  if (!conversation) refuse("not_found", "Conversation not found");
  if (conversation!.status === "ARCHIVED") {
    refuse("archived", "Archived conversations cannot send");
  }

  // 4. Connection: type, tenant ownership (scoped by the conversation), stage
  //    gate, WABA + phone-number ownership, current credential.
  const connection = conversation!.connection;
  if (!connection || connection.type !== "WHATSAPP") {
    refuse("not_whatsapp", "This conversation has no WhatsApp connection");
  }
  if (connection!.status !== "ACTIVE") refuse("connection_disabled", "Connection is disabled");
  if (!connection!.outboundEnabled) {
    refuse("outbound_disabled", "Outbound is not enabled for this connection");
  }
  if (!connection!.wabaId || !connection!.phoneNumberId) {
    refuse("connection_incomplete", "Connection is missing its WABA or phone number");
  }
  if (!connection!.accessTokenEncrypted) {
    refuse("no_credential", "Connection has no stored credential");
  }
  if (connection!.tokenExpiresAt && connection!.tokenExpiresAt < new Date()) {
    refuse("credential_expired", "The stored access token has expired");
  }

  // 5. Recipient comes from the conversation's own participant record — the
  //    exact inbound identity, never a caller-supplied number.
  const recipientRef = conversation!.participants.find((p) =>
    p.externalRef?.startsWith("wa:"),
  )?.externalRef;
  if (!recipientRef) refuse("no_recipient", "No WhatsApp recipient on this conversation");

  // 6. Erasure and restriction always win.
  const customer = conversation!.customer;
  if (customer?.erasedAt) refuse("customer_erased", "This customer has been erased");
  if (customer?.restrictedAt) {
    refuse("customer_restricted", "Processing is restricted for this customer");
  }

  // 7. Consent, recalculated now.
  const consent = customer
    ? await prisma.consent.findUnique({
        where: {
          organisationId_customerId_channelType: {
            organisationId: ctx.organisation.id,
            customerId: customer.id,
            channelType: "WHATSAPP",
          },
        },
      })
    : null;
  if (consent?.status === "OPTED_OUT") {
    refuse("opted_out", "The customer has opted out of this channel");
  }

  // 8. The 24-hour service window, recalculated server-side at send time.
  const window = serviceWindowState(conversation!.lastInboundAt, new Date());

  // 9. Template rules: outside the window a send MUST use an APPROVED,
  //    organisation-scoped template selected by id; inside it, free text.
  let template: { id: string; name: string; language: string; body: string } | null = null;
  if (input.templateId) {
    const row = await prisma.messageTemplate.findFirst({
      where: { ...scope(ctx), id: input.templateId, status: "APPROVED" },
    });
    if (!row) refuse("template_not_approved", "Template not found or not approved");
    template = row;
  }
  if (!window.withinWindow) {
    if (!template) {
      refuse(
        "window_expired",
        "The 24-hour service window has closed — an approved template is required",
      );
    }
    if (consent?.status !== "OPTED_IN") {
      refuse("no_consent", "Template sends outside the window require opt-in consent");
    }
  }
  const body = template ? template.body : (input.body ?? "").trim();
  if (!body) refuse("empty_body", "Message body is required");

  // 10. Idempotency claim BEFORE any provider call — the unique constraint on
  //     (organisationId, clientDedupeKey) makes duplicate submits refusals.
  let message: Message;
  try {
    message = await prisma.message.create({
      data: {
        organisationId: ctx.organisation.id,
        conversationId: conversation!.id,
        channelConnectionId: connection!.id,
        direction: "OUTBOUND",
        senderType: "STAFF",
        senderMembershipId: ctx.membership.id,
        body,
        deliveryStatus: "QUEUED",
        statusUpdatedAt: new Date(),
        clientDedupeKey: input.idempotencyKey,
        metadata: template
          ? { whatsapp: { template: { name: template.name, language: template.language } } }
          : Prisma.JsonNull,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      refuse("duplicate_send", "This send was already submitted");
    }
    throw error;
  }

  const result = await transmit(ctx, message!, {
    template: template ? { name: template.name, language: template.language } : null,
    recipientRef: recipientRef!,
    fromStatus: "QUEUED",
  });

  await audit(ctx, {
    eventType: result.sent ? "message.sent" : "message.send_failed",
    targetType: "Message",
    targetId: message!.id,
    after: {
      conversationId: conversation!.id,
      connectionId: connection!.id,
      templateId: template?.id ?? null,
      withinWindow: window.withinWindow,
      ...(result.sent ? {} : { errorCategory: result.errorCategory }),
    },
  });
  await prisma.activity.create({
    data: {
      organisationId: ctx.organisation.id,
      conversationId: conversation!.id,
      customerId: customer?.id ?? null,
      actorType: "STAFF",
      actorMembershipId: ctx.membership.id,
      activityType: result.sent ? "conversation.outbound_sent" : "conversation.outbound_failed",
      sourceSystem: "WHATSAPP",
      summary: result.sent
        ? "WhatsApp message sent by staff"
        : "WhatsApp send failed",
    },
  });
  return { messageId: message!.id, deliveryStatus: result.sent ? "SENT" : "FAILED" };
}

/**
 * Explicit, idempotent retry of a FAILED send — the ONE sanctioned exit from
 * FAILED, and it is human-invoked. The full recheck chain runs again; the
 * original template identity (if any) is reused from the message record.
 */
export async function retryWhatsAppSend(
  ctx: OrgContext,
  messageId: string,
): Promise<{ deliveryStatus: Message["deliveryStatus"] }> {
  if (process.env.OPERANTO_WHATSAPP_OUTBOUND_ENABLED !== "1") {
    refuse("outbound_disabled", "WhatsApp outbound is not enabled in this deployment");
  }
  requirePermission(ctx.membership.role, "messages:send");

  const { conversationAccessWhere } = await import("@/lib/services/conversations");
  const message = await prisma.message.findFirst({
    where: {
      ...scope(ctx),
      id: messageId,
      direction: "OUTBOUND",
      deliveryStatus: "FAILED",
      conversation: conversationAccessWhere(ctx),
    },
    include: {
      conversation: {
        include: { customer: true, participants: { where: { type: "CUSTOMER" } } },
      },
      connection: true,
    },
  });
  if (!message) refuse("not_found", "No retryable message found");
  const conversation = message!.conversation;
  const connection = message!.connection;
  if (!connection || connection.type !== "WHATSAPP" || connection.status !== "ACTIVE") {
    refuse("connection_disabled", "Connection is unavailable");
  }
  if (!connection!.outboundEnabled) {
    refuse("outbound_disabled", "Outbound is not enabled for this connection");
  }
  if (!connection!.accessTokenEncrypted) refuse("no_credential", "No stored credential");

  const recipientRef = conversation.participants.find((p) =>
    p.externalRef?.startsWith("wa:"),
  )?.externalRef;
  if (!recipientRef) refuse("no_recipient", "No WhatsApp recipient on this conversation");
  if (conversation.customer?.erasedAt) refuse("customer_erased", "Customer erased");
  if (conversation.customer?.restrictedAt) {
    refuse("customer_restricted", "Processing is restricted for this customer");
  }
  const consent = conversation.customer
    ? await prisma.consent.findUnique({
        where: {
          organisationId_customerId_channelType: {
            organisationId: ctx.organisation.id,
            customerId: conversation.customer.id,
            channelType: "WHATSAPP",
          },
        },
      })
    : null;
  if (consent?.status === "OPTED_OUT") refuse("opted_out", "Customer opted out");

  const metadata = message!.metadata as {
    whatsapp?: { template?: { name: string; language: string } | null };
  } | null;
  const template = metadata?.whatsapp?.template ?? null;
  const window = serviceWindowState(conversation.lastInboundAt, new Date());
  if (!window.withinWindow) {
    if (!template) {
      refuse("window_expired", "Window closed — retry would need a fresh template send");
    }
    if (consent?.status !== "OPTED_IN") {
      refuse("no_consent", "Template sends outside the window require opt-in consent");
    }
  }

  const result = await transmit(ctx, message!, {
    template,
    recipientRef: recipientRef!,
    fromStatus: "FAILED",
  });
  await audit(ctx, {
    eventType: result.sent ? "message.send_retried" : "message.send_failed",
    targetType: "Message",
    targetId: message!.id,
    after: {
      conversationId: conversation.id,
      connectionId: connection!.id,
      ...(result.sent ? {} : { errorCategory: result.errorCategory }),
    },
  });
  return { deliveryStatus: result.sent ? "SENT" : "FAILED" };
}

/**
 * Claim → provider call → stamp. The conditional claim is the duplicate-send
 * lock: exactly one caller moves the row into SENDING; a raced or replayed
 * attempt claims nothing and refuses. Provider callbacks that already
 * advanced the row past SENT are never regressed (conditional updates only).
 */
async function transmit(
  ctx: OrgContext,
  message: Message,
  args: {
    template: { name: string; language: string } | null;
    recipientRef: string;
    fromStatus: "QUEUED" | "FAILED";
  },
): Promise<{ sent: boolean; errorCategory?: string }> {
  const claimed = await prisma.message.updateMany({
    where: { id: message.id, deliveryStatus: args.fromStatus },
    data: { deliveryStatus: "SENDING", statusUpdatedAt: new Date(), errorMessage: null },
  });
  if (claimed.count === 0) refuse("already_sending", "This message is already being sent");

  const connection = await prisma.channelConnection.findUniqueOrThrow({
    where: { id: message.channelConnectionId! },
  });
  const adapter = getChannelAdapter("WHATSAPP");
  if (!adapter) refuse("no_adapter", "WhatsApp adapter unavailable");

  try {
    const sent = await adapter!.sendMessage({
      connection,
      providerThreadId: null,
      recipientExternalId: args.recipientRef,
      body: message.body,
      template: args.template,
    });
    await prisma.message.updateMany({
      where: { id: message.id, deliveryStatus: "SENDING" },
      data: {
        deliveryStatus: "SENT",
        providerMessageId: sent.providerMessageId,
        statusUpdatedAt: new Date(),
      },
    });
    await prisma.conversation.update({
      where: { id: message.conversationId },
      data: { lastMessageAt: new Date() },
    });
    await prisma.channelConnection.update({
      where: { id: connection.id },
      data: { lastSuccessfulAt: new Date() },
    });
    return { sent: true };
  } catch (error) {
    // Normalized failure category only — provider bodies are never persisted.
    const category =
      error instanceof ChannelAdapterError ? error.message : "send_failed";
    await prisma.message.updateMany({
      where: { id: message.id, deliveryStatus: "SENDING" },
      data: {
        deliveryStatus: "FAILED",
        errorMessage: category.slice(0, 300),
        statusUpdatedAt: new Date(),
      },
    });
    await prisma.channelConnection.update({
      where: { id: connection.id },
      data: { lastErrorAt: new Date(), lastError: category.slice(0, 300) },
    });
    return { sent: false, errorCategory: category.slice(0, 100) };
  }
}

export { SERVICE_WINDOW_MS, serviceWindowState };
