"use server";

import { revalidatePath } from "next/cache";
import type { AITaskType } from "@prisma/client";
import { requireOrg } from "@/lib/org-context";
import { requirePermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ALL_TASK_TYPES, updateAiConfiguration } from "@/lib/services/ai-config";

export type AiConfigResult = { error: string } | { ok: true } | null;

export async function updateAiConfigAction(
  _prev: AiConfigResult,
  formData: FormData,
): Promise<AiConfigResult> {
  const ctx = await requireOrg();
  const mode = String(formData.get("mode") ?? "MOCK");
  const permitted = ALL_TASK_TYPES.filter(
    (t) => formData.get(`task_${t}`) === "on",
  ) as AITaskType[];
  try {
    await updateAiConfiguration(ctx, {
      enabled: formData.get("enabled") === "on",
      mode: mode === "LIVE" ? "LIVE" : "MOCK",
      model: String(formData.get("model") ?? "").trim() || undefined,
      monthlyRequestLimit: Number(formData.get("monthlyRequestLimit") ?? NaN) || undefined,
      permittedTaskTypes: permitted,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save" };
  }
  revalidatePath("/settings/organisation");
  return { ok: true };
}

export async function renameOrganisationAction(formData: FormData) {
  const ctx = await requireOrg();
  requirePermission(ctx.membership.role, "org:manage");
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 120 || name === ctx.organisation.name) return;
  await prisma.organisation.update({
    where: { id: ctx.organisation.id },
    data: { name },
  });
  await audit(ctx, {
    eventType: "organisation.renamed",
    targetType: "Organisation",
    targetId: ctx.organisation.id,
    before: { name: ctx.organisation.name },
    after: { name },
  });
  revalidatePath("/settings/organisation");
}
