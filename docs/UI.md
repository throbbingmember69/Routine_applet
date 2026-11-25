# UI conventions

Rules every screen follows so the app feels like one product. The design brief: a fast, calm tool you use one-handed between blocks, on an Android phone (360–412 px wide).

## Structure
- **Screens** live in `src/features/<feature>/` and are the default export of the file that `src/routes.tsx` lazy-loads. Keep route files thin; put sub-components next to them. Pieces used by several screens (progress bar, quick log sheet, block editor, amount helpers) live in `src/features/shared/`.
- **Data:** read with `useLive((ctx) => someQuery(ctx, args), [args…])` from `@/app/hooks`, and write with `useCommand(someCommand, { success?: 'Saved' })`. Never import `@/db` or `dexie` (ESLint blocks it). Pass today's date from `useToday()` into queries that take `today`/`date`, because queries never read the clock.
- **Tests:** use `renderScreen(<Screen />, { route, path, ctx })` from `@/app/testing` with `createTestCtx()` data built through the real service commands. Assert what the user sees (roles and text). Screen tests are in `src/features/screens.test.tsx`.

## Layout
- Every screen starts with `<PageHeader title back? actions? />`. Secondary screens pass `back` (the parent route).
- Content is a vertical `<Stack>` of `<Card>`s, with the primary action first or at the bottom.
- Aim for one primary button (`variant="primary"`) per screen. Destructive actions use `variant="danger"` and always go through `<ConfirmDialog>`.
- Pickers, forms and confirmations use `<Sheet>` (bottom sheet) rather than new routes where possible.
- Touch targets are at least 48 px (`--tap`). Leave space for the bottom nav (the AppShell already pads `main`) and for the rest timer bar in the logger.

## Components (in `src/ui`)
| Need | Use |
|---|---|
| Section | `Card` (optional `title`) |
| Menu / list of links | `LinkList` + `LinkRow` (icon, label, hint, trailing) |
| Status label | `Badge tone="good\|warn\|bad\|accent"` |
| Number input | `NumberStepper` (amounts, blocks, minutes); `stepFor(blockAmount)` from `features/shared/amounts.ts` picks the − / + step |
| Weekly progress | `ProgressBar` (`features/shared`) plus `progressLine()` text |
| Toggle | `Toggle` |
| Labeled field | `Field label htmlFor hint` + `<input className={kit.input}>` (import `kit` from `@/ui/kit.module.css`) |
| Nothing yet | `EmptyState title action` with the next step as the action |
| Icons | `Icon name` (extend `PATHS` in `Icon.tsx` if needed; keep the 24-px stroke style) |

Use CSS Modules with the tokens in `src/styles/tokens.css` (violet accent; green means a target is met). Don't hard-code colors, and don't add a UI library.

## States
- **Loading:** `useLive` gives `undefined` until the first result. Show `<Spinner />`, never a blank screen.
- **Empty:** explain what goes here and offer the action that fills it, e.g. "Create your first activity. [New activity]".
- **Errors:** commands already toast `ServiceError` messages. Keep inputs as typed so the user can fix them. Unexpected render errors fall to `RouteError`.
- **Confirm before** deleting or restoring data, entering Edit mode, abandoning a session or restoring a backup.

## Numbers and copy
- **Amounts:** in the activity's own unit, up to 2 decimals with trailing zeros trimmed ("25 min", "2.5 km", "20 pages"), via `formatAmount`.
- **Weekly progress:** "120 / 300 min · 180 to go"; once met "Met · 310 / 300 min"; without a target "45 min this week".
- **Plan line:** "4 × 25 min · rest 5 min" (`formatPlan`; no rest part when there's no rest).
- **Logger:** "Block 2 of 4 · 25 min", then "All 4 blocks done · 100 min". The planned size is the amount field's placeholder; the primary button reads "Done (25 min)" and logs it in one tap, or "Log 15 min" once something is typed. A block under the planned size is marked "partial".
- **Optional:** a neutral "Optional" badge (logger card, routine editor, Today's routine line "(optional)"). Finishing lists "Optional, skipped: Reading".
- **Dates** as "Mon 28 Sep" (`formatDate`, a LocalDate at local noon); week ranges as "23 Nov – 29 Nov".
- **Copy:** plain, short, second person ("Add what you're doing in this session").

## Accessibility
- Every input has a label (visible, or via the component's `label` prop).
- Toggle-like buttons use `aria-pressed`; progress bars are `role="progressbar"` with a label and value; the rest timer is `role="timer"`.
- Don't rely on color alone: badges and progress lines carry text.
- Respect `prefers-reduced-motion`.
