import "server-only";
import type { ChannelType, SyncJob, SyncJobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * MediaSync — connector observability.
 *
 * One SyncJob row per poll / backfill / send / diagnostic run, with item counts
 * and duration. This is the audit trail for "is the WhatsApp connector
 * actually pulling messages?" and powers the diagnostics page.
 */

export type StartSyncInput = {
  workspaceId: string;
  channelType: ChannelType;
  channelAccountId?: string | null;
  operation: string; // poll | backfill | send | diagnostic | webhook
};

export async function startSyncJob(input: StartSyncInput): Promise<string> {
  const job = await prisma.syncJob.create({
    data: {
      workspaceId: input.workspaceId,
      channelType: input.channelType,
      channelAccountId: input.channelAccountId ?? null,
      operation: input.operation,
      status: "running",
    },
    select: { id: true, startedAt: true },
  });
  return job.id;
}

export type FinishSyncInput = {
  status: SyncJobStatus;
  itemsProcessed?: number;
  itemsFailed?: number;
  detail?: string | null;
  error?: string | null;
};

export async function finishSyncJob(id: string, result: FinishSyncInput): Promise<void> {
  const job = await prisma.syncJob.findUnique({ where: { id }, select: { startedAt: true } });
  const finishedAt = new Date();
  const durationMs = job ? finishedAt.getTime() - job.startedAt.getTime() : null;
  await prisma.syncJob.update({
    where: { id },
    data: {
      status: result.status,
      itemsProcessed: result.itemsProcessed ?? 0,
      itemsFailed: result.itemsFailed ?? 0,
      detail: result.detail ?? null,
      error: result.error ?? null,
      finishedAt,
      durationMs,
    },
  });
}

/**
 * Run `work` wrapped in a SyncJob, recording success/failure automatically.
 * Returns whatever `work` returns; re-throws after recording the error.
 */
export async function withSyncJob<T>(
  input: StartSyncInput,
  work: () => Promise<{ result: T; itemsProcessed?: number; detail?: string }>,
): Promise<T> {
  const id = await startSyncJob(input);
  try {
    const { result, itemsProcessed, detail } = await work();
    await finishSyncJob(id, { status: "success", itemsProcessed, detail });
    return result;
  } catch (e) {
    const error = e instanceof Error ? e.message : "Sync failed";
    await finishSyncJob(id, { status: "error", itemsFailed: 1, error });
    throw e;
  }
}

export function listSyncJobs(workspaceId: string, limit = 20): Promise<SyncJob[]> {
  return prisma.syncJob.findMany({
    where: { workspaceId },
    orderBy: { startedAt: "desc" },
    take: limit,
  });
}
