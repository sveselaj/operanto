/** Example prompts shown in the cockpit, tailored to the active vertical. */
export function suggestionsFor(vertical: string | null | undefined): string[] {
  if (vertical === "real-estate") {
    return [
      "Show buyers from Germany looking for apartments in Prishtina above €120,000",
      "Find leads not contacted in the last 7 days",
      "Is PR-1042 still available?",
      "Draft an Instagram post for PR-1042",
    ];
  }
  return [
    "Show my open conversations with the highest lead scores",
    "Find leads not contacted in the last 7 days",
    "Summarize today's new inquiries",
    "Draft a reply for the latest pricing question",
  ];
}
