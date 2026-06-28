import { describe, expect, it } from "vitest";

type ChainDeadlineInstance = {
  readonly startedAt: number;
  readonly budgetMs: number;
  elapsedMs(): number;
  remainingMs(maxStepMs?: number): number;
  assertRemaining(minMs?: number): void;
};

type ChainDeadlineModule = {
  ChainDeadline: new (options: {
    budgetMs: number;
    now?: () => number;
  }) => ChainDeadlineInstance;
  ChainBudgetExceededError: new (...args: unknown[]) => Error;
};

const loadChainDeadline = async (): Promise<ChainDeadlineModule> =>
  (await import("../chain-deadline")) as ChainDeadlineModule;

describe("ChainDeadline", () => {
  it("returns the lesser of remaining wall-clock budget and maxStepMs", async () => {
    const { ChainDeadline } = await loadChainDeadline();
    let now = 10_000;
    const deadline = new ChainDeadline({ budgetMs: 1_000, now: () => now });

    now = 10_250;

    expect(deadline.startedAt).toBe(10_000);
    expect(deadline.budgetMs).toBe(1_000);
    expect(deadline.elapsedMs()).toBe(250);
    expect(deadline.remainingMs(600)).toBe(600);
    expect(deadline.remainingMs(900)).toBe(750);
  });

  it("throws a typed retryable chain budget error when no time remains", async () => {
    const { ChainDeadline, ChainBudgetExceededError } = await loadChainDeadline();
    let now = 50_000;
    const deadline = new ChainDeadline({ budgetMs: 1_000, now: () => now });

    now = 51_001;

    expect(deadline.remainingMs()).toBe(0);
    expect(() => deadline.assertRemaining()).toThrow(ChainBudgetExceededError);

    try {
      deadline.assertRemaining();
    } catch (error) {
      expect(error).toBeInstanceOf(ChainBudgetExceededError);
      expect(error).toMatchObject({
        code: "chain_budget_exhausted",
        retryable: true,
        budgetMs: 1_000,
        elapsedMs: 1_001,
      });
      return;
    }

    throw new Error("Expected ChainDeadline.assertRemaining() to throw.");
  });
});
