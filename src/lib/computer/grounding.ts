import type {
  ComputerGuideOutput,
  ComputerUnderstandOutput,
  ObservedFact,
} from "@/lib/ai/computer-tasks";

/**
 * Deterministic grounding validation (Computer C3).
 *
 * The model is untrusted-adjacent: it read hostile page content and may
 * hallucinate. Valid JSON is not truth. Before anything is persisted or
 * shown, every claim that cites the snapshot is checked AGAINST the
 * snapshot, and every suggested element is bound to observed reality:
 *
 *   THE MODEL MAY RECOMMEND A TARGET;
 *   DETERMINISTIC CODE BINDS IT TO WHAT WAS ACTUALLY OBSERVED.
 *
 * Ungrounded facts are removed (with a visible limitation), a fabricated
 * or ambiguous target is stripped, and any removal caps confidence at 0.5
 * — low confidence narrows guidance, it never widens it. This is the
 * invariant C4-style navigation would later depend on.
 */

export type GroundingSnapshot = {
  url: string | null;
  pageTitle: string | null;
  visibleTextSummary: string | null;
  elements: { role: string; name: string }[];
};

export type TargetResolution = "NONE" | "BOUND" | "AMBIGUOUS" | "NOT_FOUND";

export type GroundingReport = {
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
      factsChecked: output.observedFacts.length,
      factsRemoved: removed,
      target,
      confidenceCapped: mustCap && output.confidence > CONFIDENCE_CAP,
    },
  };
}
