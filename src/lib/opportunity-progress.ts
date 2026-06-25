import type { RequirementStatus } from "@prisma/client";

/**
 * Lead-qualification progress (pure). Given an opportunity's requirements,
 * report how complete it is and which required facts are still missing — the
 * core of "what information do we still need to quote?".
 */

export type RequirementLike = {
  label: string;
  status: RequirementStatus;
  required: boolean;
};

export type RequirementProgress = {
  total: number;
  provided: number;
  requiredTotal: number;
  requiredProvided: number;
  missingRequired: string[]; // labels of required facts not yet provided
  complete: boolean; // no required fact is missing
};

export function requirementProgress(reqs: RequirementLike[]): RequirementProgress {
  let provided = 0;
  let requiredTotal = 0;
  let requiredProvided = 0;
  const missingRequired: string[] = [];

  for (const r of reqs) {
    const isProvided = r.status === "provided";
    if (isProvided) provided++;
    if (r.required) {
      requiredTotal++;
      if (isProvided) requiredProvided++;
      else missingRequired.push(r.label);
    }
  }

  return {
    total: reqs.length,
    provided,
    requiredTotal,
    requiredProvided,
    missingRequired,
    complete: missingRequired.length === 0,
  };
}
