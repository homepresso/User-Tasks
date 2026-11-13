/**
 * Custom pages of the extensions in the build (escape hatch, /x/<id>/…).
 * Server-only: imported by app/(dashboard)/x/[ext]/[[...path]]/page.tsx.
 */

import type { ExtensionPage, ExtensionPages } from '@/lib/extensions/sdk'
import { GENERATED_EXTENSION_PAGES } from './generated/registry.pages'

let override: Readonly<Record<string, ExtensionPages>> | null = null

export function extensionPages(id: string): ExtensionPages | null {
  return (override ?? GENERATED_EXTENSION_PAGES)[id] ?? null
}

/** The component for /x/<id>/<path> (exact path; '' is the root page). */
export function extensionPage(id: string, path: string): ExtensionPage | null {
  return extensionPages(id)?.[path] ?? null
}

export function __setExtensionPagesForTests(pages: Readonly<Record<string, ExtensionPages>> | null): void {
  override = pages
}
