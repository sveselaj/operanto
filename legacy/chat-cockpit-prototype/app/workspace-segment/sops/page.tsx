import Link from "next/link";
import { BookOpen } from "lucide-react";
import type { SopStatus } from "@prisma/client";
import { requireWorkspace } from "@/lib/workspace";
import { can } from "@/lib/rbac";
import { listSOPs } from "@/lib/services/sops";
import { relativeTime } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewSopButton, GenerateSopButton } from "@/components/sops/sop-buttons";

const STATUS_VARIANT: Record<SopStatus, "default" | "success" | "warning"> = {
  draft: "warning",
  approved: "success",
  archived: "default",
};

export default async function SopsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspace(slug);
  const sopList = await listSOPs(ctx);
  const canCreate = can(ctx.member.role, "sops:create");

  return (
    <>
      <PageHeader
        title="SOPs"
        description="Standard operating procedures your team follows."
        action={
          canCreate ? (
            <div className="flex items-center gap-2">
              <NewSopButton slug={slug} />
              <GenerateSopButton slug={slug} />
            </div>
          ) : undefined
        }
      />
      <div className="px-6 py-5">
        {sopList.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center rounded-xl border border-dashed border-border py-14 text-center">
            <BookOpen className="mb-3 size-8 text-muted-foreground opacity-40" />
            <p className="text-sm font-medium">No SOPs yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Create one manually or generate a draft with AI.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sopList.map((s) => (
              <Link key={s.id} href={`/${slug}/sops/${s.id}`}>
                <Card className="flex h-full flex-col p-4 transition-colors hover:bg-muted">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold leading-snug">{s.title}</h3>
                    <Badge variant={STATUS_VARIANT[s.status]}>{s.status}</Badge>
                  </div>
                  {s.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {s.description}
                    </p>
                  )}
                  <div className="mt-auto flex items-center gap-2 pt-3 text-[11px] text-muted-foreground">
                    {s.category && <Badge variant="outline">{s.category}</Badge>}
                    <span>v{s.version}</span>
                    <span>· {relativeTime(s.updatedAt)}</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
