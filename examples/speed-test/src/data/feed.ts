export interface Tick {
  changedIndices: number[];
  newPrices: number[];
}

export class FeedEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private prices: number[];
  private changesPerTick: number;

  constructor(initialPrices: number[], changesPerTick: number) {
    this.prices = [...initialPrices];
    this.changesPerTick = changesPerTick;
  }

  start(onTick: (tick: Tick) => void, intervalMs: number): void {
    this.stop();
    this.timer = setInterval(() => {
      const indices = this.pickRandom(this.changesPerTick);
      const newPrices = [...this.prices];
      for (const i of indices) {
        const delta = (Math.random() - 0.48) * this.prices[i] * 0.03;
        newPrices[i] = Math.max(1, +(this.prices[i] + delta).toFixed(2));
      }
      this.prices = newPrices;
      onTick({ changedIndices: indices, newPrices });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  setChangesPerTick(n: number): void {
    this.changesPerTick = n;
  }

  reset(prices: number[]): void {
    this.prices = [...prices];
  }

  private pickRandom(n: number): number[] {
    const result: number[] = [];
    while (result.length < n) {
      const i = Math.floor(Math.random() * this.prices.length);
      if (!result.includes(i)) result.push(i);
    }
    return result;
  }
}
