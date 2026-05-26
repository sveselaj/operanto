import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles, ArrowRight } from "lucide-react";
import { listMyWorkspaces } from "@/lib/workspace";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function SelectWorkspacePage() {
  const memberships = await listMyWorkspaces();

  // Single workspace → go straight in.
  if (memberships.length === 1) {
    redirect(`/${memberships[0].workspace.slug}/command`);
  }

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="size-5" />
          </div>
          <h1 className="text-xl font-semibold">Choose a workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You belong to {memberships.length} workspaces.
          </p>
        </div>

        <div className="space-y-2">
          {memberships.map((m) => (
            <Link key={m.id} href={`/${m.workspace.slug}/command`}>
              <Card className="flex items-center justify-between p-4 transition-colors hover:bg-muted">
                <div>
                  <div className="font-medium">{m.workspace.name}</div>
                  <div className="text-xs text-muted-foreground">
                    /{m.workspace.slug}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="outline">{m.role}</Badge>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </div>
              </Card>
            </Link>
          ))}
          {memberships.length === 0 && (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              You are not a member of any workspace yet.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
