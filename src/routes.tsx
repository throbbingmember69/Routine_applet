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

      // More
      {
        path: 'more',
        lazy: () => import('@/features/more').then((m) => ({ Component: m.default })),
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
