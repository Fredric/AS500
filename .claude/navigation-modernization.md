# Navigation Modernization — Progress & Remaining Work

## What Was Done (Session 1)

### Goal
Modernize AS500 terminal navigation so users don't need function keys. Arrow keys navigate rows, Enter triggers the primary action, single-letter shortcuts handle secondary actions, mouse click selects rows.

### Completed

**Server changes:**
- `server/src/types/index.ts` — Added `ListNavigation` and `ScreenNavigation` interfaces; added `navigation?` to `ScreenResponse`
- `server/src/crudtable/types.ts` — Added optional `navigation` config block to `CRUDTableConfig` (custom `primaryAction` and `shortcuts`)
- `server/src/crudtable/runtime.ts` — `buildListScreen()` now computes and returns `navigation.list` metadata on every list screen response; status line updated to lead with keyboard hints: `Enter=Edit  D=Delete  F3=Exit  F6=Create  F12=Cancel`

**Client changes:**
- `client/src/types/index.ts` — Mirrored navigation types
- `client/src/hooks/useTerminal.ts` — Added `navigation: ScreenNavigation | null` to state; added `sendKeyWithInput(key, overrides)` to send ENTER with an opt field pre-filled without a setState roundtrip
- `client/src/components/Terminal.tsx` — Full keyboard and mouse navigation on list screens when `navigation.list` is present:
  - ArrowDown/Up moves `focusedDataRowIndex`
  - Enter (on container) triggers primary action via `sendKeyWithInput`
  - Single-letter shortcuts (e.g. `d`) trigger matching shortcut action
  - Tab/Shift+Tab moves between data rows
  - Mouse click sets focused row
  - Mouse double-click triggers primary action
  - Row gets CSS classes `terminal-row--selectable` and `terminal-row--focused`
  - Focus management: container gets focus in list mode (not the opt input field)
  - Input field keyboard handling: Tab in list mode moves between rows; Enter/special keys pass through to server normally (backward compat for direct opt typing)
- `client/src/styles/terminal.css` — Added `.terminal-row--selectable` (pointer cursor + hover tint) and `.terminal-row--focused` (inverted green/black highlight)

**Tests:**
- `tests/keyboard-navigation.spec.ts` — 7 new E2E tests: row highlight on load, status line hints, ArrowDown, ArrowUp, Enter→edit, d→delete, mouse click. All pass.
- All 18 tests pass (11 original + 7 new).

### Architecture decision: backward compatibility
Row navigation works by filling `opt_N` fields and sending ENTER — exactly the same as the user typing in the opt field. No server-side changes are needed to handle the new navigation; it's fully transparent to the server. The `navigation` metadata is additive.

### Key insight discovered during testing
`handleInputKeyDown` must NOT intercept Enter in list mode and redirect it to the row action — that would override whatever the user typed in the opt field. Row actions (Enter, shortcuts) only fire from the **container** focus context, not from within input fields. This preserves backward compat.

---

## What Still Needs Work

### 1. Mouse interaction refinement
The current mouse click behaviour selects a row and moves the container focus. But the user found it wasn't what they expected — likely expecting a single click to also trigger the primary action (like a normal list), or wanting a cleaner visual feedback. Needs UX discussion:
- Should single click open/edit, or just select?
- Should there be a visible selection indicator that persists when mouse leaves?
- Double-click is currently wired to primary action — is that the right pattern?

### 2. F-key modernization for manual screens
The hand-written screens (`mainMenu`, `timeReg`, `timeEntry`, `userMgmt`, `userEdit`) still use the old pattern:
- Main menu: user types a number into a field and presses Enter
- timeReg (option 6): uses opt-field pattern without navigation metadata
- No arrow key navigation on these screens

**Suggested approach for main menu:** Arrow key navigation through menu items (highlight the option, Enter selects it). The server would need to send `navigation: { type: 'menu' }` with the list of selectable options.

**Suggested approach for timeReg (old screen):** Either retire it in favour of timeRegV2 (option 7), or add navigation metadata to it. Given it's hand-written and has custom F7/F8 day navigation, it's non-trivial.

### 3. Opt column visibility
The "Opt" column (3-char input field) is still visible in CRUDTable list screens. With row navigation, users no longer need to type into it. Options:
- Hide it via CSS (simplest)
- Remove it from the subfile renderer when navigation mode is active (server-side config `hideOptColumn: true`)
- Keep it for power users who prefer the old way (current behaviour)

### 4. Status line truncation
The status line is now `Enter=Edit  D=Delete  F3=Exit  F6=Create  F7=Prev  F8=Next  F12=Cancel` which can exceed 80 chars for configs with many custom keys/shortcuts. No truncation guard is in place yet.

### 5. Pagination focus
When ArrowDown at last row triggers PAGEDOWN, `focusedDataRowIndex` resets to 0 (first row of new page). When ArrowUp at row 0 triggers PAGEUP, focus also resets to 0 instead of jumping to the last row of the previous page. The `focusLastOnNextPageRef` mechanism is in place for PAGEUP but the UX could be polished.

---

## Key Files Reference

| File | What changed |
|------|-------------|
| `server/src/types/index.ts` | `ListNavigation`, `ScreenNavigation` types; `navigation?` on `ScreenResponse` |
| `server/src/crudtable/types.ts` | `navigation?` on `CRUDTableConfig` |
| `server/src/crudtable/runtime.ts` | Navigation metadata + shortcut hints in status line |
| `client/src/types/index.ts` | Mirror of server navigation types |
| `client/src/hooks/useTerminal.ts` | `navigation` state; `sendKeyWithInput()` |
| `client/src/components/Terminal.tsx` | Row focus state; arrow/Enter/shortcut/mouse handling; row CSS classes |
| `client/src/styles/terminal.css` | `.terminal-row--selectable`, `.terminal-row--focused` |
| `tests/keyboard-navigation.spec.ts` | 7 E2E navigation tests (uses option 7 = timeRegV2 CRUDTable) |

## Navigation to CRUDTable Screens
- Option **6** = old hand-written `TIME_REG` screen (no navigation metadata)
- Option **7** = `CRUD_TIMEREG_V2` CRUDTable screen (full navigation)

Admin users also see option **90** = user management (also hand-written, no navigation yet).
