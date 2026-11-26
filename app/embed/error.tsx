'use client'

import { RouteErrorView, type RouteErrorProps } from '@/components/layout/route-states'

/** Embedded pages (/embed/…): the boundary stays inside the frame: an error here shows the error state inside this section's own layout, not the bare global-error document. */
export default function EmbedError(props: RouteErrorProps) {
  return <RouteErrorView {...props} title="Couldn't load this view" />
}
