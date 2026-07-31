import { describe, expect, it } from "vitest";
import { stageFromSourceStatus } from "@/lib/events/handlers";

describe("stageFromSourceStatus", () => {
  it("maps every Pronatona LeadStatus to an Operanto stage", () => {
    expect(stageFromSourceStatus("NEW")).toBe("NEW");
    expect(stageFromSourceStatus("CONTACTED")).toBe("QUALIFYING");
    expect(stageFromSourceStatus("QUALIFYING")).toBe("QUALIFYING");
    expect(stageFromSourceStatus("VIEWING_REQUESTED")).toBe("VIEWING_REQUESTED");
    expect(stageFromSourceStatus("VIEWING_SCHEDULED")).toBe("VIEWING_SCHEDULED");
    expect(stageFromSourceStatus("OFFER")).toBe("OFFER");
    expect(stageFromSourceStatus("WON")).toBe("WON");
    expect(stageFromSourceStatus("LOST")).toBe("LOST");
    expect(stageFromSourceStatus("CLOSED")).toBe("CLOSED");
  });

  it("returns null for unknown statuses (source status is still preserved)", () => {
    expect(stageFromSourceStatus("SOMETHING_NEW")).toBeNull();
  });
});
