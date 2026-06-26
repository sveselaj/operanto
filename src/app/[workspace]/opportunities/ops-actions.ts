"use server";

import { revalidatePath } from "next/cache";
import type { AppointmentStatus, AppointmentType } from "@prisma/client";
import { getWorkspaceContext } from "@/lib/workspace";
import { ForbiddenError } from "@/lib/rbac";
import * as appointments from "@/lib/services/appointments";
import * as documents from "@/lib/services/documents";
import { pushOpportunityToCrm } from "@/lib/services/integrations";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function ctxOrThrow(slug: string) {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx) throw new Error("Not authorized for this workspace");
  return ctx;
}
function errorMessage(e: unknown): string {
  if (e instanceof ForbiddenError) return "You don't have permission to do that.";
  return e instanceof Error ? e.message : "Something went wrong.";
}
function toResult(fn: () => Promise<unknown>, slug: string, opportunityId: string): Promise<ActionResult> {
  return fn()
    .then(() => {
      revalidatePath(`/${slug}/opportunities/${opportunityId}`);
      return { ok: true } as ActionResult;
    })
    .catch((e: unknown) => ({ ok: false, error: errorMessage(e) }) as ActionResult);
}

// ── Appointments ──────────────────────────────────────────────

export async function createAppointmentAction(
  slug: string,
  opportunityId: string,
  input: {
    type: AppointmentType;
    title?: string;
    scheduledAt?: string | null;
    durationMinutes?: number | null;
    location?: string | null;
    assignedToUserId?: string | null;
  },
): Promise<ActionResult> {
  return toResult(async () => {
    const ctx = await ctxOrThrow(slug);
    await appointments.createAppointment(ctx, { ...input, opportunityId });
  }, slug, opportunityId);
}

export async function setAppointmentStatusAction(
  slug: string,
  opportunityId: string,
  id: string,
  status: AppointmentStatus,
): Promise<ActionResult> {
  return toResult(async () => {
    const ctx = await ctxOrThrow(slug);
    await appointments.setAppointmentStatus(ctx, id, status);
  }, slug, opportunityId);
}

export async function deleteAppointmentAction(slug: string, opportunityId: string, id: string): Promise<ActionResult> {
  return toResult(async () => {
    const ctx = await ctxOrThrow(slug);
    await appointments.deleteAppointment(ctx, id);
  }, slug, opportunityId);
}

export type IcsResult = { ok: true; ics: string; fileName: string } | { ok: false; error: string };
export async function appointmentIcsAction(slug: string, id: string): Promise<IcsResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    const ics = await appointments.appointmentIcs(ctx, id);
    return { ok: true, ics, fileName: `appointment-${id.slice(-6)}.ics` };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

// ── Documents ─────────────────────────────────────────────────

export async function uploadDocumentAction(
  slug: string,
  opportunityId: string,
  formData: FormData,
): Promise<ActionResult> {
  return toResult(async () => {
    const ctx = await ctxOrThrow(slug);
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("No file provided");
    if (file.size === 0) throw new Error("File is empty");
    if (file.size > 20 * 1024 * 1024) throw new Error("File exceeds 20 MB");
    const bytes = Buffer.from(await file.arrayBuffer());
    await documents.createDocument(ctx, {
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes,
      opportunityId,
    });
  }, slug, opportunityId);
}

export async function extractDocumentAction(slug: string, opportunityId: string, id: string): Promise<ActionResult> {
  return toResult(async () => {
    const ctx = await ctxOrThrow(slug);
    await documents.extractDocument(ctx, id);
  }, slug, opportunityId);
}

export async function deleteDocumentAction(slug: string, opportunityId: string, id: string): Promise<ActionResult> {
  return toResult(async () => {
    const ctx = await ctxOrThrow(slug);
    await documents.deleteDocument(ctx, id);
  }, slug, opportunityId);
}

// ── CRM push ──────────────────────────────────────────────────

export async function pushToCrmAction(slug: string, opportunityId: string): Promise<ActionResult> {
  return toResult(async () => {
    const ctx = await ctxOrThrow(slug);
    await pushOpportunityToCrm(ctx, opportunityId);
  }, slug, opportunityId);
}
