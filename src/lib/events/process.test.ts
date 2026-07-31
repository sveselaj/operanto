import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The retry sweep is a safety net that normally does nothing (after() usually
 * wins), so acceptance tests cannot prove it works — a no-op sweep would leave
 * them green. These tests exercise it directly.
 */

const prismaMock = vi.hoisted(() => ({
  inboundEvent: {
    updateMany: vi.fn(),
    findMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  },
  integration: { update: vi.fn() },
  auditEvent: { create: vi.fn() },
  $transaction: vi.fn(async (arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : undefined,
  ),
}));

const handleEventMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/events/handlers", () => ({ handleEvent: handleEventMock }));
vi.mock("@/lib/audit", () => ({ auditSystem: vi.fn() }));

const { processInboundEvent, retryPendingEvents, MAX_ATTEMPTS } = await import(
  "@/lib/events/process"
);

const EVENT = {
  id: "ie_1",
  organisationId: "org_1",
  integrationId: "int_1",
  eventId: "evt_1",
  eventType: "lead.created",
  attemptCount: 0,
  correlationId: null,
  processingStatus: "RECEIVED",
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.inboundEvent.findUniqueOrThrow.mockResolvedValue({ ...EVENT });
  handleEventMock.mockResolvedValue({ outcome: "projected", summary: "ok" });
});

describe("processInboundEvent", () => {
  it("claims atomically and marks PROCESSED on success", async () => {
    prismaMock.inboundEvent.updateMany.mockResolvedValue({ count: 1 });
    const outcome = await processInboundEvent("ie_1");
    expect(outcome).toBe("processed");

    const claim = prismaMock.inboundEvent.updateMany.mock.calls[0][0];
    // Only claimable states, only below the attempt ceiling, and the claim
    // itself increments the counter — this is what prevents double execution.
    expect(claim.where.OR[0].processingStatus.in).toEqual(["RECEIVED", "FAILED"]);
    expect(claim.where.attemptCount.lt).toBe(MAX_ATTEMPTS);
    expect(claim.data.processingStatus).toBe("PROCESSING");
    expect(claim.data.attemptCount).toEqual({ increment: 1 });
    expect(handleEventMock).toHaveBeenCalledTimes(1);
  });

  it("does not run the handler when the claim is lost to another worker", async () => {
    prismaMock.inboundEvent.updateMany.mockResolvedValue({ count: 0 });
    const outcome = await processInboundEvent("ie_1");
    expect(outcome).toBe("not_claimed");
    expect(handleEventMock).not.toHaveBeenCalled();
  });

  it("does not claim in-flight PROCESSING rows unless allowStale is set", async () => {
    prismaMock.inboundEvent.updateMany.mockResolvedValue({ count: 1 });
    await processInboundEvent("ie_1");
    const normalClaim = prismaMock.inboundEvent.updateMany.mock.calls[0][0];
    expect(JSON.stringify(normalClaim.where.OR)).not.toContain("PROCESSING");

    vi.clearAllMocks();
    prismaMock.inboundEvent.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.inboundEvent.findUniqueOrThrow.mockResolvedValue({ ...EVENT });
    handleEventMock.mockResolvedValue({ outcome: "projected", summary: "ok" });
    await processInboundEvent("ie_1", { allowStale: true });
    const staleClaim = prismaMock.inboundEvent.updateMany.mock.calls[0][0];
    const staleBranch = staleClaim.where.OR.find(
      (branch: { processingStatus?: string }) =>
        branch.processingStatus === "PROCESSING",
    );
    // …and even then only rows older than the staleness window.
    expect(staleBranch).toBeTruthy();
    expect(staleBranch.receivedAt.lt).toBeInstanceOf(Date);
  });

  it("marks FAILED with the error, and DEAD_LETTER on the final attempt", async () => {
    prismaMock.inboundEvent.updateMany.mockResolvedValue({ count: 1 });
    handleEventMock.mockRejectedValue(new Error("boom"));

    expect(await processInboundEvent("ie_1")).toBe("failed");
    let update = prismaMock.inboundEvent.update.mock.calls.at(-1)?.[0];
    expect(update.data.processingStatus).toBe("FAILED");
    expect(update.data.lastError).toContain("boom");

    vi.clearAllMocks();
    prismaMock.inboundEvent.updateMany.mockResolvedValue({ count: 1 });
    // The claim has already incremented the counter, so a row that comes back
    // with attemptCount === MAX_ATTEMPTS has just used its last attempt.
    prismaMock.inboundEvent.findUniqueOrThrow.mockResolvedValue({
      ...EVENT,
      attemptCount: MAX_ATTEMPTS,
    });
    handleEventMock.mockRejectedValue(new Error("boom"));
    expect(await processInboundEvent("ie_1")).toBe("dead_letter");
    update = prismaMock.inboundEvent.update.mock.calls.at(-1)?.[0];
    expect(update.data.processingStatus).toBe("DEAD_LETTER");
  });
});

describe("attempt accounting", () => {
  it("uses every claimable attempt before dead-lettering", async () => {
    // attemptCount = MAX_ATTEMPTS - 1 still has one attempt left…
    prismaMock.inboundEvent.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.inboundEvent.findUniqueOrThrow.mockResolvedValue({
      ...EVENT,
      attemptCount: MAX_ATTEMPTS - 1,
    });
    handleEventMock.mockRejectedValue(new Error("boom"));
    expect(await processInboundEvent("ie_1")).toBe("failed");
  });
});

describe("retryPendingEvents", () => {
  it("selects FAILED and stuck rows below the attempt ceiling, and processes them", async () => {
    prismaMock.inboundEvent.findMany.mockResolvedValue([{ id: "ie_1" }, { id: "ie_2" }]);
    prismaMock.inboundEvent.updateMany.mockResolvedValue({ count: 1 });

    const result = await retryPendingEvents();

    const where = prismaMock.inboundEvent.findMany.mock.calls[0][0].where;
    expect(where.attemptCount.lt).toBe(MAX_ATTEMPTS);
    const statuses = JSON.stringify(where.OR);
    expect(statuses).toContain("FAILED");
    expect(statuses).toContain("RECEIVED");
    expect(statuses).toContain("PROCESSING");
    expect(handleEventMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ scanned: 2, processed: 2, failed: 0 });
  });

  it("never resurrects dead-lettered events", async () => {
    prismaMock.inboundEvent.findMany.mockResolvedValue([]);
    await retryPendingEvents();
    const where = prismaMock.inboundEvent.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain("DEAD_LETTER");
  });
});
