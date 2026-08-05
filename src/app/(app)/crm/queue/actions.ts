"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import type { CallOutcome } from "@prisma/client";
import { requireOrg } from "@/lib/org-context";
import { crmEnabled } from "@/lib/crm-flag";
import type { NextActionKind } from "@operanto/crm-calloutcome";
import { recordOutcomeAndNext, startCall } from "@/lib/services/crm/calls";
import { overrideLock, releaseLock } from "@/lib/services/crm/locks";

/** Server actions re-check the module flag: a layout guards rendering only. */
function guard(): void {
  if (!crmEnabled()) notFound();
}

export interface StartCallState {
  attemptId?: string;
  href?: string | null;
  displayNumber?: string;
  error?: string;
}

export async function startCallAction(
  _prev: StartCallState | null,
  formData: FormData,
): Promise<StartCallState> {
  guard();
  const ctx = await requireOrg();
  try {
    const result = await startCall(ctx, String(formData.get("leadId") ?? ""));
    revalidatePath(`/crm/leads/${formData.get("leadId")}`);
    return {
      attemptId: result.attemptId,
      href: result.dialTarget.href,
      displayNumber: result.dialTarget.displayNumber,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not start the call" };
  }
}

export interface OutcomeState {
  error?: string;
  savedNextLeadId?: string | null;
}

export async function recordOutcomeAction(
  _prev: OutcomeState | null,
  formData: FormData,
): Promise<OutcomeState> {
  guard();
  const ctx = await requireOrg();
  const leadId = String(formData.get("leadId") ?? "");
  const kind = String(formData.get("nextActionKind") ?? "NONE") as NextActionKind;
  const atRaw = String(formData.get("nextActionAt") ?? "").trim();

  try {
    const { nextLeadId } = await recordOutcomeAndNext(
      ctx,
      {
        attemptId: String(formData.get("attemptId") ?? ""),
        outcome: String(formData.get("outcome") ?? "") as CallOutcome,
        note: String(formData.get("note") ?? "") || undefined,
        reason: String(formData.get("reason") ?? "") || undefined,
        durationSeconds: formData.get("durationSeconds")
          ? Number(formData.get("durationSeconds"))
          : undefined,
        nextAction: {
          kind,
          at: atRaw ? new Date(atRaw) : undefined,
          reason: String(formData.get("reason") ?? "") || undefined,
        },
      },
      leadId,
    );
    revalidatePath("/crm/queue");
    revalidatePath(`/crm/leads/${leadId}`);
    return { savedNextLeadId: nextLeadId };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save the outcome" };
  }
}

export async function releaseLockAction(formData: FormData) {
  guard();
  const ctx = await requireOrg();
  await releaseLock(ctx, String(formData.get("leadId") ?? ""), "EXIT");
  revalidatePath("/crm/queue");
}

export async function overrideLockAction(formData: FormData) {
  guard();
  const ctx = await requireOrg();
  const leadId = String(formData.get("leadId") ?? "");
  await overrideLock(ctx, leadId);
  redirect(`/crm/leads/${leadId}`);
}
