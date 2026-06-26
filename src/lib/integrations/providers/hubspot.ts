import type { ExecResult, IntegrationConnector } from "../types";

/**
 * HubSpot CRM connector. Upserts a contact and creates a deal via the HubSpot
 * CRM v3 API using a private-app token (HUBSPOT_TOKEN). Degrades to
 * "not configured" without a token.
 *
 * Expected payload for "sync_opportunity":
 *   { contact: { email?, firstname?, phone? }, deal: { dealname, amount? } }
 */
export class HubSpotConnector implements IntegrationConnector {
  readonly provider = "hubspot";
  private base = "https://api.hubapi.com";

  private token() {
    return process.env.HUBSPOT_TOKEN || process.env.HUBSPOT_ACCESS_TOKEN || "";
  }

  isConfigured(): boolean {
    return !!this.token();
  }

  private async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg = (json.message as string) ?? `HubSpot ${res.status}`;
      throw new Error(msg);
    }
    return json;
  }

  async execute(operation: string, payload: unknown): Promise<ExecResult> {
    if (!this.isConfigured()) return { ok: false, error: "HubSpot is not configured" };
    const p = (payload ?? {}) as { contact?: Record<string, unknown>; deal?: Record<string, unknown> };
    try {
      if (operation === "sync_opportunity") {
        const contact = await this.post("/crm/v3/objects/contacts", { properties: p.contact ?? {} });
        const deal = await this.post("/crm/v3/objects/deals", { properties: p.deal ?? {} });
        return { ok: true, externalId: String(deal.id ?? ""), response: { contactId: contact.id, dealId: deal.id } };
      }
      return { ok: false, error: `Unsupported HubSpot operation: ${operation}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "HubSpot request failed" };
    }
  }
}
