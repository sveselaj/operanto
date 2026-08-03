import "server-only";
import { Prisma, type TargetProfileStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import { canTransitionProfile } from "@/lib/services/growth/lifecycle";

/**
 * Target Profile administration (G2). Configuration only: activating a
 * profile changes what imports may attach to — it never triggers
 * discovery, research, AI or outreach. Profiles are archived, never
 * destructively deleted, because accounts reference them.
 */

export type TargetProfileInput = {
  name: string;
  description?: string | null;
  industries?: string[];
  regions?: string[];
  companySizeMin?: number | null;
  companySizeMax?: number | null;
  characteristics?: string[];
  decisionMakerRoles?: string[];
  positiveSignals?: string[];
  negativeSignals?: string[];
  exclusionCriteria?: string[];
  operantoUseCases?: string[];
  languages?: string[];
};

function cleanList(values?: string[]): string[] {
  return (values ?? []).map((v) => v.trim()).filter(Boolean).slice(0, 50);
}

function validated(input: TargetProfileInput) {
  const name = input.name.trim();
  if (!name) throw new Error("Profile name is required");
  if (name.length > 120) throw new Error("Profile name is too long");
  const min = input.companySizeMin ?? null;
  const max = input.companySizeMax ?? null;
  if (min !== null && (min < 0 || !Number.isInteger(min))) {
    throw new Error("Minimum company size must be a whole number");
  }
  if (max !== null && (max < 0 || !Number.isInteger(max))) {
    throw new Error("Maximum company size must be a whole number");
  }
  if (min !== null && max !== null && min > max) {
    throw new Error("Minimum company size cannot exceed the maximum");
  }
  return {
    name,
    description: input.description?.trim() || null,
    industries: cleanList(input.industries),
    regions: cleanList(input.regions),
    companySizeMin: min,
    companySizeMax: max,
    characteristics: cleanList(input.characteristics),
    decisionMakerRoles: cleanList(input.decisionMakerRoles),
    positiveSignals: cleanList(input.positiveSignals),
    negativeSignals: cleanList(input.negativeSignals),
    exclusionCriteria: cleanList(input.exclusionCriteria),
    operantoUseCases: cleanList(input.operantoUseCases),
    languages: cleanList(input.languages),
  };
}

export async function createTargetProfile(ctx: OrgContext, input: TargetProfileInput) {
  requirePermission(ctx.membership.role, "growth:manage_target_profiles");
  const data = validated(input);
  try {
    const profile = await prisma.targetProfile.create({
      data: { organisationId: ctx.organisation.id, ...data },
    });
    await audit(ctx, {
      eventType: "growth.profile_created",
      targetType: "TargetProfile",
      targetId: profile.id,
      after: { status: profile.status },
    });
    return profile;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new Error("A profile with this name already exists");
    }
    throw error;
  }
}

export async function updateTargetProfile(
  ctx: OrgContext,
  profileId: string,
  input: TargetProfileInput,
) {
  requirePermission(ctx.membership.role, "growth:manage_target_profiles");
  const existing = await prisma.targetProfile.findFirst({
    where: { ...scope(ctx), id: profileId },
  });
  if (!existing) throw new Error("Profile not found");
  const data = validated(input);
  const changedFields = (Object.keys(data) as (keyof typeof data)[]).filter(
    (key) => JSON.stringify(data[key]) !== JSON.stringify(existing[key]),
  );
  try {
    const profile = await prisma.targetProfile.update({
      where: { id: existing.id },
      data,
    });
    if (changedFields.length > 0) {
      await audit(ctx, {
        eventType: "growth.profile_updated",
        targetType: "TargetProfile",
        targetId: profile.id,
        after: { changedFields },
      });
    }
    return profile;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new Error("A profile with this name already exists");
    }
    throw error;
  }
}

export async function setTargetProfileStatus(
  ctx: OrgContext,
  profileId: string,
  status: TargetProfileStatus,
) {
  requirePermission(ctx.membership.role, "growth:manage_target_profiles");
  const existing = await prisma.targetProfile.findFirst({
    where: { ...scope(ctx), id: profileId },
  });
  if (!existing) throw new Error("Profile not found");
  if (existing.status === status) return existing;
  if (!canTransitionProfile(existing.status, status)) {
    throw new Error(
      `Profile status cannot move ${existing.status} → ${status}`,
    );
  }
  const profile = await prisma.targetProfile.update({
    where: { id: existing.id },
    data: { status },
  });
  await audit(ctx, {
    eventType: "growth.profile_status_changed",
    targetType: "TargetProfile",
    targetId: profile.id,
    before: { status: existing.status },
    after: { status },
  });
  return profile;
}

export async function listTargetProfiles(ctx: OrgContext) {
  requirePermission(ctx.membership.role, "growth:view");
  return prisma.targetProfile.findMany({
    where: scope(ctx),
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: { _count: { select: { accounts: true } } },
  });
}

export async function getTargetProfile(ctx: OrgContext, profileId: string) {
  requirePermission(ctx.membership.role, "growth:view");
  return prisma.targetProfile.findFirst({
    where: { ...scope(ctx), id: profileId },
    include: { _count: { select: { accounts: true } } },
  });
}
