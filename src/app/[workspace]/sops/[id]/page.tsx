import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { getSOP } from "@/lib/services/sops";
import { SopEditor } from "@/components/sops/sop-editor";

export default async function SopDetailPage({
  params,
}: {
  params: Promise<{ workspace: string; id: string }>;
}) {
  const { workspace: slug, id } = await params;
  const ctx = await requireWorkspace(slug);
  const sop = await getSOP(ctx, id);
  if (!sop) notFound();

  return (
    <SopEditor
      slug={slug}
      sop={{
        id: sop.id,
        title: sop.title,
        description: sop.description,
        category: sop.category,
        body: sop.body,
        status: sop.status,
        version: sop.version,
      }}
      canEdit={can(ctx.member.role, "sops:create")}
      canApprove={can(ctx.member.role, "sops:approve")}
      meta={{ createdBy: sop.createdBy?.name, approvedBy: sop.approvedBy?.name }}
    />
  );
}
