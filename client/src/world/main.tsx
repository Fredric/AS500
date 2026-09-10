/**
 * Virtual office — entry point for the standalone /office page.
 *
 * Its own React tree in `#office-root`, its own stylesheet, its own socket.
 * Same arrangement as `client/src/monitor/main.tsx`.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// The terminal is now mounted inside the world (workstation modal + login gate),
// so its stylesheet ships with this entry point too. It is imported first so
// the office's own `world.css` wins where the two define the same base rules
// (e.g. `body`).
import '../styles/terminal.css';
import './world.css';

ReactDOM.createRoot(document.getElementById('office-root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
