import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CoinCard from './CoinCard';
import { TICKERS, SECTORS, SECTOR_SIZE } from '../../data/coins';
import type { Tick } from '../../data/feed';

export interface StandardPanelRef {
  applyTick: (tick: Tick) => void;
  reset: (prices: number[]) => void;
}

interface Props {
  onRender: (renderCount: number) => void;
}

const StandardPanel = forwardRef<StandardPanelRef, Props>(({ onRender }, ref) => {
  const [prices, setPrices] = useState<number[]>([]);
  const prevRef = useRef<number[]>([]);

  useImperativeHandle(ref, () => ({
    applyTick(tick) {
      setPrices(prev => {
        prevRef.current = [...prev];
        const next = [...prev];
        for (const i of tick.changedIndices) next[i] = tick.newPrices[i];
        return next;
      });
    },
    reset(newPrices) {
      prevRef.current = [...newPrices];
      setPrices([...newPrices]);
    },
  }));

  // Report render count after every React commit
  useEffect(() => { onRender(0); }, []); // mount
  useEffect(() => {
    if (prices.length > 0) onRender(prices.length); // prices.length === 100 when live
  }, [prices]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = prices.reduce((s, p) => s + p, 0);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.75 }}>
        <Box>
          <Typography variant="subtitle2" color="warning.main" fontWeight={700}>Standard React</Typography>
          <Typography variant="caption" color="text.disabled">All {TICKERS.length} cells re-render every tick</Typography>
        </Box>
        <Typography variant="h6" fontWeight={700} color="text.primary">${total.toFixed(0)}</Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 0.5, mb: 0.75, flexWrap: 'wrap' }}>
        {SECTORS.map((s, i) => {
          const avg = prices.slice(i * SECTOR_SIZE, (i + 1) * SECTOR_SIZE).reduce((a, b) => a + b, 0) / SECTOR_SIZE;
          return (
            <Box key={s} sx={{ px: 1, py: 0.25, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" color="text.secondary">{s} </Typography>
              <Typography variant="caption" fontWeight={700}>${isNaN(avg) ? '—' : avg.toFixed(0)}</Typography>
            </Box>
          );
        })}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(68px, 1fr))', gap: '4px' }}>
        {TICKERS.map((t, i) => (
          <CoinCard key={t} ticker={t} price={prices[i] ?? 0} prev={prevRef.current[i] ?? 0} />
        ))}
      </Box>
    </Box>
  );
});

export default StandardPanel;
