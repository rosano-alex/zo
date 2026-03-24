import React, { memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { usePulse } from '@codigos/lane-x';
import { pricePulses, prevPulses } from '../../store/cryptoStore';
import { counters } from '../../store/renderCounters';
import { TICKERS } from '../../data/coins';

interface Props {
  index: number;
}

// memo ensures this only re-renders when its own pulses fire — not when siblings change.
const CoinCard = memo(function CoinCard({ index }: Props) {
  counters.laneX++; // track this render

  const price = usePulse(pricePulses[index]);
  const prev  = usePulse(prevPulses[index]);
  const ticker = TICKERS[index];

  const pct = prev === 0 ? 0 : ((price - prev) / prev) * 100;
  const up   = price > prev;
  const down = price < prev;

  return (
    <Box sx={{
      p: '4px 6px',
      borderRadius: 1,
      bgcolor: 'background.paper',
      border: '1px solid',
      borderColor: up ? 'success.dark' : down ? 'error.dark' : 'divider',
    }}>
      <Typography variant="caption" display="block" color="text.secondary" fontWeight={700} lineHeight={1.2}>
        {ticker}
      </Typography>
      <Typography variant="caption" display="block" fontWeight={700} fontSize="0.65rem" lineHeight={1.3}>
        ${price.toFixed(2)}
      </Typography>
      <Typography
        variant="caption"
        display="block"
        fontSize="0.6rem"
        lineHeight={1.2}
        color={up ? 'success.main' : down ? 'error.main' : 'text.disabled'}
      >
        {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
      </Typography>
    </Box>
  );
});

export default CoinCard;
