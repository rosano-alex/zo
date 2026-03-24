import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { counters } from '../../store/renderCounters';

interface Props {
  ticker: string;
  price: number;
  prev: number;
}

// Deliberately NO React.memo — demonstrates that standard React re-renders
// every cell whenever the top-level prices array changes.
export default function CoinCard({ ticker, price, prev }: Props) {
  counters.standard++; // track this render

  const pct = prev === 0 ? 0 : ((price - prev) / prev) * 100;
  const up = price > prev;
  const down = price < prev;

  return (
    <Box sx={{
      p: '4px 6px',
      borderRadius: 1,
      bgcolor: 'background.paper',
      border: '1px solid',
      borderColor: up ? 'warning.dark' : down ? 'error.dark' : 'divider',
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
        color={up ? 'warning.main' : down ? 'error.main' : 'text.disabled'}
      >
        {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
      </Typography>
    </Box>
  );
}
