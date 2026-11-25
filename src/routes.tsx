// Route table. Every feature is lazy-loaded from its own folder so parallel work never collides
// here. Hash routing: GitHub Pages can't rewrite deep links to index.html.
import type { RouteObject } from 'react-router'
import AppShell from '@/ui/AppShell'
import RouteError from '@/ui/RouteError'

export const routes: RouteObject[] = [
  {
    path: '/',
    Component: AppShell,
    ErrorBoundary: RouteError,
    HydrateFallback: () => null,
    children: [
      {
        index: true,
        lazy: () => import('@/features/today').then((m) => ({ Component: m.default })),
      },
      {
        path: 'session/:id',
        lazy: () => import('@/features/logger/Logger').then((m) => ({ Component: m.default })),
      },
      {
        path: 'week',
        lazy: () => import('@/features/week').then((m) => ({ Component: m.default })),
      },
      {
        path: 'history',
        lazy: () => import('@/features/history').then((m) => ({ Component: m.default })),
      },
      {
        path: 'history/:id',
        lazy: () =>
          import('@/features/history/SessionDetail').then((m) => ({ Component: m.default })),
      },

      // More
      {
        path: 'more',
        lazy: () => import('@/features/more').then((m) => ({ Component: m.default })),
      },
      {
        path: 'activities',
        lazy: () => import('@/features/activities').then((m) => ({ Component: m.default })),
      },
      {
        path: 'activities/new',
        lazy: () =>
          import('@/features/activities/ActivityEditor').then((m) => ({ Component: m.default })),
      },
      {
        path: 'activities/:id',
        lazy: () =>
          import('@/features/activities/ActivityEditor').then((m) => ({ Component: m.default })),
      },
      {
        path: 'routines',
        lazy: () => import('@/features/routines').then((m) => ({ Component: m.default })),
      },
      {
        path: 'routines/:id',
        lazy: () =>
          import('@/features/routines/RoutineEditor').then((m) => ({ Component: m.default })),
      },
      {
        path: 'settings',
        lazy: () => import('@/features/settings').then((m) => ({ Component: m.default })),
      },
      {
        path: 'settings/data',
        lazy: () => import('@/features/data').then((m) => ({ Component: m.default })),
      },

      { path: '*', lazy: () => import('@/ui/NotFound').then((m) => ({ Component: m.default })) },
    ],
  },
]
