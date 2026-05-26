import { auth } from "@/lib/auth";
import { requireWorkspace, listMyWorkspaces } from "@/lib/workspace";
import { visibleModules } from "@/lib/rbac";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { CommandBar } from "@/components/layout/command-bar";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  agent: "Agent",
  reviewer: "Reviewer",
  client_viewer: "Client viewer",
};

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspace(slug);
  const [session, memberships] = await Promise.all([auth(), listMyWorkspaces()]);

  const visible = visibleModules(ctx.member.role);

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar
        workspaceSlug={ctx.workspace.slug}
        workspaceName={ctx.workspace.name}
        visible={visible}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          current={{ slug: ctx.workspace.slug, name: ctx.workspace.name }}
          workspaces={memberships.map((m) => ({
            slug: m.workspace.slug,
            name: m.workspace.name,
          }))}
          user={{
            name: session?.user?.name,
            email: session?.user?.email,
            image: session?.user?.image,
          }}
          roleLabel={ROLE_LABELS[ctx.member.role] ?? ctx.member.role}
        />
        <main className="flex-1 overflow-y-auto">{children}</main>
        <CommandBar />
      </div>
    </div>
  );
}
