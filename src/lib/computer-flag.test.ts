import { afterEach, describe, expect, it } from "vitest";
import { computerLiveApproved } from "@/lib/computer-flag";
import { COMPUTER_LIVE_EVAL_VERSION } from "@/lib/ai/computer-tasks";

/**
 * The mechanical LIVE eval gate for Computer AI tasks: mock never needs it;
 * live requires the explicit enable AND an eval-version pin matching the
 * code. A bumped prompt version (which bumps COMPUTER_LIVE_EVAL_VERSION)
 * makes a previously pinned deployment fail closed until the live fixture
 * suite is rerun and the pin updated.
 */

afterEach(() => {
  delete process.env.OPERANTO_COMPUTER_LIVE_ENABLED;
  delete process.env.OPERANTO_COMPUTER_LIVE_EVAL_VERSION;
});

describe("computerLiveApproved", () => {
  it("fails closed by default", () => {
    expect(computerLiveApproved(COMPUTER_LIVE_EVAL_VERSION)).toBe(false);
  });

  it("the enable flag alone is not enough — the eval version must be pinned", () => {
    process.env.OPERANTO_COMPUTER_LIVE_ENABLED = "1";
    expect(computerLiveApproved(COMPUTER_LIVE_EVAL_VERSION)).toBe(false);
  });

  it("a stale/wrong pinned version fails closed (prompt changed → evals must rerun)", () => {
    process.env.OPERANTO_COMPUTER_LIVE_ENABLED = "1";
    process.env.OPERANTO_COMPUTER_LIVE_EVAL_VERSION = "computer-evals@0-stale";
    expect(computerLiveApproved(COMPUTER_LIVE_EVAL_VERSION)).toBe(false);
  });

  it("the pin without the enable flag fails closed", () => {
    process.env.OPERANTO_COMPUTER_LIVE_EVAL_VERSION = COMPUTER_LIVE_EVAL_VERSION;
    expect(computerLiveApproved(COMPUTER_LIVE_EVAL_VERSION)).toBe(false);
  });

  it("the correctly approved version may proceed", () => {
    process.env.OPERANTO_COMPUTER_LIVE_ENABLED = "1";
    process.env.OPERANTO_COMPUTER_LIVE_EVAL_VERSION = COMPUTER_LIVE_EVAL_VERSION;
    expect(computerLiveApproved(COMPUTER_LIVE_EVAL_VERSION)).toBe(true);
  });
});
