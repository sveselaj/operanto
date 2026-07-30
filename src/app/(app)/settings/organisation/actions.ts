"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/org-context";
import { requirePermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

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
