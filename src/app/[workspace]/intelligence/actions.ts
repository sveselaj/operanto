"use server";

import { revalidatePath } from "next/cache";
import { getWorkspaceContext } from "@/lib/workspace";
import { ForbiddenError } from "@/lib/rbac";
import { generateManagerInsights } from "@/lib/services/analytics";

export type ActionResult = { ok: true; count: number } | { ok: false; error: string };

export async function generateInsightsAction(slug: string): Promise<ActionResult> {
  try {
    const ctx = await getWorkspaceContext(slug);
    if (!ctx) throw new Error("Not authorized for this workspace");
    const insights = await generateManagerInsights(ctx);
    revalidatePath(`/${slug}/intelligence`);
    revalidatePath(`/${slug}/command`);
    return { ok: true, count: insights.length };
  } catch (e) {
    const error =
      e instanceof ForbiddenError
        ? "You don't have permission to do that."
        : e instanceof Error
          ? e.message
          : "Something went wrong.";
    return { ok: false, error };
  }
}
