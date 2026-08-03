"use server";

import { revalidatePath } from "next/cache";
import { redirect, notFound } from "next/navigation";
import type { GrowthAccountStatus, TargetProfileStatus } from "@prisma/client";
import { requireOrg } from "@/lib/org-context";
import { growthEnabled } from "@/lib/growth-flag";
import {
  createTargetProfile,
  setTargetProfileStatus,
  updateTargetProfile,
  type TargetProfileInput,
} from "@/lib/services/growth/profiles";
import {
  assignGrowthAccount,
  suppressGrowthAccount,
  transitionGrowthAccount,
  updateGrowthAccount,
} from "@/lib/services/growth/accounts";
import {
  commitImport,
  previewImport,
  type CommitInput,
  type ImportPreview,
} from "@/lib/services/growth/imports";
import type { ColumnMapping } from "@/lib/services/growth/csv";

/** Server Actions re-check the flag — the layout only guards rendering. */
function assertGrowth(): void {
  if (!growthEnabled()) notFound();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

export type FormState = { error: string | null } | null;

function listField(formData: FormData, name: string): string[] {
  return String(formData.get(name) ?? "")
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function profileInput(formData: FormData): TargetProfileInput {
  const sizeMin = String(formData.get("companySizeMin") ?? "").trim();
  const sizeMax = String(formData.get("companySizeMax") ?? "").trim();
  return {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? "") || null,
    industries: listField(formData, "industries"),
    regions: listField(formData, "regions"),
    companySizeMin: sizeMin ? Number(sizeMin) : null,
    companySizeMax: sizeMax ? Number(sizeMax) : null,
    characteristics: listField(formData, "characteristics"),
    decisionMakerRoles: listField(formData, "decisionMakerRoles"),
    positiveSignals: listField(formData, "positiveSignals"),
    negativeSignals: listField(formData, "negativeSignals"),
    exclusionCriteria: listField(formData, "exclusionCriteria"),
    operantoUseCases: listField(formData, "operantoUseCases"),
    languages: listField(formData, "languages"),
  };
}

export async function createProfileAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  assertGrowth();
  const ctx = await requireOrg();
  let profileId: string;
  try {
    const profile = await createTargetProfile(ctx, profileInput(formData));
    profileId = profile.id;
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath("/growth/target-profiles");
  redirect(`/growth/target-profiles/${profileId}`);
}

export async function updateProfileAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  assertGrowth();
  const ctx = await requireOrg();
  const profileId = String(formData.get("profileId") ?? "");
  try {
    await updateTargetProfile(ctx, profileId, profileInput(formData));
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath(`/growth/target-profiles/${profileId}`);
  revalidatePath("/growth/target-profiles");
  return { error: null };
}

export async function setProfileStatusAction(formData: FormData): Promise<void> {
  assertGrowth();
  const ctx = await requireOrg();
  const profileId = String(formData.get("profileId") ?? "");
  const status = String(formData.get("status") ?? "") as TargetProfileStatus;
  if (!["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"].includes(status)) return;
  await setTargetProfileStatus(ctx, profileId, status);
  revalidatePath(`/growth/target-profiles/${profileId}`);
  revalidatePath("/growth/target-profiles");
}

export async function transitionAccountAction(formData: FormData): Promise<void> {
  assertGrowth();
  const ctx = await requireOrg();
  const accountId = String(formData.get("accountId") ?? "");
  const to = String(formData.get("to") ?? "") as GrowthAccountStatus;
  let failure: string | null = null;
  try {
    await transitionGrowthAccount(ctx, accountId, to);
  } catch (error) {
    failure = errorMessage(error);
  }
  revalidatePath(`/growth/accounts/${accountId}`);
  revalidatePath("/growth/accounts");
  if (failure) {
    redirect(`/growth/accounts/${accountId}?error=${encodeURIComponent(failure)}`);
  }
}

export async function suppressAccountAction(formData: FormData): Promise<void> {
  assertGrowth();
  const ctx = await requireOrg();
  const accountId = String(formData.get("accountId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || "manual suppression";
  let failure: string | null = null;
  try {
    await suppressGrowthAccount(ctx, accountId, reason);
  } catch (error) {
    failure = errorMessage(error);
  }
  revalidatePath(`/growth/accounts/${accountId}`);
  revalidatePath("/growth/accounts");
  if (failure) {
    redirect(`/growth/accounts/${accountId}?error=${encodeURIComponent(failure)}`);
  }
}

export async function assignAccountAction(formData: FormData): Promise<void> {
  assertGrowth();
  const ctx = await requireOrg();
  const accountId = String(formData.get("accountId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "") || null;
  let failure: string | null = null;
  try {
    await assignGrowthAccount(ctx, accountId, membershipId);
  } catch (error) {
    failure = errorMessage(error);
  }
  revalidatePath(`/growth/accounts/${accountId}`);
  if (failure) {
    redirect(`/growth/accounts/${accountId}?error=${encodeURIComponent(failure)}`);
  }
}

export async function updateAccountAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  assertGrowth();
  const ctx = await requireOrg();
  const accountId = String(formData.get("accountId") ?? "");
  const field = (name: string) => {
    const value = formData.get(name);
    return value === null ? undefined : String(value);
  };
  try {
    await updateGrowthAccount(ctx, accountId, {
      name: field("name"),
      tradingName: field("tradingName"),
      domain: field("domain"),
      website: field("website"),
      industry: field("industry"),
      description: field("description"),
      country: field("country"),
      region: field("region"),
      city: field("city"),
      employeeEstimate: field("employeeEstimate") || null,
      phone: field("phone"),
      publicEmail: field("publicEmail"),
      targetProfileId: field("targetProfileId") || null,
    });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath(`/growth/accounts/${accountId}`);
  revalidatePath("/growth/accounts");
  return { error: null };
}

export type PreviewState =
  | { ok: true; preview: ImportPreview }
  | { ok: false; error: string }
  | null;

export async function previewImportAction(
  _prev: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  assertGrowth();
  const ctx = await requireOrg();
  try {
    const mappingRaw = String(formData.get("mapping") ?? "");
    const preview = await previewImport(ctx, {
      filename: String(formData.get("filename") ?? "import.csv"),
      text: String(formData.get("text") ?? ""),
      mapping: mappingRaw ? (JSON.parse(mappingRaw) as ColumnMapping) : undefined,
    });
    return { ok: true, preview };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export type CommitState =
  | { ok: true; accepted: number; skipped: number; linked: number; rejected: number }
  | { ok: false; error: string }
  | null;

export async function commitImportAction(
  _prev: CommitState,
  formData: FormData,
): Promise<CommitState> {
  assertGrowth();
  const ctx = await requireOrg();
  try {
    const input: CommitInput = {
      importId: String(formData.get("importId") ?? ""),
      filename: String(formData.get("filename") ?? "import.csv"),
      text: String(formData.get("text") ?? ""),
      mapping: JSON.parse(String(formData.get("mapping") ?? "{}")) as ColumnMapping,
      resolutions: JSON.parse(String(formData.get("resolutions") ?? "{}")),
      acceptPartial: String(formData.get("acceptPartial") ?? "") === "true",
    };
    const result = await commitImport(ctx, input);
    revalidatePath("/growth/accounts");
    revalidatePath("/growth");
    return {
      ok: true,
      accepted: result.accepted,
      skipped: result.skippedDuplicates + result.tombstoneSkipped,
      linked: result.linked,
      rejected: result.rejected,
    };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
