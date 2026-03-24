import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary:   { main: '#6366f1' },
    success:   { main: '#22c55e', dark: '#16a34a' },
    warning:   { main: '#f59e0b', dark: '#b45309' },
    error:     { main: '#ef4444', dark: '#b91c1c' },
    background: { default: '#0f1117', paper: '#1a1d27' },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", sans-serif',
  },
  components: {
    MuiPaper:   { defaultProps: { elevation: 0 } },
    MuiChip:    { styleOverrides: { root: { borderRadius: 6 } } },
    MuiButton:  { styleOverrides: { root: { textTransform: 'none', borderRadius: 8 } } },
  },
});

export default theme;
