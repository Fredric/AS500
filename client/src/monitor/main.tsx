/**
 * Ingest Monitor — entry point for the standalone /ingestmonitor page.
 *
 * Deliberately separate from `client/src/main.tsx`: it mounts its own React tree
 * into `#monitor-root` and imports only its own stylesheet.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './monitor.css';

ReactDOM.createRoot(document.getElementById('monitor-root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
