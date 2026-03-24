import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Divider from '@mui/material/Divider';
import Chip from '@mui/material/Chip';
import { COIN_COUNT } from '../data/coins';

export interface Stats {
  ticks: number;
  rendersThisTick: number;
  totalRenders: number;
  avgUpdateMs: number;
}

interface Props {
  standard: Stats;
  laneX: Stats;
  changesPerTick: number;
}

function StatRow({ label, value, highlight }: { label: string; value: string; highlight?: 'good' | 'bad' }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.4 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography
        variant="caption"
        fontWeight={700}
        color={highlight === 'good' ? 'success.main' : highlight === 'bad' ? 'warning.main' : 'text.primary'}
      >
        {value}
      </Typography>
    </Box>
  );
}

function ScoreCard({ title, stats, color, changesPerTick, isBetter }: {
  title: string; stats: Stats; color: string; changesPerTick: number; isBetter?: boolean;
}) {
  const rendersPerTick = stats.ticks > 0 ? (stats.totalRenders / stats.ticks).toFixed(1) : '—';
  return (
    <Paper variant="outlined" sx={{ p: 1.5, flex: 1, borderColor: color, minWidth: 180 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ color }}>{title}</Typography>
        {isBetter && <Chip label="faster" size="small" color="success" sx={{ height: 18, fontSize: '0.6rem' }} />}
      </Box>
      <Divider sx={{ mb: 0.5 }} />
      <StatRow label="Renders/tick" value={rendersPerTick} highlight={isBetter ? 'good' : 'bad'} />
      <StatRow label="This tick" value={stats.rendersThisTick > 0 ? String(stats.rendersThisTick) : '—'} />
      <StatRow label="Total renders" value={stats.totalRenders > 0 ? String(stats.totalRenders) : '—'} />
      <StatRow label="Avg update" value={stats.avgUpdateMs > 0 ? `${stats.avgUpdateMs.toFixed(3)}ms` : '—'} />
      <StatRow label="Ticks" value={stats.ticks > 0 ? String(stats.ticks) : '—'} />
    </Paper>
  );
}

export default function Scoreboard({ standard, laneX, changesPerTick }: Props) {
  const saving = standard.totalRenders > 0 && laneX.totalRenders > 0
    ? Math.round((1 - laneX.totalRenders / standard.totalRenders) * 100)
    : null;

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <ScoreCard title="Standard React" stats={standard} color="#f59e0b" changesPerTick={changesPerTick} />
        <ScoreCard title="lane-x + React" stats={laneX} color="#22c55e" changesPerTick={changesPerTick} isBetter />
        {saving !== null && (
          <Paper variant="outlined" sx={{ p: 1.5, minWidth: 150, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', borderColor: 'success.main' }}>
            <Typography variant="h4" fontWeight={800} color="success.main">{saving}%</Typography>
            <Typography variant="caption" color="text.secondary" textAlign="center">renders avoided</Typography>
            <Typography variant="caption" color="text.disabled" textAlign="center" mt={0.5}>
              {changesPerTick}/{COIN_COUNT} coins changed
            </Typography>
          </Paper>
        )}
      </Box>
    </Box>
  );
}
