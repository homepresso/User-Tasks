'use client'

import { RouteErrorView, type RouteErrorProps } from '@/components/layout/route-states'

/** Section boundary (docs/design/ui-polish-spec.md §4.5): a crash here keeps the shell and the rest of the app usable. */
export default function DataTableError(props: RouteErrorProps) {
  return <RouteErrorView {...props} title="Couldn't load this table" />
}
