'use client'

import { RouteErrorView, type RouteErrorProps } from '@/components/layout/route-states'

/** Any dashboard page that throws: an error state inside the shell (the sidebar and top bar keep working). */
export default function DashboardError(props: RouteErrorProps) {
  return <RouteErrorView {...props} />
}
