'use client'

import { RouteErrorView, type RouteErrorProps } from '@/components/layout/route-states'

/** Friendly form links (/form/<name>): an error here shows the error state inside this section's own layout, not the bare global-error document. */
export default function FriendlyFormError(props: RouteErrorProps) {
  return <RouteErrorView {...props} title="Couldn't load this form" />
}
