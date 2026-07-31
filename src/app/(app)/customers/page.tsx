import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg } from "@/lib/org-context";
import { listCustomers } from "@/lib/services/customers";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: PageProps<"/customers">) {
  const ctx = await requireOrg();
  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q : undefined;
  const customers = await listCustomers(ctx, search);

  return (
    <>
      <PageHeader
        title="Customers"
        description="Customer projections built from source-system events. Matching is exact-only; records are never merged fuzzily."
      >
        <form className="flex items-center gap-2">
          <Input name="q" placeholder="Search name, email, phone…" defaultValue={search} />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </PageHeader>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Email</th>
              <th className="px-4 py-2.5 font-medium">Phone</th>
              <th className="px-4 py-2.5 font-medium">Language</th>
              <th className="px-4 py-2.5 font-medium">Opportunities</th>
              <th className="px-4 py-2.5 font-medium">Last interaction</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {customers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No customers yet.
                </td>
              </tr>
            ) : (
              customers.map((customer) => (
                <tr key={customer.id} className="hover:bg-muted/50">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/customers/${customer.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {customer.name ?? "Unnamed"}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{customer.email ?? "—"}</td>
                  <td className="px-4 py-2.5">{customer.phone ?? "—"}</td>
                  <td className="px-4 py-2.5">{customer.preferredLanguage ?? "—"}</td>
                  <td className="px-4 py-2.5">{customer._count.opportunities}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {formatDateTime(customer.lastInteractionAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
