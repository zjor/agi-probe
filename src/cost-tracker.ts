// Claude pricing per million tokens (sonnet 4)
const INPUT_COST_PER_M = 3.0;
const OUTPUT_COST_PER_M = 15.0;

export function computeCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * INPUT_COST_PER_M + (outputTokens / 1_000_000) * OUTPUT_COST_PER_M;
}

export interface CostTracker {
  /** Reserve estimated cost before an API call. Returns false if would exceed budget. */
  reserveCost(estimatedUsd: number): boolean;
  /** Settle after API call: release the reservation and record actual cost. */
  settleCost(reservedUsd: number, actualInputTokens: number, actualOutputTokens: number): void;
  /** Release reservation without recording cost (e.g., on API error). */
  releaseReservation(reservedUsd: number): void;
  getCumulativeCost(): number;
  isWithinBudget(): boolean;
}

const DEFAULT_RESERVATION_USD = 0.02;

export function createCostTracker(costLimitUsd: number): CostTracker {
  let cumulativeCostUsd = 0;
  let reservedCostUsd = 0;

  return {
    reserveCost(estimatedUsd: number = DEFAULT_RESERVATION_USD): boolean {
      if (cumulativeCostUsd + reservedCostUsd + estimatedUsd >= costLimitUsd) {
        return false;
      }
      reservedCostUsd += estimatedUsd;
      return true;
    },

    settleCost(reservedUsd: number, actualInputTokens: number, actualOutputTokens: number): void {
      reservedCostUsd = Math.max(0, reservedCostUsd - reservedUsd);
      cumulativeCostUsd += computeCost(actualInputTokens, actualOutputTokens);
    },

    releaseReservation(reservedUsd: number): void {
      reservedCostUsd = Math.max(0, reservedCostUsd - reservedUsd);
    },

    getCumulativeCost(): number {
      return cumulativeCostUsd;
    },

    isWithinBudget(): boolean {
      return cumulativeCostUsd + reservedCostUsd < costLimitUsd;
    },
  };
}
