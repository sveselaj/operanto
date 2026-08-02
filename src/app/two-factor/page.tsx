import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrgAllowingEnrolment } from "@/lib/org-context";
import {
  roleRequiresTwoFactor,
  twoFactorStatus,
} from "@/lib/services/two-factor";
import { signOutAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { TwoFactorPanel } from "@/app/(app)/settings/security/two-factor-panel";

export const metadata: Metadata = { title: "Set up two-factor authentication" };

/**
 * Deliberately outside the (app) layout: that layout redirects privileged
 * users here until they enrol, so hosting enrolment inside it would loop.
 */
export default async function TwoFactorSetupPage() {
  const ctx = await requireOrgAllowingEnrolment();
  const status = await twoFactorStatus(ctx.user.id);
  const required = roleRequiresTwoFactor(ctx.membership.role);

  // Nothing to do here if it is already on, or not required for this role.
  if (status.active || !required) redirect("/settings/security");

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 block text-center text-xl font-semibold tracking-tight">
          Operanto
        </Link>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h1 className="mb-1 text-lg font-semibold">
            Set up two-factor authentication
          </h1>
          <p className="mb-6 text-sm text-muted-foreground">
            Your role ({ctx.membership.role}) can read every customer in{" "}
            {ctx.organisation.name}, so a second step at sign-in is required
            before you can continue.
          </p>
          <TwoFactorPanel
            active={false}
            required
            recoveryCodesRemaining={status.recoveryCodesRemaining}
          />
          <div className="mt-6 border-t border-border pt-4">
            <form action={signOutAction}>
              <Button type="submit" variant="outline" size="sm">
                Sign out instead
              </Button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
