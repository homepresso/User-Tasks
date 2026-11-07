'use client'

import './globals.css'
import { RouteErrorView, type RouteErrorProps } from '@/components/layout/route-states'

/**
 * The root layout itself failed: a bare document with the error state
 * (global-error replaces the root layout, so it brings its own html, body,
 * styles and title).
 */
export default function GlobalError(props: RouteErrorProps) {
  return (
    <html lang="en">
      <body className="bg-bg font-sans text-fg antialiased">
        <title>Something went wrong · UserTasks</title>
        <main className="flex min-h-screen items-center justify-center p-6">
          <RouteErrorView {...props} />
        </main>
      </body>
    </html>
  )
}
