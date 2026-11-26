'use client'

import { RouteErrorView, type RouteErrorProps } from '@/components/layout/route-states'

/** Sign-in pages: an error here shows the error state inside this section's own layout, not the bare global-error document. */
export default function AuthError(props: RouteErrorProps) {
  return <RouteErrorView {...props} title="Couldn't load this page" />
}
