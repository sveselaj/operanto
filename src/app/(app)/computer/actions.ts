"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/org-context";
import { createComputerSession } from "@/lib/services/computer";

export async function createSessionAction(formData: FormData) {
  const ctx = await requireOrg();
  const goal = String(formData.get("goal") ?? "");
  let sessionId: string;
  try {
    const session = await createComputerSession(ctx, { goal });
    sessionId = session.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create session";
    redirect(`/computer?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/computer");
  redirect(`/computer/${sessionId}`);
}
