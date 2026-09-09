/**
 * Virtual office — entry point for the standalone /office page.
 *
 * Its own React tree in `#office-root`, its own stylesheet, its own socket.
 * Same arrangement as `client/src/monitor/main.tsx`.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './world.css';

ReactDOM.createRoot(document.getElementById('office-root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
