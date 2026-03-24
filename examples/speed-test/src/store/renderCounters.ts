// Module-level render counters — incremented by CoinCard components during render.
// Read and reset by App.tsx after each React commit via useEffect.

export const counters = { standard: 0, laneX: 0 };

export function resetCounters(): void {
  counters.standard = 0;
  counters.laneX = 0;
}
