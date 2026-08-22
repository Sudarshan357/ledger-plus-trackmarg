import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyTheme, readTheme } from './lib/theme';
import './styles.css';

// public/theme-init.js has already set data-theme before first paint; this re-applies the
// same choice so the browser-chrome colour is resolved too, and keeps both paths in one
// function rather than duplicating the logic in the pre-paint script.
applyTheme(readTheme());

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
