import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { WorkspaceContext } from "@/lib/workspace";
import { evaluateWorkflow, type StepLite } from "@/lib/workflow-eval";

/**
 * Workflow engine — generic, config-driven process execution. A
 * WorkflowDefinition (seeded JSON, Zod-validated) declares steps; a
 * WorkflowInstance tracks an opportunity's position and advances when the
 * current step's required requirements are all provided.
 */

export const stepActionSchema = z.object({ type: z.string(), label: z.string() });
export const stepActionsSchema = z.array(stepActionSchema);
export type StepAction = z.infer<typeof stepActionSchema>;

export function parseActions(json: unknown): StepAction[] {
  const parsed = stepActionsSchema.safeParse(json);
  return parsed.success ? parsed.data : [];
}

export function listDefinitions(ctx: WorkspaceContext) {
  requirePermission(ctx.member.role, "workflow:manage");
  return prisma.workflowDefinition.findMany({
    where: { workspaceId: ctx.workspace.id },
    include: { steps: { orderBy: { order: "asc" } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

/** Find the active definition by key (latest version) or the sole active one. */
async function pickDefinition(workspaceId: string, key?: string) {
  return prisma.workflowDefinition.findFirst({
    where: { workspaceId, active: true, ...(key ? { key } : {}) },
    include: { steps: { orderBy: { order: "asc" } } },
    orderBy: { version: "desc" },
  });
}

export async function startWorkflow(ctx: WorkspaceContext, opportunityId: string, key?: string) {
  requirePermission(ctx.member.role, "workflow:manage");
  const opp = await prisma.opportunity.findFirst({
    where: { id: opportunityId, workspaceId: ctx.workspace.id },
    select: { id: true },
  });
  if (!opp) throw new Error("Opportunity not found");

  const existing = await prisma.workflowInstance.findUnique({ where: { opportunityId } });
  if (existing) return existing;

  const def = await pickDefinition(ctx.workspace.id, key);
  if (!def || def.steps.length === 0) throw new Error("No active workflow definition to start");

  const firstStep = def.steps[0];
  const instance = await prisma.workflowInstance.create({
    data: {
      workspaceId: ctx.workspace.id,
      opportunityId,
      workflowDefinitionId: def.id,
      currentStepKey: firstStep.key,
      status: "active",
      transitions: {
        create: { fromStepKey: null, toStepKey: firstStep.key, actorUserId: ctx.userId, reason: "started" },
      },
    },
  });
  // Mirror the step onto the opportunity for quick filtering.
  await prisma.opportunity.update({ where: { id: opportunityId }, data: { stage: firstStep.key } });
  await audit(ctx, { action: "workflow.start", entity: "Opportunity", entityId: opportunityId, after: { definition: def.key } });
  return instance;
}

export type WorkflowView = {
  instanceId: string;
  status: string;
  definitionName: string;
  steps: { key: string; name: string; order: number; done: boolean; current: boolean }[];
  currentStepName: string | null;
  missingKeys: string[];
  missingLabels: string[];
  canAdvance: boolean;
  isLastStep: boolean;
  actions: StepAction[];
};

/** Build the workflow view for an opportunity (or null if none started). */
export async function getWorkflowForOpportunity(
  ctx: WorkspaceContext,
  opportunityId: string,
): Promise<WorkflowView | null> {
  const instance = await prisma.workflowInstance.findUnique({
    where: { opportunityId },
    include: { definition: { include: { steps: { orderBy: { order: "asc" } } } } },
  });
  if (!instance || instance.workspaceId !== ctx.workspace.id) return null;

  const reqs = await prisma.customerRequirement.findMany({
    where: { opportunityId, workspaceId: ctx.workspace.id },
    select: { key: true, label: true, status: true },
  });
  const providedKeys = reqs.filter((r) => r.status === "provided").map((r) => r.key);
  const steps: StepLite[] = instance.definition.steps.map((s) => ({
    key: s.key,
    name: s.name,
    order: s.order,
    requiredRequirementKeys: s.requiredRequirementKeys,
  }));
  const evalResult = evaluateWorkflow(steps, instance.currentStepKey, providedKeys);
  const currentIdx = steps.findIndex((s) => s.key === instance.currentStepKey);
  const labelFor = (key: string) => reqs.find((r) => r.key === key)?.label ?? key;
  const currentStepRow = instance.definition.steps.find((s) => s.key === instance.currentStepKey);

  return {
    instanceId: instance.id,
    status: instance.status,
    definitionName: instance.definition.name,
    steps: instance.definition.steps.map((s, i) => ({
      key: s.key,
      name: s.name,
      order: s.order,
      done: instance.status === "completed" || i < currentIdx,
      current: instance.status !== "completed" && s.key === instance.currentStepKey,
    })),
    currentStepName: evalResult.currentStep?.name ?? null,
    missingKeys: evalResult.missingKeys,
    missingLabels: evalResult.missingKeys.map(labelFor),
    canAdvance: instance.status === "active" && evalResult.canAdvance,
    isLastStep: evalResult.isLastStep,
    actions: parseActions(currentStepRow?.allowedActions),
  };
}

/** Advance to the next step (requires the current step's requirements). */
export async function advanceWorkflow(ctx: WorkspaceContext, opportunityId: string) {
  requirePermission(ctx.member.role, "workflow:manage");
  const instance = await prisma.workflowInstance.findUnique({
    where: { opportunityId },
    include: { definition: { include: { steps: { orderBy: { order: "asc" } } } } },
  });
  if (!instance || instance.workspaceId !== ctx.workspace.id) throw new Error("Workflow not found");
  if (instance.status !== "active") throw new Error("Workflow is not active");

  const reqs = await prisma.customerRequirement.findMany({
    where: { opportunityId, workspaceId: ctx.workspace.id },
    select: { key: true, status: true },
  });
  const providedKeys = reqs.filter((r) => r.status === "provided").map((r) => r.key);
  const steps: StepLite[] = instance.definition.steps.map((s) => ({
    key: s.key,
    name: s.name,
    order: s.order,
    requiredRequirementKeys: s.requiredRequirementKeys,
  }));
  const evalResult = evaluateWorkflow(steps, instance.currentStepKey, providedKeys);
  if (!evalResult.currentStep) throw new Error("Workflow has no current step");
  if (!evalResult.canAdvance) {
    throw new Error(`Cannot advance — still missing: ${evalResult.missingKeys.join(", ")}`);
  }

  const from = instance.currentStepKey;
  if (evalResult.isLastStep) {
    await prisma.workflowInstance.update({
      where: { id: instance.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        transitions: { create: { fromStepKey: from, toStepKey: from, actorUserId: ctx.userId, reason: "completed" } },
      },
    });
    await audit(ctx, { action: "workflow.complete", entity: "Opportunity", entityId: opportunityId });
    return { completed: true };
  }

  const next = evalResult.nextStep!;
  await prisma.workflowInstance.update({
    where: { id: instance.id },
    data: {
      currentStepKey: next.key,
      transitions: { create: { fromStepKey: from, toStepKey: next.key, actorUserId: ctx.userId, reason: "advanced" } },
    },
  });
  await prisma.opportunity.update({ where: { id: opportunityId }, data: { stage: next.key } });
  await audit(ctx, { action: "workflow.advance", entity: "Opportunity", entityId: opportunityId, after: { to: next.key } });
  return { completed: false, step: next.key };
}
