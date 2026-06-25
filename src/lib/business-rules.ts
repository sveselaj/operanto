import { z } from "zod";

/**
 * Business rules (pure) — the vertical's qualification + pricing policy as data.
 *
 * A rule's `definition` is a typed, Zod-validated JSON object (same philosophy
 * as Automations). The evaluator applies them to a quote context: pricing
 * modifiers produce adjustments; service_area / min_order / eligibility produce
 * violations the agent must resolve.
 */

export const serviceAreaSchema = z.object({
  type: z.literal("service_area"),
  regions: z.array(z.string().min(1)).min(1),
});
export const minOrderSchema = z.object({
  type: z.literal("min_order"),
  amount: z.number().min(0),
});
export const eligibilitySchema = z.object({
  type: z.literal("eligibility"),
  requireRequirementKeys: z.array(z.string().min(1)).min(1),
});
export const pricingModifierSchema = z
  .object({
    type: z.literal("pricing_modifier"),
    label: z.string().min(1),
    kind: z.enum(["discount", "surcharge"]),
    percent: z.number().optional(), // % of subtotal
    amount: z.number().optional(), // absolute
  })
  .refine((d) => d.percent != null || d.amount != null, {
    message: "Provide a percent or an amount",
  });

export const ruleDefinitionSchema = z.discriminatedUnion("type", [
  serviceAreaSchema,
  minOrderSchema,
  eligibilitySchema,
  pricingModifierSchema,
]);
export type RuleDefinition = z.infer<typeof ruleDefinitionSchema>;

export const RULE_TYPES = [
  { value: "pricing_modifier", label: "Pricing modifier (discount/surcharge)" },
  { value: "min_order", label: "Minimum order value" },
  { value: "service_area", label: "Service area" },
  { value: "eligibility", label: "Eligibility (required facts)" },
] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

export type RuleInput = { name: string; priority: number; definition: unknown };
export type EvalContext = {
  subtotal: number;
  location?: string | null;
  providedRequirementKeys?: string[];
};
export type Adjustment = { label: string; amount: number }; // signed: discount < 0
export type RuleEvaluation = {
  adjustments: Adjustment[];
  violations: string[];
  totalAdjustment: number;
};

/** Apply enabled rules (caller filters) to a quote context, lowest priority first. */
export function evaluateRules(rules: RuleInput[], ctx: EvalContext): RuleEvaluation {
  const adjustments: Adjustment[] = [];
  const violations: string[] = [];
  const provided = ctx.providedRequirementKeys ?? [];

  for (const r of [...rules].sort((a, b) => a.priority - b.priority)) {
    const parsed = ruleDefinitionSchema.safeParse(r.definition);
    if (!parsed.success) continue;
    const d = parsed.data;

    if (d.type === "service_area") {
      const loc = ctx.location?.toLowerCase() ?? "";
      if (loc && !d.regions.some((reg) => loc.includes(reg.toLowerCase()))) {
        violations.push(`${r.name}: location "${ctx.location}" is outside the service area`);
      }
    } else if (d.type === "min_order") {
      if (ctx.subtotal < d.amount) {
        violations.push(`${r.name}: order ${ctx.subtotal} is below the minimum ${d.amount}`);
      }
    } else if (d.type === "eligibility") {
      const missing = d.requireRequirementKeys.filter((k) => !provided.includes(k));
      if (missing.length) violations.push(`${r.name}: missing ${missing.join(", ")}`);
    } else {
      // pricing_modifier
      let amt = 0;
      if (d.percent != null) amt += ctx.subtotal * (d.percent / 100);
      if (d.amount != null) amt += d.amount;
      const signed = d.kind === "discount" ? -Math.abs(amt) : Math.abs(amt);
      adjustments.push({ label: d.label, amount: round2(signed) });
    }
  }

  const totalAdjustment = round2(adjustments.reduce((s, a) => s + a.amount, 0));
  return { adjustments, violations, totalAdjustment };
}
