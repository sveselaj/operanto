import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { getBlobStore } from "@/lib/storage/blob";

/**
 * Authenticated document download. Serves the stored bytes only to an active
 * member of the document's workspace who can manage opportunities.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) return new Response("Not found", { status: 404 });

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: doc.workspaceId, userId } },
  });
  if (!member || member.status !== "active" || !can(member.role, "opportunities:manage")) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const bytes = await getBlobStore().get(doc.storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": doc.mimeType,
        "content-disposition": `inline; filename="${doc.fileName.replace(/"/g, "")}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return new Response("File unavailable", { status: 410 });
  }
}
