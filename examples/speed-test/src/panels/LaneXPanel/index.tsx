import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useComputed } from '@codigos/lane-x';
import CoinCard from './CoinCard';
import { sectorAvgs, portfolioTotal } from '../../store/cryptoStore';
import { TICKERS, SECTORS } from '../../data/coins';

// Reactive sector badge — re-renders only when its sector avg changes
function SectorBadge({ index }: { index: number }) {
  const avg = useComputed(() => sectorAvgs[index].get());
  return (
    <Box sx={{ px: 1, py: 0.25, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="caption" color="text.secondary">{SECTORS[index]} </Typography>
      <Typography variant="caption" fontWeight={700}>${avg.toFixed(0)}</Typography>
    </Box>
  );
}

// Reactive total — re-renders only when portfolio total changes
function PortfolioTotal() {
  const total = useComputed(() => portfolioTotal.get());
  return <Typography variant="h6" fontWeight={700} color="text.primary">${total.toFixed(0)}</Typography>;
}

// LaneXPanel itself never re-renders after mount — all reactivity is in children
export default function LaneXPanel() {
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.75 }}>
        <Box>
          <Typography variant="subtitle2" color="success.main" fontWeight={700}>lane-x + React</Typography>
          <Typography variant="caption" color="text.disabled">Only changed cells re-render</Typography>
        </Box>
        <PortfolioTotal />
      </Box>

      <Box sx={{ display: 'flex', gap: 0.5, mb: 0.75, flexWrap: 'wrap' }}>
        {SECTORS.map((_, i) => <SectorBadge key={i} index={i} />)}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(68px, 1fr))', gap: '4px' }}>
        {TICKERS.map((_, i) => <CoinCard key={i} index={i} />)}
      </Box>
    </Box>
  );
}
