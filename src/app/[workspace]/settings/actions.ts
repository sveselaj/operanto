"use server";

import { revalidatePath } from "next/cache";
import type { ChannelType, TemplateStatus } from "@prisma/client";
import { getWorkspaceContext } from "@/lib/workspace";
import { ForbiddenError } from "@/lib/rbac";
import type { ProductType } from "@prisma/client";
import * as templates from "@/lib/mediasync/templates";
import { runDiagnostic, type DiagnosticResult } from "@/lib/mediasync/diagnostics";
import { setChannelCredentials } from "@/lib/mediasync/channel-credentials";
import * as catalogue from "@/lib/services/catalogue";

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

function toResult(fn: () => Promise<unknown>, slug: string, sub: string): Promise<ActionResult> {
  return fn()
    .then(() => {
      revalidatePath(`/${slug}/settings${sub ? `/${sub}` : ""}`);
      return { ok: true } as ActionResult;
    })
    .catch((e: unknown) => ({ ok: false, error: errorMessage(e) }) as ActionResult);
}

// ── Diagnostics ────────────────────────────────────────────────

export type DiagnosticActionResult =
  | { ok: true; result: DiagnosticResult }
  | { ok: false; error: string };

export async function runDiagnosticAction(
  slug: string,
  channelAccountId: string,
  to: string,
  body: string,
): Promise<DiagnosticActionResult> {
  try {
    const ctx = await ctxOrThrow(slug);
    const result = await runDiagnostic(ctx, { channelAccountId, to, body });
    revalidatePath(`/${slug}/settings/diagnostics`);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

// ── Channel credentials ───────────────────────────────────────

export async function setChannelCredentialsAction(
  slug: string,
  channelAccountId: string,
  input: { accessToken?: string; externalAccountId?: string },
): Promise<ActionResult> {
  return toResult(
    async () => {
      const ctx = await ctxOrThrow(slug);
      await setChannelCredentials(ctx, channelAccountId, {
        // Empty access token field = leave unchanged; clearing is a separate concern.
        accessToken: input.accessToken ? input.accessToken : undefined,
        externalAccountId: input.externalAccountId ?? undefined,
      });
    },
    slug,
    "",
  );
}

// ── Catalogue: products ───────────────────────────────────────

export type ProductInput = {
  name: string;
  type: ProductType;
  sku?: string | null;
  description?: string | null;
  unitPrice?: number | null;
  taxRate?: number | null;
  unit?: string | null;
};

export async function createProductAction(slug: string, input: ProductInput): Promise<ActionResult> {
  return toResult(async () => {
    const ctx = await ctxOrThrow(slug);
    await catalogue.createProduct(ctx, { ...input, type: input.type });
  }, slug, "catalogue");
}

export async function updateProductAction(slug: string, id: string, input: ProductInput): Promise<ActionResult> {
  return toResult(async () => {
    const ctx = await ctxOrThrow(slug);
    await catalogue.updateProduct(ctx, id, input);
  }, slug, "catalogue");
}

export async function setProductActiveAction(slug: string, id: string, active: boolean): Promise<ActionResult> {
  return toResult(async () => {
    const ctx = await ctxOrThrow(slug);
    await catalogue.setProductActive(ctx, id, active);
  }, slug, "catalogue");
}

export async function deleteProductAction(slug: string, id: string): Promise<ActionResult> {
  return toResult(async () => {
    const ctx = await ctxOrThrow(slug);
    await catalogue.deleteProduct(ctx, id);
  }, slug, "catalogue");
}

// ── Catalogue: business rules ─────────────────────────────────

export async function createBusinessRuleAction(
  slug: string,
  input: { name: string; priority?: number; definition: unknown },
): Promise<ActionResult> {
  return toResult(async () => {
    const ctx = await ctxOrThrow(slug);
    await catalogue.createBusinessRule(ctx, input);
  }, slug, "catalogue");
}

export async function setRuleEnabledAction(slug: string, id: string, enabled: boolean): Promise<ActionResult> {
  return toResult(async () => {
    const ctx = await ctxOrThrow(slug);
    await catalogue.setBusinessRuleEnabled(ctx, id, enabled);
  }, slug, "catalogue");
}

export async function deleteBusinessRuleAction(slug: string, id: string): Promise<ActionResult> {
  return toResult(async () => {
    const ctx = await ctxOrThrow(slug);
    await catalogue.deleteBusinessRule(ctx, id);
  }, slug, "catalogue");
}

// ── Templates ──────────────────────────────────────────────────

export async function createTemplateAction(
  slug: string,
  input: { name: string; channelType: ChannelType; category?: string; language?: string; body: string },
): Promise<ActionResult> {
  return toResult(
    async () => {
      const ctx = await ctxOrThrow(slug);
      await templates.createTemplate(ctx, input);
    },
    slug,
    "templates",
  );
}

export async function updateTemplateAction(
  slug: string,
  id: string,
  input: { name: string; channelType: ChannelType; category?: string; language?: string; body: string },
): Promise<ActionResult> {
  return toResult(
    async () => {
      const ctx = await ctxOrThrow(slug);
      await templates.updateTemplate(ctx, id, input);
    },
    slug,
    "templates",
  );
}

export async function setTemplateStatusAction(
  slug: string,
  id: string,
  status: TemplateStatus,
): Promise<ActionResult> {
  return toResult(
    async () => {
      const ctx = await ctxOrThrow(slug);
      await templates.setTemplateStatus(ctx, id, status);
    },
    slug,
    "templates",
  );
}

export async function deleteTemplateAction(slug: string, id: string): Promise<ActionResult> {
  return toResult(
    async () => {
      const ctx = await ctxOrThrow(slug);
      await templates.deleteTemplate(ctx, id);
    },
    slug,
    "templates",
  );
}
