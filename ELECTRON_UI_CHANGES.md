# AS500 Electron UI Changes

## Seamless Terminal Experience

The AS500 terminal has been redesigned for Electron to create a seamless experience that blends the terminal with the application window.

## Changes Made

### 1. Window Configuration (electron/main.ts)

```typescript
mainWindow = new BrowserWindow({
  width: 1024,
  height: 768,
  minWidth: 900,
  minHeight: 600,
  titleBarStyle: 'hiddenInset',      // Native macOS title bar (hidden but functional)
  backgroundColor: '#0a0a0a',         // Match terminal background
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    preload: path.join(__dirname, 'preload.js'),
  },
});
```

**Key Features:**
- `titleBarStyle: 'hiddenInset'`: Uses native macOS window controls (traffic lights) but hides the title bar
- `backgroundColor: '#0a0a0a'`: Matches the terminal's dark background for seamless appearance
- Window is resizable with sensible minimum dimensions

### 2. Terminal Styling (client/src/styles/terminal.css)

#### Before (Web Version):
```css
.terminal-container {
  background-color: var(--bg-color);
  border: 3px solid #1a3a1a;           /* ← Visible border */
  border-radius: 12px;                  /* ← Rounded corners */
  padding: 20px;
  box-shadow: 
    0 0 20px rgba(51, 255, 51, 0.1),   /* ← Outer glow */
    inset 0 0 60px rgba(0, 0, 0, 0.5);
  position: relative;
  overflow: hidden;
}

.app {
  height: 100%;
  width: 100%;
  display: flex;
  align-items: center;                  /* ← Centers terminal */
  justify-content: center;              /* ← Centers terminal */
  background: radial-gradient(...);     /* ← Gradient background */
}
```

#### After (Electron Version):
```css
.terminal-container {
  background-color: var(--bg-color);
  border: none;                         /* ← No border */
  border-radius: 0;                     /* ← No rounded corners */
  padding: 20px;
  box-shadow: 
    inset 0 0 60px rgba(0, 0, 0, 0.5);  /* ← Only inner shadow */
  position: relative;
  overflow: hidden;
  width: 100%;                          /* ← Full width */
  height: 100%;                         /* ← Full height */
}

.app {
  height: 100%;
  width: 100%;
  display: flex;
  align-items: stretch;                 /* ← Fill container */
  justify-content: stretch;             /* ← Fill container */
  background: var(--bg-color);          /* ← Solid background */
  -webkit-app-region: drag;             /* ← Window draggable */
}

.app > * {
  -webkit-app-region: no-drag;          /* ← Content not draggable */
}
```

**Key Changes:**
- **No Border**: Removed the green border that separated the terminal from the window
- **No Border Radius**: Terminal corners are square, matching the window
- **Full Size**: Terminal fills the entire window (100% width and height)
- **Solid Background**: No gradient, just pure black for seamless appearance
- **Draggable Window**: The entire app area is draggable, but terminal content (inputs, buttons) are still interactive

### 3. Visual Comparison

#### Web Version (Before):
```
┌─────────────────────────────────┐
│  Gradient Background            │
│                                 │
│   ┏━━━━━━━━━━━━━━━━━━━━━┓     │  ← Green border
│   ┃ AS500 Terminal      ┃     │  ← Rounded corners
│   ┃ [Login Screen]      ┃     │
│   ┃                     ┃     │
│   ┗━━━━━━━━━━━━━━━━━━━━━┛     │
│                                 │
└─────────────────────────────────┘
```

#### Electron Version (After):
```
┌─────────────────────────────────┐  ← Native window frame
│ ●●●                             │  ← macOS traffic lights
├─────────────────────────────────┤
│ AS500 Terminal                  │  ← No visible border
│ [Login Screen]                  │  ← Fills entire window
│                                 │
│                                 │
│                                 │
└─────────────────────────────────┘
```

## Result

The terminal screen now **blends seamlessly** with the application window:
- ✅ No visible border separating terminal from window
- ✅ Terminal content extends to window edges
- ✅ Consistent black background throughout
- ✅ Native macOS window appearance with traffic lights
- ✅ Window is draggable from any empty area
- ✅ Terminal inputs and controls remain interactive

## Maintained Features

Despite the styling changes, all terminal features are preserved:
- ✅ CRT scanline effects
- ✅ Phosphor glow on text
- ✅ Screen curvature vignette
- ✅ Green-on-black aesthetic
- ✅ All keyboard shortcuts (F-keys, Tab, Enter)
- ✅ Field navigation and input handling
- ✅ Connection status indicator

## Technical Notes

- The `titleBarStyle: 'hiddenInset'` is macOS-specific and provides the native macOS experience
- On Windows/Linux, Electron will use appropriate alternatives
- The `-webkit-app-region: drag` makes the window draggable from the terminal area
- Child elements use `-webkit-app-region: no-drag` to remain interactive
