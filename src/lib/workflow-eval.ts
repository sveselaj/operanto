/**
 * Workflow evaluation (pure). Given an ordered set of steps, the current step,
 * and which requirement keys are provided, decide whether the instance can
 * advance and what's blocking it. The "next permitted actions" come from the
 * current step's declared actions.
 */

export type StepLite = {
  key: string;
  name: string;
  order: number;
  requiredRequirementKeys: string[];
};

export type WorkflowEval = {
  currentStep: StepLite | null;
  nextStep: StepLite | null;
  missingKeys: string[];
  canAdvance: boolean;
  isLastStep: boolean;
};

export function evaluateWorkflow(
  steps: StepLite[],
  currentStepKey: string | null,
  providedKeys: string[],
): WorkflowEval {
  const ordered = [...steps].sort((a, b) => a.order - b.order);
  const idx = currentStepKey ? ordered.findIndex((s) => s.key === currentStepKey) : -1;
  const currentStep = idx >= 0 ? ordered[idx] : null;

  if (!currentStep) {
    return { currentStep: null, nextStep: null, missingKeys: [], canAdvance: false, isLastStep: false };
  }

  const missingKeys = currentStep.requiredRequirementKeys.filter((k) => !providedKeys.includes(k));
  const isLastStep = idx === ordered.length - 1;
  return {
    currentStep,
    nextStep: isLastStep ? null : ordered[idx + 1],
    missingKeys,
    canAdvance: missingKeys.length === 0,
    isLastStep,
  };
}
