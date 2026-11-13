/**
 * Test helpers: register extensions in place of the generated registry
 * (and restore it). Used by the framework's own tests with the example
 * extension, and by extension authors' tests.
 */

import type { ExtensionDefinition, ExtensionPages, ServerExtension } from '@/lib/extensions/sdk'
import { __setExtensionsForTests } from './registry'
import { __setServerExtensionsForTests } from './server-registry'
import { __setExtensionPagesForTests } from './pages'
import { invalidateTenantExtensions } from './state'
import { resetEntitlementPort } from './entitlement-port'

export function registerExtensionsForTest(input: { definitions: ExtensionDefinition[]; servers?: ServerExtension[]; pages?: Record<string, ExtensionPages> }): void {
  __setExtensionsForTests(input.definitions)
  __setServerExtensionsForTests(input.servers ?? [])
  __setExtensionPagesForTests(input.pages ?? {})
  invalidateTenantExtensions()
}

export function resetExtensionsForTest(): void {
  __setExtensionsForTests(null)
  __setServerExtensionsForTests(null)
  __setExtensionPagesForTests(null)
  invalidateTenantExtensions()
  resetEntitlementPort()
}
