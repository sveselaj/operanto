"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/org-context";
import {
  cancelComputerSession,
  createComputerBridgeGrant,
  detachComputerBridge,
} from "@/lib/services/computer";
import { runComputerAiTask } from "@/lib/services/computer-understanding";
import { recordValidationAssessment } from "@/lib/services/computer-validation";
import { isValidationAssessment } from "@/lib/computer/validation";
import {
  issueNavigationNonce,
  proposeSafeNavigation,
} from "@/lib/services/computer-navigation";
import { AIError } from "@/lib/ai/types";

function errorMessage(error: unknown): string {
  if (error instanceof AIError) {
    switch (error.code) {
      case "AI_DISABLED":
        return "AI assistance is disabled for this organisation (Settings → Organisation).";
      case "TASK_NOT_PERMITTED":
        return "Computer tasks are not permitted in this organisation's AI configuration.";
      case "BUDGET_EXHAUSTED":
        return "The organisation's AI budget for this period is exhausted.";
      case "PROCESSING_RESTRICTED":
        return "Processing for this customer is restricted.";
      default:
        return "AI assistance is unavailable right now.";
    }
  }
  return error instanceof Error ? error.message : "Something went wrong";
}

async function runControl(sessionId: string, fn: () => Promise<unknown>) {
  let failure: string | null = null;
  try {
    await fn();
  } catch (error) {
    failure = errorMessage(error);
  }
  revalidatePath(`/computer/${sessionId}`);
  revalidatePath("/computer");
  if (failure) {
    redirect(`/computer/${sessionId}?error=${encodeURIComponent(failure)}`);
  }
}

/** Mint a pairing token. Returned to the client panel ONCE — never in a URL,
 *  never persisted raw, never logged. */
export async function mintBridgeGrantAction(
  sessionId: string,
): Promise<{ token?: string; expiresAt?: string; error?: string }> {
  const ctx = await requireOrg();
  try {
    const grant = await createComputerBridgeGrant(ctx, sessionId);
    revalidatePath(`/computer/${sessionId}`);
    return { token: grant.token, expiresAt: grant.expiresAt.toISOString() };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function detachBridgeAction(formData: FormData) {
  const ctx = await requireOrg();
  const sessionId = String(formData.get("sessionId") ?? "");
  const grantId = String(formData.get("grantId") ?? "");
  await runControl(sessionId, () => detachComputerBridge(ctx, grantId));
}

export async function analyzeAction(formData: FormData) {
  const ctx = await requireOrg();
  const sessionId = String(formData.get("sessionId") ?? "");
  const mode = String(formData.get("mode") ?? "");
  const question = String(formData.get("question") ?? "").trim() || undefined;
  await runControl(sessionId, () =>
    runComputerAiTask(
      ctx,
      sessionId,
      mode === "guide" ? "COMPUTER_GUIDE" : "COMPUTER_PAGE_UNDERSTAND",
      { question },
    ),
  );
}

/** C4: propose ONE navigation to a safe link observed in the fresh snapshot. */
export async function proposeNavigationAction(formData: FormData) {
  const ctx = await requireOrg();
  const sessionId = String(formData.get("sessionId") ?? "");
  const ref = String(formData.get("targetRef") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || "Inspect this page";
  await runControl(sessionId, () =>
    proposeSafeNavigation(ctx, sessionId, { ref }, reason),
  );
}

/**
 * C4: mint the one-shot execution code for an APPROVED navigation. Returned
 * once to this operator's browser for the extension — never stored raw,
 * never audited, never in a URL.
 */
export async function issueNavigationCodeAction(
  actionId: string,
): Promise<{ nonce?: string; expiresAt?: string; error?: string }> {
  const ctx = await requireOrg();
  try {
    const issued = await issueNavigationNonce(ctx, actionId);
    return { nonce: issued.nonce, expiresAt: issued.expiresAt.toISOString() };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

/**
 * C4.1 pilot: record the human usefulness signal for one navigation.
 * Evidence capture only — it neither creates nor advances any action, and
 * stores an enum through the audit log (no schema, no free text).
 */
export async function assessNavigationAction(formData: FormData) {
  const ctx = await requireOrg();
  const sessionId = String(formData.get("sessionId") ?? "");
  const actionId = String(formData.get("actionId") ?? "");
  const value = String(formData.get("assessment") ?? "");
  await runControl(sessionId, async () => {
    if (!isValidationAssessment(value)) throw new Error("Unknown assessment value");
    await recordValidationAssessment(ctx, actionId, value);
  });
}

export async function cancelSessionAction(formData: FormData) {
  const ctx = await requireOrg();
  const sessionId = String(formData.get("sessionId") ?? "");
  await runControl(sessionId, () => cancelComputerSession(ctx, sessionId));
}
