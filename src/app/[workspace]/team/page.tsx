import { requireWorkspace, scope } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  agent: "Agent",
  reviewer: "Reviewer",
  client_viewer: "Client viewer",
};

export default async function TeamPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspace(slug);

  const members = await prisma.workspaceMember.findMany({
    where: { ...scope(ctx) },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <>
      <PageHeader title="Team" description={`${members.length} members in this workspace.`} />
      <div className="px-6 py-5">
        <Card className="divide-y divide-border">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-5 py-3">
              <Avatar name={m.user.name} src={m.user.avatarUrl} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{m.user.name}</div>
                <div className="truncate text-xs text-muted-foreground">{m.user.email}</div>
              </div>
              <Badge variant={m.status === "active" ? "success" : "warning"}>
                {m.status}
              </Badge>
              <Badge variant="outline">{ROLE_LABELS[m.role] ?? m.role}</Badge>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
