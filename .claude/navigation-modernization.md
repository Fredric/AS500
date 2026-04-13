# Navigation Modernization — COMPLETED

## Summary

All 6 phases implemented and tested. 17/17 E2E tests pass.

---

## What Was Done (Session 1)

Arrow key and mouse row navigation first implemented for CRUDTable list screens.
See git history for details.

---

## What Was Done (Session 2)

### Phase 1 — Client cleanup
- **Removed mouse handlers** from Terminal.tsx (onClick, onDoubleClick, rowClickProps)
- **Removed pointer CSS** from terminal.css (cursor: pointer, hover tint on selectable rows)
- **Esc → F3**: Added `'Escape': 'F3'` to `SPECIAL_KEYS` — Esc works as Back/Exit everywhere
- **Removed PageUp/PageDown** from `SPECIAL_KEYS` (keyboard keys no longer intercepted; arrow nav is the only way to page)
- **Arrow Left/Right** in list mode → send F7/F8 (day navigation in timeRegV2)
- **'n' key** in list mode → sends F6 (create new record)
- **Menu navigation**: Container handles ArrowUp/Down/Enter when `navigation.menu` is present
- **Status line hints** updated: `Esc=Exit  N=New  ←=Prev  →=Next` (removed F3/F6/F12/F7/F8 labels)
- **Form status line**: `Esc=Back` (was `F3=Exit  F12=Cancel`)
- **80-char truncation guard** on list status line

### Phase 2 — Remove old TIME_REG
- Deleted `screens/timeReg.ts`, `screens/timeEntry.ts`, `screens/timeRegHelp.ts`
- Removed `TIME_REG`, `TIME_ENTRY`, `TIME_REG_HELP` cases from `index.ts`

### Phase 3 — User management CRUDTable
- Added `deleteUser()` and optional-password `updateUser()` to `services/userMgmt.ts`
- Created `services/userService.ts` — object-param adapter for CRUDTable compatibility
- Created `configs/userMgmtConfig.ts` — full CRUDTable config:
  - List: username, full_name, active (Yes/No), is_admin (Yes/No)
  - Form: create requires username+password+confirm; edit has username readonly, password optional
  - Validators: password confirm match, Y/N active/admin, cannot remove own admin
  - Delete service included
- Registered config in `configs/index.ts`
- Deleted `screens/userMgmt.ts` and `screens/userEdit.ts`

### Phase 4 — Simplified main menu
- New `mainMenu.ts`: 3 items for admin (Time Reg, User Mgmt, Log Off), 2 for regular users (Time Reg, Log Off)
- No selection input field rendered — server returns `navigation: { type: 'menu', menu: { items, selectionField } }`
- Client fills `selection` field programmatically from focused menu item when Enter is pressed
- Log Off is now a menu option (was F3/F12)
- Added `MenuNavigation` type to server and client types
- `initUserMgmtContext()` sets `currentUserId` in CRUDContext for admin-remove-self guard

### Phase 5 — Pagination cleanup
- PAGEDOWN/PAGEUP server handlers kept (needed for arrow boundary scrolling)
- F7/F8 display mapped to `←`/`→` symbols in status line via `keyLabel` map in runtime.ts

### Phase 6 — Tests updated
- `keyboard-navigation.spec.ts`: removed mouse test, added Esc-back test, updated nav to Enter on focused menu item
- `scrollable-subfile.spec.ts`: rewrote for timeRegV2 + arrow navigation (ArrowDown×12 to page, ArrowLeft/Right for day nav)
- `time-registration-crud.spec.ts`: updated for new nav, 'n' key to create, new form titles

---

## Key Files Changed

| File | What changed |
|------|-------------|
| `server/src/types/index.ts` | Added `MenuNavigation`; updated `ScreenNavigation` |
| `server/src/crudtable/runtime.ts` | Status line hints (Esc/N/←/→); form status `Esc=Back`; 80-char guard |
| `server/src/screens/mainMenu.ts` | Full rewrite: 2-3 options, navigation.menu metadata, log-off as option |
| `server/src/services/userMgmt.ts` | `deleteUser()`, optional password in `updateUser()` |
| `server/src/services/userService.ts` | NEW — object-param adapter |
| `server/src/configs/userMgmtConfig.ts` | NEW — CRUDTable config for users |
| `server/src/configs/index.ts` | Registered userMgmtConfig |
| `client/src/types/index.ts` | Added `MenuNavigation` |
| `client/src/components/Terminal.tsx` | Menu nav, Esc mapping, Left/Right→F7/F8, n→F6, removed mouse |
| `client/src/styles/terminal.css` | Removed pointer/hover CSS |
| `tests/keyboard-navigation.spec.ts` | Updated for new nav, added Esc test |
| `tests/scrollable-subfile.spec.ts` | Rewrote for timeRegV2 + arrow nav |
| `tests/time-registration-crud.spec.ts` | Updated for new nav and form titles |

## Deleted Files

- `server/src/screens/timeReg.ts`
- `server/src/screens/timeEntry.ts`
- `server/src/screens/timeRegHelp.ts`
- `server/src/screens/userMgmt.ts`
- `server/src/screens/userEdit.ts`

---

## Known Limitations / Future Work

- **Opt column multi-select**: Opt column is still visible and functional; multi-select not yet implemented
- **Menu navigation on login screen**: Login uses input fields, no arrow nav needed
- **Admin guard timing**: `initUserMgmtContext` must be called when navigating to user mgmt (done in mainMenu handler)
- **Confirm field in user create**: Not saved to DB (filtered in params); only used for validation
