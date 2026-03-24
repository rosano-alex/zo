import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Slider from '@mui/material/Slider';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import { COIN_COUNT } from '../data/coins';

interface Props {
  isRunning: boolean;
  changesPerTick: number;
  intervalMs: number;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  onChangesPerTick: (n: number) => void;
  onIntervalMs: (n: number) => void;
}

export default function Controls({
  isRunning, changesPerTick, intervalMs,
  onStart, onStop, onReset, onChangesPerTick, onIntervalMs,
}: Props) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', py: 1 }}>
      <Box sx={{ display: 'flex', gap: 1 }}>
        {isRunning
          ? <Button variant="contained" color="error" size="small" onClick={onStop}>⏹ Stop</Button>
          : <Button variant="contained" color="success" size="small" onClick={onStart}>▶ Run</Button>
        }
        <Button variant="outlined" size="small" onClick={onReset} disabled={isRunning}>↺ Reset</Button>
        {isRunning && <Chip size="small" label="● Live" color="success" sx={{ animation: 'pulse 1.5s infinite' }} />}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 220 }}>
        <Typography variant="caption" color="text.secondary" whiteSpace="nowrap">
          Changes/tick
        </Typography>
        <Slider
          size="small"
          min={1} max={COIN_COUNT} value={changesPerTick}
          onChange={(_, v) => onChangesPerTick(v as number)}
          disabled={isRunning}
          sx={{ width: 100 }}
        />
        <Typography variant="caption" fontWeight={700} minWidth={40}>
          {changesPerTick}/{COIN_COUNT}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 200 }}>
        <Typography variant="caption" color="text.secondary" whiteSpace="nowrap">
          Interval
        </Typography>
        <Slider
          size="small"
          min={50} max={2000} step={50} value={intervalMs}
          onChange={(_, v) => onIntervalMs(v as number)}
          disabled={isRunning}
          sx={{ width: 100 }}
        />
        <Typography variant="caption" fontWeight={700} minWidth={40}>
          {intervalMs}ms
        </Typography>
      </Box>
    </Box>
  );
}
