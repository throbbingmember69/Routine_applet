# Decisions

Binding user decisions for Routine Applet, and the defaults adopted where the user didn't decide. This file wins over everything else.

## User decisions (2026-11-25)

| # | Question | Decision |
|---|---|---|
| U1 | Where does the app live? | A new repository of its own, `throbbingmember69/Routine_applet`, fully separate from Exersise-Applet, served at `throbbingmember69.github.io/Routine_applet/`. Forked from Exersise-Applet at `9a1b618` with fresh history. |
| U2 | What is a block measured in? | A unit chosen per activity: minutes, pages, km or any custom label. |
| U3 | How is a week laid out? | Each activity has a weekly target that can be filled on any day. Routines (set lists, like workout days) are optional. |
| U4 | What is a weekly target? | A total in the activity's unit (e.g. 300 min a week). Every logged block adds its amount; partial blocks count. |
| U5 | Which timers? | A rest timer between blocks only (vibration, sound, background notification), as in the workout app. No block countdown. |
| U6 | Progression? | None unless turned on per activity: then the weekly target grows by a step every N weeks, up to a cap. |
| U7 | Categories? | No: a flat list of activities. |

## Adopted defaults

| # | Topic | Default | Why |
|---|---|---|---|
| D1 | Database name | `routine-applet` | Both apps share the `github.io` origin, so the IndexedDB name must differ from the workout app's `exersise-applet`. |
| D2 | First launch | No activities, routines or history; Today asks "Create your first activity". | The user defines their own activities (no seed data). |
| D3 | Week start | Monday, editable (Settings → Week starts on). | Same as the workout app. |
| D4 | What counts toward the week | Live blocks of sessions that are in progress or finished, dated in the week. Abandoned and deleted sessions and deleted blocks never count. | Same rule as weekly volume in the workout app. |
| D5 | Progression arithmetic | `target = min(cap, base + step × floor(weeks since the start week / everyWeeks))`, never below the base. Counting starts at the week containing the progression's start date (default: the day it was turned on, kept on later edits). Derived on read, never stored. | Matches U6 with no stored state. |
| D6 | Logging a block | The planned size is a placeholder; "Done (25 min)" logs it in one tap; typing logs another amount (a partial block). | The workout app's "Hit target" pattern (user decision there, 2026-11-21). |
| D7 | Rest timer | Starts after a logged block when the item has rest and there is still something planned (more blocks of this item or another required item). One rest value per activity or routine item (the data model keeps a min–max range for later). | U5; no pointless timer after the last block. |
| D8 | Quick log | Records a finished one-activity session in one step (blocks × size), for today or up to 2 days back; works during another session. Sessions record their source (`logger` or `quick`). | U3: targets fill without a routine. |
| D9 | One session at a time | Only one session can be in progress; quick logs are separate finished sessions. | Same as the workout app. |
| D10 | Duplicates in a session | An activity can appear once per session; log more blocks on its card instead. | Keeps the logger and totals simple. |
| D11 | Optional items | Count toward the week when done, never needed to finish; listed as skipped on the finish sheet. | Same as optional slots in the workout app. |
| D12 | Deleting | Activities and routines are archived, never deleted, once anything refers to them (a routine item or a logged session for an activity; a started session for a routine). Unused ones can be deleted outright. Blocks and sessions are soft-deleted (`voidedAt`) and restorable. | History is never overwritten. |
| D13 | Edit mode | Finished and abandoned sessions change only through Edit mode, entered after a confirm: block amount and note, add/delete/restore blocks, session note, date (not in the future) and finished ↔ abandoned, delete/restore the session. Changes stamp `editedAt`. Snapshots (`sessionItems`) are never written. | Same as the workout app. |
| D14 | Names | Activity names are unique among active activities, ignoring case. | Avoids two "Study" rows on Today. |
| D15 | Theme | Violet accent and icon (three filled blocks and one empty), so the two apps are easy to tell apart on the home screen. | |
