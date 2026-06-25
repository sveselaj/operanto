import "server-only";
import type { ChannelAccount } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { WorkspaceContext } from "@/lib/workspace";
import { getConnector, type ChannelCredentials } from "@/lib/channels";
import { encryptSecret, decryptSecret, isEncryptionConfigured } from "./crypto";

/**
 * MediaSync — per-account channel credentials.
 *
 * Access tokens are encrypted at rest (AES-GCM) and never returned to the
 * client. The send path decrypts them; the settings UI only ever sees a
 * "configured" boolean and the (non-secret) external account id.
 */

/** Decrypted credentials for an account row — for the send path (server-only). */
export function credentialsFromAccount(account: ChannelAccount): ChannelCredentials {
  let accessToken: string | null = null;
  if (account.accessTokenEncrypted) {
    try {
      accessToken = decryptSecret(account.accessTokenEncrypted);
    } catch {
      accessToken = null; // unreadable (key rotated) — treat as unconfigured
    }
  }
  return {
    accessToken,
    externalAccountId: account.externalAccountId,
    metadata: (account.metadata as Record<string, unknown> | null) ?? null,
  };
}

export async function getChannelCredentials(
  workspaceId: string,
  channelAccountId: string,
): Promise<ChannelCredentials | null> {
  const account = await prisma.channelAccount.findFirst({
    where: { id: channelAccountId, workspaceId },
  });
  return account ? credentialsFromAccount(account) : null;
}

export type SetCredentialsInput = {
  accessToken?: string | null; // plaintext; omit to leave unchanged, "" to clear
  externalAccountId?: string | null;
};

export async function setChannelCredentials(
  ctx: WorkspaceContext,
  channelAccountId: string,
  input: SetCredentialsInput,
): Promise<void> {
  requirePermission(ctx.member.role, "channels:manage");
  const account = await prisma.channelAccount.findFirst({
    where: { id: channelAccountId, workspaceId: ctx.workspace.id },
  });
  if (!account) throw new Error("Channel account not found");

  const data: Record<string, unknown> = {};
  if (input.accessToken !== undefined) {
    if (input.accessToken === "" || input.accessToken === null) {
      data.accessTokenEncrypted = null;
    } else {
      if (!isEncryptionConfigured()) {
        throw new Error("Set OPERANTO_ENCRYPTION_KEY (or AUTH_SECRET) before storing tokens.");
      }
      data.accessTokenEncrypted = encryptSecret(input.accessToken);
    }
  }
  if (input.externalAccountId !== undefined) data.externalAccountId = input.externalAccountId;

  // Reflect configuration in the account status (best-effort, non-authoritative).
  const merged: ChannelAccount = { ...account, ...(data as Partial<ChannelAccount>) };
  const configured = getConnector(account.type).isConfigured(credentialsFromAccount(merged));
  data.status = configured ? "connected" : "pending";

  await prisma.channelAccount.update({ where: { id: channelAccountId }, data });
  await audit(ctx, {
    action: "channel.credentials",
    entity: "ChannelAccount",
    entityId: channelAccountId,
    after: { externalAccountId: input.externalAccountId ?? account.externalAccountId, configured },
  });
}

export type ChannelConfigState = {
  channelAccountId: string;
  name: string;
  type: string;
  configured: boolean;
  hasToken: boolean;
  externalAccountId: string | null;
};

/** Per-account configuration snapshot for the settings UI (no secrets). */
export async function channelConfigStates(ctx: WorkspaceContext): Promise<ChannelConfigState[]> {
  requirePermission(ctx.member.role, "channels:manage");
  const accounts = await prisma.channelAccount.findMany({
    where: { workspaceId: ctx.workspace.id },
    orderBy: { createdAt: "asc" },
  });
  return accounts.map((a) => ({
    channelAccountId: a.id,
    name: a.name,
    type: a.type,
    configured: getConnector(a.type).isConfigured(credentialsFromAccount(a)),
    hasToken: !!a.accessTokenEncrypted,
    externalAccountId: a.externalAccountId,
  }));
}
