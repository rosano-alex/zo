import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import { COIN_COUNT, SECTORS } from '../data/coins';

interface Props {
  tickCount: number;
}

export default function AppHeader({ tickCount }: Props) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
      <Box>
        <Typography variant="h5" fontWeight={800} letterSpacing={-0.5}>
          <Box component="span" sx={{ color: 'success.main' }}>lane-x</Box> Performance Demo
        </Typography>
        <Typography variant="caption" color="text.disabled">
          Fine-grained reactivity vs. standard React re-rendering
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, ml: 'auto', flexWrap: 'wrap' }}>
        <Chip size="small" label={`${COIN_COUNT} coins`} variant="outlined" />
        <Chip size="small" label={`${SECTORS.length} sectors`} variant="outlined" />
        <Chip size="small" label={`tick #${tickCount}`} color="primary" variant="outlined" />
      </Box>
    </Box>
  );
}
