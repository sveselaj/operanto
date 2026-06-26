import "server-only";
import type { IntegrationAction, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { WorkspaceContext } from "@/lib/workspace";
import { getIntegrationConnector, preferredCrmProvider, INTEGRATION_PROVIDERS } from "@/lib/integrations";

/**
 * Integration Hub — idempotent, retried record of an external operation. Each
 * call records an IntegrationAction, runs the connector, and persists the
 * outcome. Re-running with the same idempotencyKey reuses the row.
 */

const num = (d: { toString(): string } | number | null | undefined) =>
  d == null ? null : Number(d.toString());

type RecordRunInput = {
  provider: string;
  operation: string;
  entityType?: string | null;
  entityId?: string | null;
  idempotencyKey?: string | null;
  request: unknown;
};

async function runConnector(actionId: string, provider: string, operation: string, request: unknown) {
  const connector = getIntegrationConnector(provider);
  await prisma.integrationAction.update({
    where: { id: actionId },
    data: { status: "running", attempts: { increment: 1 } },
  });
  if (!connector) {
    await prisma.integrationAction.update({
      where: { id: actionId },
      data: { status: "failed", error: `Unknown provider: ${provider}`, completedAt: new Date() },
    });
    return;
  }
  const result = await connector.execute(operation, request);
  await prisma.integrationAction.update({
    where: { id: actionId },
    data: {
      status: result.ok ? "success" : "failed",
      response: (result.response ?? undefined) as Prisma.InputJsonValue | undefined,
      error: result.ok ? null : (result.error ?? "Failed"),
      completedAt: new Date(),
    },
  });
}

/** Record an action and run it. Idempotent on (provider, idempotencyKey). */
export async function recordAndRun(
  ctx: WorkspaceContext,
  input: RecordRunInput,
): Promise<IntegrationAction> {
  requirePermission(ctx.member.role, "integrations:manage");

  let action: IntegrationAction | null = null;
  if (input.idempotencyKey) {
    action = await prisma.integrationAction.findUnique({
      where: { provider_idempotencyKey: { provider: input.provider, idempotencyKey: input.idempotencyKey } },
    });
    if (action?.status === "success") return action; // already done
  }

  if (!action) {
    action = await prisma.integrationAction.create({
      data: {
        workspaceId: ctx.workspace.id,
        provider: input.provider,
        operation: input.operation,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        request: (input.request ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  await runConnector(action.id, input.provider, input.operation, input.request);
  await audit(ctx, { action: "integration.run", entity: "IntegrationAction", entityId: action.id, after: { provider: input.provider, operation: input.operation } });
  return prisma.integrationAction.findUniqueOrThrow({ where: { id: action.id } });
}

/** Retry a failed action (bounded by maxAttempts). */
export async function retryIntegration(ctx: WorkspaceContext, id: string) {
  requirePermission(ctx.member.role, "integrations:manage");
  const action = await prisma.integrationAction.findFirst({ where: { id, workspaceId: ctx.workspace.id } });
  if (!action) throw new Error("Integration action not found");
  if (action.status === "success") return action;
  if (action.attempts >= action.maxAttempts) throw new Error("Max attempts reached");
  await prisma.integrationAction.update({ where: { id }, data: { status: "retrying" } });
  await runConnector(action.id, action.provider, action.operation, action.request);
  await audit(ctx, { action: "integration.retry", entity: "IntegrationAction", entityId: id });
  return prisma.integrationAction.findUniqueOrThrow({ where: { id } });
}

/** Push an opportunity (contact + deal) to the CRM. Idempotent per opportunity. */
export async function pushOpportunityToCrm(ctx: WorkspaceContext, opportunityId: string) {
  requirePermission(ctx.member.role, "integrations:manage");
  const opp = await prisma.opportunity.findFirst({
    where: { id: opportunityId, workspaceId: ctx.workspace.id },
    include: { customer: true },
  });
  if (!opp) throw new Error("Opportunity not found");

  const provider = preferredCrmProvider();
  const request = {
    contact: {
      email: opp.customer?.email ?? undefined,
      firstname: opp.customer?.name ?? undefined,
      phone: opp.customer?.phone ?? undefined,
    },
    deal: {
      dealname: opp.title ?? `Opportunity ${opp.id.slice(-6)}`,
      amount: num(opp.value) ?? undefined,
    },
  };
  return recordAndRun(ctx, {
    provider,
    operation: "sync_opportunity",
    entityType: "Opportunity",
    entityId: opp.id,
    idempotencyKey: `opportunity:${opp.id}`,
    request,
  });
}

export function listIntegrationActions(ctx: WorkspaceContext, limit = 30) {
  requirePermission(ctx.member.role, "integrations:manage");
  return prisma.integrationAction.findMany({
    where: { workspaceId: ctx.workspace.id },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export function integrationProviderStates(ctx: WorkspaceContext) {
  requirePermission(ctx.member.role, "integrations:manage");
  return INTEGRATION_PROVIDERS.map((p) => ({
    provider: p,
    configured: getIntegrationConnector(p)?.isConfigured() ?? false,
  }));
}
