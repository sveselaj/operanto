"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import type { Product, ProductType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils";
import {
  createProductAction,
  updateProductAction,
  setProductActiveAction,
  deleteProductAction,
  type ActionResult,
  type ProductInput,
} from "@/app/[workspace]/settings/actions";

const empty = { name: "", type: "product" as ProductType, sku: "", unitPrice: "", taxRate: "", unit: "" };

export function ProductManager({
  slug,
  products,
  currency,
  defaultTaxRate,
}: {
  slug: string;
  products: Product[];
  currency: string;
  defaultTaxRate: number;
}) {
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) after?.();
      else setError(res.error);
    });
  }

  function submit() {
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    const input: ProductInput = {
      name: form.name,
      type: form.type,
      sku: form.sku || null,
      unitPrice: form.unitPrice === "" ? null : Number(form.unitPrice),
      taxRate: form.taxRate === "" ? null : Number(form.taxRate),
      unit: form.unit || null,
    };
    run(
      () => (editingId ? updateProductAction(slug, editingId, input) : createProductAction(slug, input)),
      () => {
        setForm({ ...empty });
        setEditingId(null);
      },
    );
  }

  function edit(p: Product) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      type: p.type,
      sku: p.sku ?? "",
      unitPrice: p.unitPrice == null ? "" : String(p.unitPrice),
      taxRate: String(p.taxRate),
      unit: p.unit ?? "",
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid items-end gap-2 sm:grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr_0.6fr_auto]">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Type">
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as ProductType })}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="product">Product</option>
            <option value="service">Service</option>
          </select>
        </Field>
        <Field label={`Price (${currency})`}>
          <Input value={form.unitPrice} inputMode="decimal" onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} />
        </Field>
        <Field label="Tax %">
          <Input value={form.taxRate} inputMode="decimal" placeholder={String(defaultTaxRate)} onChange={(e) => setForm({ ...form, taxRate: e.target.value })} />
        </Field>
        <Field label="Unit">
          <Input value={form.unit} placeholder="each" onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        </Field>
        <Button size="sm" onClick={submit} disabled={pending}>
          {editingId ? "Save" : <><Plus className="size-3.5" /> Add</>}
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {editingId && (
        <button className="text-xs text-muted-foreground hover:underline" onClick={() => { setEditingId(null); setForm({ ...empty }); }}>
          Cancel edit
        </button>
      )}

      <div className="space-y-1.5">
        {products.length === 0 && <p className="text-sm text-muted-foreground">No products yet.</p>}
        {products.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">{p.name}</span>
              {p.sku && <span className="text-xs text-muted-foreground">{p.sku}</span>}
              <Badge variant="outline">{p.type}</Badge>
              {!p.active && <Badge variant="default">inactive</Badge>}
            </div>
            <div className="flex items-center gap-3">
              <span className="tabular-nums text-muted-foreground">
                {formatMoney(p.unitPrice, currency)}{p.unit ? `/${p.unit}` : ""} · {p.taxRate}%
              </span>
              <button onClick={() => edit(p)} className="text-muted-foreground hover:text-foreground" title="Edit"><Pencil className="size-3.5" /></button>
              <button
                onClick={() => run(() => setProductActiveAction(slug, p.id, !p.active))}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {p.active ? "Deactivate" : "Activate"}
              </button>
              <button onClick={() => run(() => deleteProductAction(slug, p.id))} className="text-muted-foreground hover:text-danger" title="Delete"><Trash2 className="size-3.5" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-muted-foreground">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
