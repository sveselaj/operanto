import "server-only";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { WorkspaceContext } from "@/lib/workspace";
import { getConnector, ConnectorError } from "@/lib/channels";
import { startSyncJob, finishSyncJob } from "./sync";
import { credentialsFromAccount } from "./channel-credentials";

/**
 * MediaSync — channel diagnostics.
 *
 * Mirrors MediaSyncHub's diagnostics page: a test-send per channel plus a
 * "last inbound message" / "last webhook received" receive-check, so operators
 * can confirm connector wiring without leaving Operanto. Every test-send is
 * recorded as a SyncJob.
 */

export type DiagnosticResult = {
  ok: boolean;
  externalMessageId?: string | null;
  error?: string;
};

/** Test-send a message through a channel's connector, recorded as a SyncJob. */
export async function runDiagnostic(
  ctx: WorkspaceContext,
  input: { channelAccountId: string; to: string; body: string },
): Promise<DiagnosticResult> {
  requirePermission(ctx.member.role, "messaging:manage");

  const account = await prisma.channelAccount.findFirst({
    where: { id: input.channelAccountId, workspaceId: ctx.workspace.id },
  });
  if (!account) throw new Error("Channel account not found");

  const to = input.to.trim();
  const body = input.body.trim();
  if (!to) throw new Error("A destination (phone/handle/email) is required");
  if (!body) throw new Error("Message body is required");

  const jobId = await startSyncJob({
    workspaceId: ctx.workspace.id,
    channelType: account.type,
    channelAccountId: account.id,
    operation: "diagnostic",
  });

  try {
    const connector = getConnector(account.type);
    const res = await connector.sendMessage(to, body, credentialsFromAccount(account));
    await finishSyncJob(jobId, {
      status: "success",
      itemsProcessed: 1,
      detail: `Test-send to ${to}`,
    });
    await audit(ctx, {
      action: "diagnostic.send",
      entity: "ChannelAccount",
      entityId: account.id,
      after: { to, channel: account.type },
    });
    return { ok: true, externalMessageId: res.externalMessageId ?? null };
  } catch (e) {
    const error =
      e instanceof ConnectorError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Test-send failed";
    await finishSyncJob(jobId, { status: "error", itemsFailed: 1, error });
    return { ok: false, error };
  }
}

export type ChannelDiagnostic = {
  channelAccountId: string;
  name: string;
  type: string;
  status: string;
  lastInboundAt: Date | null;
  lastWebhookAt: Date | null;
  lastWebhookStatus: string | null;
};

/** Per-channel receive-check snapshot for the diagnostics page. */
export async function channelDiagnostics(ctx: WorkspaceContext): Promise<ChannelDiagnostic[]> {
  requirePermission(ctx.member.role, "messaging:manage");
  const accounts = await prisma.channelAccount.findMany({
    where: { workspaceId: ctx.workspace.id },
    orderBy: { createdAt: "asc" },
  });

  return Promise.all(
    accounts.map(async (a) => {
      const [lastInbound, lastWebhook] = await Promise.all([
        prisma.message.findFirst({
          where: {
            workspaceId: ctx.workspace.id,
            direction: "inbound",
            conversation: { channelType: a.type },
          },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        prisma.webhookEvent.findFirst({
          where: { workspaceId: ctx.workspace.id, channelType: a.type },
          orderBy: { receivedAt: "desc" },
          select: { receivedAt: true, status: true },
        }),
      ]);
      return {
        channelAccountId: a.id,
        name: a.name,
        type: a.type,
        status: a.status,
        lastInboundAt: lastInbound?.createdAt ?? null,
        lastWebhookAt: lastWebhook?.receivedAt ?? null,
        lastWebhookStatus: lastWebhook?.status ?? null,
      };
    }),
  );
}
