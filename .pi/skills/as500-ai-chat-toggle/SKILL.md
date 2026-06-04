---
name: as500-ai-chat-toggle
description: Open or troubleshoot the AS500 in-browser AI chat panel using pi-chrome mouse/keyboard control. Use when the user asks to open, close, click, or interact with the AS500 AI chat/star/toggle button.
---

# AS500 AI Chat Toggle

Use this workflow when the user wants the AS500 AI chat panel opened from Chrome.

## Preconditions

- Use the **pi-chrome extension tools directly** (`chrome_snapshot`, `chrome_evaluate`, `chrome_click`, etc.) to open the panel.
- Do **not** use bash/Python scripts against the bridge HTTP endpoint, Playwright, DOM-only `element.click()`, or unrelated browser automation unless the user explicitly asks.
- pi-chrome must be connected and authorized (`/chrome doctor`, `/chrome authorize`). If pi-chrome is not reachable, times out, or the active tab is not ready, ask the user to kill/restart Chrome, then run `/chrome doctor` and `/chrome authorize` before trying again.
- The AS500 app is normally at `http://localhost:5173/`.

## Open the chat panel

1. Inspect the page first with pi-chrome:
   - `chrome_snapshot({ maxElements: 100, containingText: "chat" })`
2. If the AS500 app is not on screen or the toggle is missing, navigate with pi-chrome:
   - `chrome_navigate({ url: "http://localhost:5173/", waitUntilLoad: true })`
   - Then take another `chrome_snapshot`.
3. Find the small star button:
   - Preferred selector: `button.ai-chat-toggle`
   - Also appears as: `button[aria-label="Toggle AI chat"]`
   - Text/icon is usually `✦`.
4. **First-choice action (most reliable):** use pi-chrome to read the current visible button center, confirm `elementFromPoint` is the button, then click those current coordinates with pi-chrome real mouse input. The first click on AS500 often misses because the terminal layout shifts/focuses, so always do this as a two-click sequence:
   - Use `chrome_evaluate`:
     ```js
     (() => {
       const b = document.querySelector('button.ai-chat-toggle');
       if (!b) return null;
       const r = b.getBoundingClientRect();
       const cx = r.x + r.width / 2;
       const cy = r.y + r.height / 2;
       const at = document.elementFromPoint(cx, cy);
       return {
         x: r.x, y: r.y, w: r.width, h: r.height, cx, cy,
         at: at && { tag: at.tagName, className: String(at.className), aria: at.getAttribute('aria-label') },
       };
     })()
     ```
   - First click: `chrome_click({ x: Math.round(cx), y: Math.round(cy), includeSnapshot: true, maxElements: 100 })`.
   - Immediately re-run the `chrome_evaluate` rect snippet because the button usually moves after the first click.
   - Second click: click the newly returned `cx/cy` with `chrome_click({ x: Math.round(cx), y: Math.round(cy), includeSnapshot: true, maxElements: 100 })`.
5. Fallback only if the two current-coordinate clicks fail:
   - `chrome_click({ selector: "button.ai-chat-toggle", includeSnapshot: true, maxElements: 100 })`.

## Verify it opened

Run `chrome_evaluate`:

```js
(() => !!document.querySelector('.ai-chat-panel'))()
```

Open state indicators:

- `button.ai-chat-toggle` has class `ai-chat-toggle--active`.
- `.ai-chat-panel` is visible.
- Panel title includes `AS500 AI ASSISTANT`.

## If a click seems to do nothing

- First check if the panel is already open with `.ai-chat-panel`.
- If pi-chrome is unresponsive or times out, tell the user to kill/restart Chrome, then run `/chrome doctor` and `/chrome authorize`.
- Re-read the button rect; the AS500 terminal layout can shift after snapshots, navigation, or the first click.
- Always try two current-coordinate clicks, recalculating the coordinates between clicks.
- If using selector click as fallback, verify immediately afterward and then re-read current coordinates if needed.
