import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OrgContext } from "@/lib/org-context";
import { signOutAction, switchOrganisationAction } from "@/app/(app)/actions";

type OrgOption = { organisationId: string; name: string };

export function Topbar({
  ctx,
  organisations,
  unreadNotifications = 0,
  showNotifications = false,
}: {
  ctx: OrgContext;
  organisations: OrgOption[];
  unreadNotifications?: number;
  showNotifications?: boolean;
}) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-3">
        {organisations.length > 1 ? (
          <form action={switchOrganisationAction} className="flex items-center gap-2">
            <select
              name="organisationId"
              defaultValue={ctx.organisation.id}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Organisation"
            >
              {organisations.map((org) => (
                <option key={org.organisationId} value={org.organisationId}>
                  {org.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" size="sm">
              Switch
            </Button>
          </form>
        ) : (
          <span className="text-sm font-medium">{ctx.organisation.name}</span>
        )}
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
          {ctx.membership.role}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {showNotifications ? (
          <Link
            href="/notifications"
            aria-label={
              unreadNotifications > 0
                ? `Notifications: ${unreadNotifications} unread`
                : "Notifications"
            }
            className="relative rounded-md p-2 hover:bg-accent"
          >
            <Bell className="h-4 w-4" aria-hidden />
            {unreadNotifications > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
                {unreadNotifications > 9 ? "9+" : unreadNotifications}
              </span>
            ) : null}
          </Link>
        ) : null}
        <span className="text-sm text-muted-foreground">{ctx.user.name}</span>
        <form action={signOutAction}>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
