"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/org-context";
import { eraseCustomer, setProcessingRestriction } from "@/lib/services/privacy";

export type PrivacyResult = { ok?: string; error?: string };

export async function eraseCustomerAction(
  _prev: PrivacyResult | null,
  formData: FormData,
): Promise<PrivacyResult> {
  const ctx = await requireOrg();
  const customerId = String(formData.get("customerId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) {
    return { error: "Record why this erasure was requested." };
  }
  // Typed confirmation: erasure cannot be undone, so it must not be one
  // mis-click away.
  if (String(formData.get("confirm") ?? "") !== "ERASE") {
    return { error: 'Type ERASE to confirm.' };
  }
  try {
    const result = await eraseCustomer(ctx, customerId, reason);
    revalidatePath(`/customers/${customerId}`);
    return {
      ok: `Personal data erased: ${result.opportunities} opportunit(y/ies), ${result.activities} timeline entries, ${result.events} stored event payloads.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Erasure failed" };
  }
}

export async function setRestrictionAction(formData: FormData) {
  const ctx = await requireOrg();
  const customerId = String(formData.get("customerId") ?? "");
  await setProcessingRestriction(
    ctx,
    customerId,
    String(formData.get("restricted") ?? "") === "true",
  );
  revalidatePath(`/customers/${customerId}`);
}
