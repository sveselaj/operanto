"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import type { LeadStatus } from "@prisma/client";
import { requireOrg } from "@/lib/org-context";
import { crmEnabled } from "@/lib/crm-flag";
import { assignLead, transitionLead } from "@/lib/services/crm/leads";

export async function transitionLeadAction(formData: FormData) {
  if (!crmEnabled()) notFound();
  const ctx = await requireOrg();
  const id = String(formData.get("leadId") ?? "");
  const to = String(formData.get("to") ?? "") as LeadStatus;
  const reason = String(formData.get("reason") ?? "").trim() || undefined;
  const scheduledAtRaw = String(formData.get("scheduledAt") ?? "").trim();
  const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : undefined;
  await transitionLead(ctx, id, { to, reason, scheduledAt });
  revalidatePath(`/crm/leads/${id}`);
  revalidatePath("/crm/leads");
}

export async function assignLeadAction(formData: FormData) {
  if (!crmEnabled()) notFound();
  const ctx = await requireOrg();
  const id = String(formData.get("leadId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  await assignLead(ctx, id, membershipId || null);
  revalidatePath(`/crm/leads/${id}`);
  revalidatePath("/crm/leads");
}
