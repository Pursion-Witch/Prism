export const DEFAULT_REGION = 'Cebu City';
export const DEFAULT_MARKET_NAME = 'Carbon Public Market';
export const DEFAULT_STALL_NAME = 'Stall A-01';
export const DEFAULT_CATEGORY = 'GENERAL';

export function defaultStallNameFromIndex(index: number): string {
  return `Stall A-${String((index % 60) + 1).padStart(2, '0')}`;
}
