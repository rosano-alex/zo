import React, { useState, useRef, useCallback, useEffect } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';

import AppHeader from './components/AppHeader';
import Controls from './components/Controls';
import Scoreboard, { Stats } from './components/Scoreboard';
import StandardPanel, { StandardPanelRef } from './panels/StandardPanel';
import LaneXPanel from './panels/LaneXPanel';

import { getInitialPrices } from './data/coins';
import { FeedEngine } from './data/feed';
import { applyTick, resetCryptoStore } from './store/cryptoStore';
import { counters, resetCounters } from './store/renderCounters';
import type { Tick } from './data/feed';

const EMPTY_STATS: Stats = { ticks: 0, rendersThisTick: 0, totalRenders: 0, avgUpdateMs: 0 };

export default function App() {
  const [isRunning, setIsRunning]    = useState(false);
  const [tickCount, setTickCount]    = useState(0);
  const [changesPerTick, setChanges] = useState(10);
  const [intervalMs, setInterval_]   = useState(200);
  const [stdStats, setStdStats]      = useState<Stats>({ ...EMPTY_STATS });
  const [lxStats,  setLxStats]       = useState<Stats>({ ...EMPTY_STATS });

  const standardRef = useRef<StandardPanelRef>(null);
  const feedRef     = useRef<FeedEngine | null>(null);
  const initialRef  = useRef<number[]>(getInitialPrices());

  // Accumulators (refs — not state, updated every tick)
  const stdTimings  = useRef<number[]>([]);
  const lxTimings   = useRef<number[]>([]);
  const stdTotal    = useRef(0);
  const lxTotal     = useRef(0);
  const tickRef     = useRef(0);

  // Called on every tick by FeedEngine
  const handleTick = useCallback((tick: Tick) => {
    resetCounters();

    const lxStart = performance.now();
    applyTick(tick);                         // update lane-x PulseNodes
    lxTimings.current.push(performance.now() - lxStart);

    const stdStart = performance.now();
    standardRef.current?.applyTick(tick);    // update standard React state
    stdTimings.current.push(performance.now() - stdStart);

    tickRef.current++;
    setTickCount(tickRef.current);
  }, []);

  // After every React commit — read render counters accumulated this cycle
  useEffect(() => {
    if (tickRef.current === 0) return;
    const n = tickRef.current;

    stdTotal.current += counters.standard;
    lxTotal.current  += counters.laneX;

    const avg = (arr: number[]) => arr.length ? arr.reduce((s, t) => s + t, 0) / arr.length : 0;

    setStdStats({ ticks: n, rendersThisTick: counters.standard, totalRenders: stdTotal.current, avgUpdateMs: avg(stdTimings.current) });
    setLxStats ({  ticks: n, rendersThisTick: counters.laneX,   totalRenders: lxTotal.current,  avgUpdateMs: avg(lxTimings.current)  });
  });

  const start = useCallback(() => {
    if (isRunning) return;
    const feed = new FeedEngine(initialRef.current, changesPerTick);
    feedRef.current = feed;
    feed.start(handleTick, intervalMs);
    setIsRunning(true);
  }, [isRunning, changesPerTick, intervalMs, handleTick]);

  const stop = useCallback(() => {
    feedRef.current?.stop();
    feedRef.current = null;
    setIsRunning(false);
  }, []);

  const reset = useCallback(() => {
    stop();
    const prices = getInitialPrices();
    initialRef.current = prices;
    standardRef.current?.reset(prices);
    resetCryptoStore(prices);
    stdTimings.current = [];
    lxTimings.current  = [];
    stdTotal.current   = 0;
    lxTotal.current    = 0;
    tickRef.current    = 0;
    setTickCount(0);
    setStdStats({ ...EMPTY_STATS });
    setLxStats ({ ...EMPTY_STATS });
  }, [stop]);

  // Init standard panel on mount
  useEffect(() => { standardRef.current?.reset(initialRef.current); }, []); // eslint-disable-line

  // Cleanup on unmount
  useEffect(() => () => feedRef.current?.stop(), []);

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppHeader tickCount={tickCount} />
      <Divider />
      <Controls
        isRunning={isRunning}
        changesPerTick={changesPerTick}
        intervalMs={intervalMs}
        onStart={start}
        onStop={stop}
        onReset={reset}
        onChangesPerTick={setChanges}
        onIntervalMs={setInterval_}
      />
      <Scoreboard standard={stdStats} laneX={lxStats} changesPerTick={changesPerTick} />
      <Divider />
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, alignItems: 'start' }}>
        <StandardPanel ref={standardRef} onRender={() => {}} />
        <LaneXPanel />
      </Box>
    </Box>
  );
}
