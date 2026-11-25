# Routine Applet

[![CI & Deploy](https://github.com/throbbingmember69/Routine_applet/actions/workflows/ci-deploy.yml/badge.svg)](https://github.com/throbbingmember69/Routine_applet/actions/workflows/ci-deploy.yml)

An offline-first phone app (PWA) for daily activities done like a workout routine:

- **Activities** with their own unit (minutes, pages, km or anything else), a default block size, a rest between blocks and a **weekly target** in that unit
- **Optional progression:** raise an activity's weekly target by a step every N weeks, up to a cap
- **Routines:** set lists of activities with blocks, block sizes, rests and optional items
- **Logger:** one tap logs a block at its planned size, then a rest timer (vibration, sound, notification) runs until the next block
- **Quick log:** add an amount to any activity without starting a routine
- **Week view:** each activity's progress against its target, partial blocks included
- **History** with an explicit Edit mode, **CSV** export of every block, and full JSON **backup/restore**

All data stays on your device (IndexedDB). Design decisions are in [`docs/`](./docs).

A fork of [Exersise-Applet](https://github.com/throbbingmember69/Exersise-Applet) (the app shell, data layer, rest timer, history and backup), with its own data and database.

**Live app:** https://throbbingmember69.github.io/Routine_applet/

## Development

Requires Node 24+.

```bash
npm ci
npm run dev      # local dev server
npm run check    # lint + typecheck + format + tests
npm run build    # production build into dist/
```

Pushes to `main` run CI and deploy to GitHub Pages.
