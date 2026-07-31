import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/org-context";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const ctx = await getOrgContext();
  if (ctx) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 block text-center text-xl font-semibold tracking-tight">
          Operanto
        </Link>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h1 className="mb-1 text-lg font-semibold">Sign in</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            Access is by invitation. Contact your administrator if you need an
            account.
          </p>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
