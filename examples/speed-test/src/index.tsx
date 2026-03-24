import React from 'react';
import ReactDOM from 'react-dom/client';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import App from './App';
import theme from './theme';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

// StrictMode is intentionally omitted — it double-invokes renders and
// would skew the render-count benchmark metrics.
root.render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <App />
  </ThemeProvider>
);
