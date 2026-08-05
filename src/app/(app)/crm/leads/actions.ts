"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/org-context";
import { crmEnabled } from "@/lib/crm-flag";
import { createLead } from "@/lib/services/crm/leads";

export async function createLeadAction(formData: FormData) {
  if (!crmEnabled()) notFound();
  const ctx = await requireOrg();
  const lead = await createLead(ctx, {
    fullName: String(formData.get("fullName") ?? ""),
    companyName: String(formData.get("companyName") ?? "") || undefined,
    phone: String(formData.get("phone") ?? "") || undefined,
    email: String(formData.get("email") ?? "") || undefined,
    source: String(formData.get("source") ?? "") || undefined,
  });
  revalidatePath("/crm/leads");
  redirect(`/crm/leads/${lead.id}`);
}
