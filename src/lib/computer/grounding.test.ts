import { describe, expect, it } from "vitest";
import { groundUnderstanding, type GroundingSnapshot } from "@/lib/computer/grounding";
import type { ComputerGuideOutput } from "@/lib/ai/computer-tasks";

/**
 * Deterministic grounding: the model may recommend, deterministic code binds
 * to observed reality. Fabrications are removed, ambiguity is surfaced, and
 * any removal caps confidence — low confidence narrows guidance.
 */

const SNAPSHOT: GroundingSnapshot = {
  url: "https://deposit.fictionbank.test/eur/swift",
  pageTitle: "Deposit EUR — FictionBank",
  visibleTextSummary:
    "Deposit EUR. Method: Bank transfer (SWIFT). Transfers normally arrive in 0-5 business days.",
  elements: [
    { role: "heading", name: "Deposit EUR" },
    { role: "link", name: "Orders" },
    { role: "button", name: "I've sent the funds" },
  ],
};

function guideOutput(partial: Partial<ComputerGuideOutput>): ComputerGuideOutput {
  return {
    pagePurpose: "An EUR deposit page",
    summary: "s",
    observedFacts: [],
    warnings: [],
    limitations: [],
    confidence: 0.9,
    suggestedNextStep: "Check Orders yourself.",
    suggestedElement: null,
    inferences: [],
    ...partial,
  };
}

describe("observed-fact grounding", () => {
  it("keeps facts whose evidence exists; removes fabrications and caps confidence", () => {
    const { output, report } = groundUnderstanding(
      guideOutput({
        observedFacts: [
          { claim: "SWIFT method", evidenceType: "VISIBLE_TEXT", evidence: "SWIFT" },
          { claim: "Arrival window", evidenceType: "VISIBLE_TEXT", evidence: "0-5 business days" },
          { claim: "Orders link exists", evidenceType: "ELEMENT", evidence: "link:Orders" },
          {
            claim: "Deposit already arrived",
            evidenceType: "VISIBLE_TEXT",
            evidence: "your deposit has arrived",
          },
          {
            claim: "A release button exists",
            evidenceType: "ELEMENT",
            evidence: "button:Release all funds",
          },
        ],
      }),
      SNAPSHOT,
    );
    expect(output.observedFacts).toHaveLength(3);
    expect(report.factsRemoved).toBe(2);
    expect(output.confidence).toBe(0.5);
    expect(report.confidenceCapped).toBe(true);
    expect(output.limitations.join(" ")).toContain("could not be verified");
  });

  it("accepts element evidence as role:name, bare name, or role name; matching is case/space-insensitive", () => {
    for (const evidence of ["link:Orders", "Orders", "link Orders", "  ORDERS  "]) {
      const { report } = groundUnderstanding(
        guideOutput({
          observedFacts: [{ claim: "c", evidenceType: "ELEMENT", evidence }],
        }),
        SNAPSHOT,
      );
      expect(report.factsRemoved).toBe(0);
    }
  });

  it("grounds PAGE_TITLE and URL evidence as substrings", () => {
    const { report } = groundUnderstanding(
      guideOutput({
        observedFacts: [
          { claim: "t", evidenceType: "PAGE_TITLE", evidence: "FictionBank" },
          { claim: "u", evidenceType: "URL", evidence: "/eur/swift" },
        ],
      }),
      SNAPSHOT,
    );
    expect(report.factsRemoved).toBe(0);
  });
});

describe("target binding", () => {
  it("binds an exact unique element and canonicalizes its casing", () => {
    const { output, report } = groundUnderstanding(
      guideOutput({ suggestedElement: { role: "LINK", name: "orders" } }),
      SNAPSHOT,
    );
    expect(report.target).toBe("BOUND");
    expect(output.suggestedElement).toEqual({ role: "link", name: "Orders" });
    expect(output.confidence).toBe(0.9);
  });

  it("strips a fabricated target (NOT_FOUND) and caps confidence", () => {
    const { output, report } = groundUnderstanding(
      guideOutput({
        suggestedElement: { role: "button", name: "Release all funds" },
      }),
      SNAPSHOT,
    );
    expect(report.target).toBe("NOT_FOUND");
    expect(output.suggestedElement).toBeNull();
    expect(output.confidence).toBe(0.5);
    expect(output.limitations.join(" ")).toContain("did not exist");
  });

  it("refuses to choose between duplicates (AMBIGUOUS)", () => {
    const twoOrders: GroundingSnapshot = {
      ...SNAPSHOT,
      elements: [...SNAPSHOT.elements, { role: "link", name: "Orders" }],
    };
    const { output, report } = groundUnderstanding(
      guideOutput({ suggestedElement: { role: "link", name: "Orders" } }),
      twoOrders,
    );
    expect(report.target).toBe("AMBIGUOUS");
    expect(output.suggestedElement).toBeNull();
    expect(output.confidence).toBe(0.5);
    expect(output.limitations.join(" ")).toContain("More than one element");
  });

  it("REGRESSION: a FALSE claim citing REAL evidence passes the evidence check — and is honestly labelled", () => {
    // Claim entailment is deliberately NOT proven in C3. This fixture pins
    // the semantics: the false claim survives because "SWIFT" exists, but
    // the persisted report says EVIDENCE_PRESENCE_ONLY, claim and evidence
    // stay separate fields (the UI badges evidence OBSERVED and the claim
    // INTERPRETATION), and nothing machine-usable derives from the claim.
    const { output, report } = groundUnderstanding(
      guideOutput({
        observedFacts: [
          {
            claim: "The transfer succeeded",
            evidenceType: "VISIBLE_TEXT",
            evidence: "SWIFT",
          },
        ],
        suggestedElement: null,
      }),
      SNAPSHOT,
    );
    expect(output.observedFacts).toHaveLength(1);
    expect(report.verifies).toBe("EVIDENCE_PRESENCE_ONLY");
    // Claim and verified evidence remain distinct — no merged "proven fact".
    expect(output.observedFacts[0].claim).toBe("The transfer succeeded");
    expect(output.observedFacts[0].evidence).toBe("SWIFT");
    // The only machine-usable binding is the element; free-text claims can
    // never produce one.
    expect(report.target).toBe("NONE");
    expect(output.suggestedElement).toBeNull();
  });

  it("every grounding report self-describes its semantics", () => {
    const { report } = groundUnderstanding(guideOutput({}), SNAPSHOT);
    expect(report.verifies).toBe("EVIDENCE_PRESENCE_ONLY");
  });

  it("understand-mode outputs (no target field) pass through with target NONE", () => {
    const { report } = groundUnderstanding(
      {
        pagePurpose: "p",
        summary: "s",
        observedFacts: [],
        warnings: [],
        limitations: [],
        confidence: 0.8,
      },
      SNAPSHOT,
    );
    expect(report.target).toBe("NONE");
  });
});
