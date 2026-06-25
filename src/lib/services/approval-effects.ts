import "server-only";
import { prisma } from "@/lib/prisma";
import { recomputeQuote } from "./quote-recompute";

/**
 * Side effects applied when an ApprovalRequest is approved. Kept standalone so
 * the approvals service can apply effects without importing the quotes service
 * (which requests approvals) — no cycle.
 */
export async function applyApprovalEffect(
  workspaceId: string,
  req: { action: string; entityId: string; payload: unknown },
): Promise<void> {
  if (req.action === "quote.send") {
    // Workspace-scoped guard via updateMany.
    await prisma.quote.updateMany({
      where: { id: req.entityId, workspaceId },
      data: { status: "sent", sentAt: new Date() },
    });
    return;
  }

  if (req.action === "price.override") {
    const quote = await prisma.quote.findFirst({
      where: { id: req.entityId, workspaceId },
      select: { id: true },
    });
    if (!quote) return;
    const p = (req.payload ?? {}) as { label?: string; amount?: number };
    const count = await prisma.quoteLine.count({ where: { quoteId: quote.id } });
    await prisma.quoteLine.create({
      data: {
        quoteId: quote.id,
        description: p.label ?? "Approved discount",
        quantity: 1,
        unitPrice: typeof p.amount === "number" ? p.amount : 0, // negative = discount
        taxRate: 0,
        position: count,
      },
    });
    await recomputeQuote(quote.id);
  }
}
