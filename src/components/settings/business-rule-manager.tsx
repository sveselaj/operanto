"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { BusinessRule } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RULE_TYPES } from "@/lib/business-rules";
import {
  createBusinessRuleAction,
  setRuleEnabledAction,
  deleteBusinessRuleAction,
  type ActionResult,
} from "@/app/[workspace]/settings/actions";

type RuleType = (typeof RULE_TYPES)[number]["value"];

export function BusinessRuleManager({ slug, rules }: { slug: string; rules: BusinessRule[] }) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [type, setType] = useState<RuleType>("pricing_modifier");
  const [priority, setPriority] = useState("0");
  const [error, setError] = useState<string | null>(null);
  // type-specific fields
  const [kind, setKind] = useState<"discount" | "surcharge">("discount");
  const [percent, setPercent] = useState("");
  const [amount, setAmount] = useState("");
  const [regions, setRegions] = useState("");
  const [keys, setKeys] = useState("");

  function run(fn: () => Promise<ActionResult>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) after?.();
      else setError(res.error);
    });
  }

  function buildDefinition(): unknown {
    if (type === "pricing_modifier")
      return {
        type,
        label: name,
        kind,
        ...(percent ? { percent: Number(percent) } : {}),
        ...(amount ? { amount: Number(amount) } : {}),
      };
    if (type === "min_order") return { type, amount: Number(amount || 0) };
    if (type === "service_area")
      return { type, regions: regions.split(",").map((s) => s.trim()).filter(Boolean) };
    return { type, requireRequirementKeys: keys.split(",").map((s) => s.trim()).filter(Boolean) };
  }

  function submit() {
    if (!name.trim()) {
      setError("Rule name is required.");
      return;
    }
    run(
      () => createBusinessRuleAction(slug, { name, priority: Number(priority) || 0, definition: buildDefinition() }),
      () => {
        setName(""); setPercent(""); setAmount(""); setRegions(""); setKeys("");
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-border p-3">
        <div className="grid gap-2 sm:grid-cols-[1.4fr_1.2fr_0.5fr]">
          <Field label="Rule name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spring 10% off" />
          </Field>
          <Field label="Type">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as RuleType)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {RULE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <Input value={priority} inputMode="numeric" onChange={(e) => setPriority(e.target.value)} />
          </Field>
        </div>

        {type === "pricing_modifier" && (
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Kind">
              <select value={kind} onChange={(e) => setKind(e.target.value as "discount" | "surcharge")} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                <option value="discount">Discount</option>
                <option value="surcharge">Surcharge</option>
              </select>
            </Field>
            <Field label="Percent of subtotal"><Input value={percent} inputMode="decimal" onChange={(e) => setPercent(e.target.value)} /></Field>
            <Field label="Or fixed amount"><Input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} /></Field>
          </div>
        )}
        {type === "min_order" && (
          <Field label="Minimum order value"><Input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} /></Field>
        )}
        {type === "service_area" && (
          <Field label="Allowed regions (comma-separated)"><Input value={regions} onChange={(e) => setRegions(e.target.value)} placeholder="Prishtina, Tirana" /></Field>
        )}
        {type === "eligibility" && (
          <Field label="Required requirement keys (comma-separated)"><Input value={keys} onChange={(e) => setKeys(e.target.value)} placeholder="location, item_count" /></Field>
        )}

        <div className="flex items-center gap-3">
          <Button size="sm" onClick={submit} disabled={pending}><Plus className="size-3.5" /> Add rule</Button>
          {error && <span className="text-xs text-danger">{error}</span>}
        </div>
      </div>

      <div className="space-y-1.5">
        {rules.length === 0 && <p className="text-sm text-muted-foreground">No business rules yet.</p>}
        {rules.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">{r.name}</span>
              <Badge variant="outline">{r.type}</Badge>
              <span className="text-xs text-muted-foreground">p{r.priority}</span>
              {!r.enabled && <Badge variant="default">disabled</Badge>}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => run(() => setRuleEnabledAction(slug, r.id, !r.enabled))} className="text-xs text-muted-foreground hover:text-foreground">
                {r.enabled ? "Disable" : "Enable"}
              </button>
              <button onClick={() => run(() => deleteBusinessRuleAction(slug, r.id))} className="text-muted-foreground hover:text-danger" title="Delete"><Trash2 className="size-3.5" /></button>
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
