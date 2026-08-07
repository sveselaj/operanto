import type {
  ComputerGuideOutput,
  ComputerUnderstandOutput,
  ObservedFact,
} from "@/lib/ai/computer-tasks";

/**
 * Deterministic grounding validation (Computer C3).
 *
 * WHAT THIS PROVES — AND DELIBERATELY DOES NOT PROVE:
 *
 * It proves EVIDENCE PRESENCE: cited evidence exists verbatim (element)
 * or as a substring (text/title/url) in the snapshot, and a suggested
 * element resolves to exactly one really-observed element. It does NOT
 * prove natural-language CLAIM ENTAILMENT — a false claim citing real
 * evidence ("the transfer succeeded", evidence "SWIFT") passes the
 * evidence check. The product semantics are therefore explicit:
 *
 *   OBSERVED       = the verbatim evidence from the snapshot (verified)
 *   INTERPRETATION = the model's claim ABOUT that evidence (not verified)
 *   INFERENCE      = conclusions combining evidence and context
 *   GUIDANCE       = a recommendation for the human
 *
 * The report carries `verifies: "EVIDENCE_PRESENCE_ONLY"` so no consumer
 * can honestly present claims as deterministically proven. Future
 * execution must NEVER bind to claim/summary/pagePurpose/inference/
 * suggestedNextStep free text — the only machine-usable binding this
 * module produces is the deterministically bound ELEMENT:
 *
 *   THE MODEL MAY RECOMMEND A TARGET;
 *   DETERMINISTIC CODE BINDS IT TO WHAT WAS ACTUALLY OBSERVED.
 *
 * Ungrounded facts are removed (with a visible limitation), a fabricated
 * or ambiguous target is stripped, and any removal caps confidence at 0.5
 * — low confidence narrows guidance, it never widens it.
 */

export type GroundingSnapshot = {
  url: string | null;
  pageTitle: string | null;
  visibleTextSummary: string | null;
  elements: { role: string; name: string }[];
};

export type TargetResolution = "NONE" | "BOUND" | "AMBIGUOUS" | "NOT_FOUND";

export type GroundingReport = {
  /** What this validation establishes — never claim-level truth. */
  verifies: "EVIDENCE_PRESENCE_ONLY";
  factsChecked: number;
  factsRemoved: number;
  target: TargetResolution;
  confidenceCapped: boolean;
};

const CONFIDENCE_CAP = 0.5;

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function factIsGrounded(fact: ObservedFact, snapshot: GroundingSnapshot): boolean {
  const evidence = normalize(fact.evidence);
  if (!evidence) return false;
  switch (fact.evidenceType) {
    case "ELEMENT": {
      // Accept "role:name", bare name, or "role name" — but it must resolve
      // to an element that actually exists.
      return snapshot.elements.some((el) => {
        const role = normalize(el.role);
        const name = normalize(el.name);
        return (
          evidence === `${role}:${name}` ||
          evidence === name ||
          evidence === `${role} ${name}`
        );
      });
    }
    case "VISIBLE_TEXT":
      return normalize(snapshot.visibleTextSummary ?? "").includes(evidence);
    case "PAGE_TITLE":
      return normalize(snapshot.pageTitle ?? "").includes(evidence);
    case "URL":
      return normalize(snapshot.url ?? "").includes(evidence);
  }
}

export function groundUnderstanding<T extends ComputerUnderstandOutput>(
  output: T,
  snapshot: GroundingSnapshot,
): { output: T; report: GroundingReport } {
  const grounded = output.observedFacts.filter((fact) =>
    factIsGrounded(fact, snapshot),
  );
  const removed = output.observedFacts.length - grounded.length;

  let target: TargetResolution = "NONE";
  let suggestedElement: { role: string; name: string } | null | undefined =
    (output as Partial<ComputerGuideOutput>).suggestedElement;
  if (suggestedElement != null) {
    const matches = snapshot.elements.filter(
      (el) =>
        normalize(el.role) === normalize(suggestedElement!.role) &&
        normalize(el.name) === normalize(suggestedElement!.name),
    );
    if (matches.length === 1) {
      target = "BOUND";
      // Canonical casing from the snapshot, not from the model.
      suggestedElement = matches[0];
    } else {
      target = matches.length === 0 ? "NOT_FOUND" : "AMBIGUOUS";
      suggestedElement = null;
    }
  }

  const limitations = [...output.limitations];
  if (removed > 0) {
    limitations.push(
      `${removed} claim(s) could not be verified against the captured page and were removed.`,
    );
  }
  if (target === "NOT_FOUND") {
    limitations.push(
      "A suggested element did not exist in the captured page and was removed.",
    );
  }
  if (target === "AMBIGUOUS") {
    limitations.push(
      "More than one element matched the suggested target, so no specific element is recommended — please inspect the page yourself.",
    );
  }

  const mustCap = removed > 0 || target === "NOT_FOUND" || target === "AMBIGUOUS";
  const confidence = mustCap
    ? Math.min(output.confidence, CONFIDENCE_CAP)
    : output.confidence;

  const groundedOutput = {
    ...output,
    observedFacts: grounded,
    limitations: limitations.slice(0, 10),
    confidence,
    ...(suggestedElement !== undefined ? { suggestedElement } : {}),
  } as T;

  return {
    output: groundedOutput,
    report: {
      verifies: "EVIDENCE_PRESENCE_ONLY",
      factsChecked: output.observedFacts.length,
      factsRemoved: removed,
      target,
      confidenceCapped: mustCap && output.confidence > CONFIDENCE_CAP,
    },
  };
}
