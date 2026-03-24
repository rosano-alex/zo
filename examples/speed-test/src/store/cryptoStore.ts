import { PulseNode, ComputedNode } from '@codigos/lane-x';
import { getInitialPrices, SECTORS, SECTOR_SIZE, COIN_COUNT } from '../data/coins';
import type { Tick } from '../data/feed';

const initial = getInitialPrices();

// One pulse per coin — the source of truth for lane-x rendering
export const pricePulses: PulseNode<number>[] = initial.map(p => new PulseNode(p));
export const prevPulses:  PulseNode<number>[] = initial.map(p => new PulseNode(p));

// Sector averages derived lazily from coin pulses
export const sectorAvgs: ComputedNode<number>[] = SECTORS.map((_, i) =>
  new ComputedNode(() => {
    let sum = 0;
    for (let j = i * SECTOR_SIZE; j < (i + 1) * SECTOR_SIZE; j++) {
      sum += pricePulses[j].get();
    }
    return sum / SECTOR_SIZE;
  })
);

// Portfolio total — recomputes only when any price changes
export const portfolioTotal = new ComputedNode<number>(() =>
  pricePulses.reduce((s, p) => s + p.get(), 0)
);

export function applyTick(tick: Tick): void {
  for (const i of tick.changedIndices) {
    prevPulses[i].set(pricePulses[i].value);
    pricePulses[i].set(tick.newPrices[i]);
  }
}

export function resetCryptoStore(prices: number[]): void {
  for (let i = 0; i < COIN_COUNT; i++) {
    pricePulses[i].set(prices[i]);
    prevPulses[i].set(prices[i]);
  }
}
