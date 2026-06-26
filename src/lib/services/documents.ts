import "server-only";
import { randomUUID } from "node:crypto";
import type { DocumentKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { WorkspaceContext } from "@/lib/workspace";
import { getBlobStore } from "@/lib/storage/blob";
import { runAITask } from "@/lib/ai/service";
import { extractDocumentTask } from "@/lib/ai/tasks";
import { upsertRequirement } from "@/lib/services/opportunities";

/**
 * Document AI — store uploaded photos/PDFs/plans and extract structured fields.
 * Extraction reuses the AI layer (AIAction) and can auto-fill the linked
 * opportunity's requirements.
 */

function kindFromMime(mime: string): DocumentKind {
  if (mime.startsWith("image/")) return "photo";
  if (mime === "application/pdf") return "pdf";
  return "other";
}

export function listDocuments(ctx: WorkspaceContext, opportunityId: string) {
  requirePermission(ctx.member.role, "opportunities:manage");
  return prisma.document.findMany({
    where: { workspaceId: ctx.workspace.id, opportunityId },
    include: { extraction: true },
    orderBy: { createdAt: "desc" },
  });
}

export type CreateDocumentInput = {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  opportunityId?: string | null;
  customerId?: string | null;
};

export async function createDocument(ctx: WorkspaceContext, input: CreateDocumentInput) {
  requirePermission(ctx.member.role, "opportunities:manage");
  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
  const storageKey = `${ctx.workspace.id}/${randomUUID()}-${safeName}`;
  await getBlobStore().put(storageKey, input.bytes);

  let customerId = input.customerId ?? null;
  if (!customerId && input.opportunityId) {
    const opp = await prisma.opportunity.findFirst({
      where: { id: input.opportunityId, workspaceId: ctx.workspace.id },
      select: { customerId: true },
    });
    customerId = opp?.customerId ?? null;
  }

  const doc = await prisma.document.create({
    data: {
      workspaceId: ctx.workspace.id,
      opportunityId: input.opportunityId ?? null,
      customerId,
      kind: kindFromMime(input.mimeType),
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.length,
      storageKey,
      status: "uploaded",
      createdByUserId: ctx.userId,
    },
  });
  await audit(ctx, { action: "document.upload", entity: "Document", entityId: doc.id });
  return doc;
}

/** Read a document's bytes for download (workspace-scoped). */
export async function readDocument(ctx: WorkspaceContext, id: string) {
  requirePermission(ctx.member.role, "opportunities:manage");
  const doc = await prisma.document.findFirst({ where: { id, workspaceId: ctx.workspace.id } });
  if (!doc) throw new Error("Document not found");
  const bytes = await getBlobStore().get(doc.storageKey);
  return { bytes, mimeType: doc.mimeType, fileName: doc.fileName };
}

/**
 * Extract structured fields and (when linked to an opportunity) upsert them as
 * requirements so the document fills the qualification gaps.
 */
export async function extractDocument(ctx: WorkspaceContext, id: string) {
  requirePermission(ctx.member.role, "opportunities:manage");
  const doc = await prisma.document.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    include: { opportunity: { include: { requirements: true } } },
  });
  if (!doc) throw new Error("Document not found");

  await prisma.document.update({ where: { id }, data: { status: "processing" } });

  const targetKeys = (doc.opportunity?.requirements ?? []).map((r) => ({ key: r.key, label: r.label }));
  let res;
  try {
    res = await runAITask(ctx, extractDocumentTask, {
      kind: doc.kind,
      fileName: doc.fileName,
      targetKeys,
    });
  } catch (e) {
    await prisma.document.update({ where: { id }, data: { status: "failed" } });
    throw e;
  }

  const data = Object.fromEntries(res.data.fields.map((f) => [f.key, f.value]));
  await prisma.documentExtraction.upsert({
    where: { documentId: id },
    create: { documentId: id, aiActionId: res.aiActionId, data, confidence: res.data.confidence },
    update: { aiActionId: res.aiActionId, data, confidence: res.data.confidence },
  });
  await prisma.document.update({ where: { id }, data: { status: "extracted" } });

  // Feed the Lead Engine: fill matching requirements on the opportunity.
  if (doc.opportunityId) {
    for (const f of res.data.fields) {
      await upsertRequirement(ctx, doc.opportunityId, {
        key: f.key,
        label: f.label,
        valueType: "text",
        value: f.value,
        required: false,
        confidence: res.data.confidence,
      });
    }
  }

  await audit(ctx, { action: "document.extract", entity: "Document", entityId: id, after: { fields: res.data.fields.length } });
  return { fields: res.data.fields.length };
}

export async function deleteDocument(ctx: WorkspaceContext, id: string) {
  requirePermission(ctx.member.role, "opportunities:manage");
  const doc = await prisma.document.findFirst({ where: { id, workspaceId: ctx.workspace.id } });
  if (!doc) throw new Error("Document not found");
  await getBlobStore().delete(doc.storageKey);
  await prisma.document.delete({ where: { id } });
  await audit(ctx, { action: "document.delete", entity: "Document", entityId: id });
}
