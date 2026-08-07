import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg } from "@/lib/org-context";
import { listComputerSessions } from "@/lib/services/computer";
import { PageHeader } from "@/components/app/page-header";
import { formatDateTime } from "@/lib/format";
import { createSessionAction } from "./actions";

export const metadata: Metadata = { title: "Computer" };

/**
 * Computer workbench (C3) — the smallest surface that makes the observe →
 * understand → guide loop usable. Operanto OBSERVES pages the user shares
 * and ADVISES; it cannot click, type, or navigate anything.
 */
export default async function ComputerPage({
  searchParams,
}: PageProps<"/computer">) {
  const ctx = await requireOrg();
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const sessions = await listComputerSessions(ctx);

  return (
    <>
      <PageHeader
        title="Computer"
        description="Share a browser tab, let Operanto understand it, and get grounded guidance. Observation only — Operanto never operates the page."
      />
      {error ? (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <form action={createSessionAction} className="mb-6 flex items-end gap-2">
        <label className="flex-1 text-sm">
          <span className="mb-1 block font-medium">New session goal</span>
          <input
            name="goal"
            required
            maxLength={1000}
            placeholder="e.g. Find out what happened to my €200 SWIFT transfer sent on 28 July"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
        >
          Create session
        </button>
      </form>

      <ul className="divide-y rounded-md border">
        {sessions.length === 0 ? (
          <li className="px-3 py-6 text-sm text-muted-foreground">
            No computer sessions yet.
          </li>
        ) : (
          sessions.map((session) => (
            <li key={session.id} className="px-3 py-2 text-sm">
              <Link href={`/computer/${session.id}`} className="block hover:underline">
                <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                  {session.status}
                </span>
                {session.goal}
                <span className="ml-2 text-xs text-muted-foreground">
                  {formatDateTime(session.createdAt)}
                </span>
              </Link>
            </li>
          ))
        )}
      </ul>
    </>
  );
}
