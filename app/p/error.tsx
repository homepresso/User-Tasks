'use client'

import { RouteErrorView, type RouteErrorProps } from '@/components/layout/route-states'

/** Public form links (/p/<token>): an error here shows the error state inside this section's own layout, not the bare global-error document. */
export default function PublicFormError(props: RouteErrorProps) {
  return <RouteErrorView {...props} title="Couldn't load this form" />
}
