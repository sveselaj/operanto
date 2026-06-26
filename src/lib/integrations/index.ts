import type { IntegrationConnector } from "./types";
import { WebhookConnector } from "./providers/webhook";
import { HubSpotConnector } from "./providers/hubspot";

export * from "./types";

const REGISTRY: Record<string, IntegrationConnector> = {
  webhook: new WebhookConnector(),
  hubspot: new HubSpotConnector(),
};

export const INTEGRATION_PROVIDERS = Object.keys(REGISTRY);

export function getIntegrationConnector(provider: string): IntegrationConnector | null {
  return REGISTRY[provider] ?? null;
}

/** Prefer a configured real CRM (HubSpot); fall back to the generic webhook. */
export function preferredCrmProvider(): string {
  return REGISTRY.hubspot.isConfigured() ? "hubspot" : "webhook";
}
