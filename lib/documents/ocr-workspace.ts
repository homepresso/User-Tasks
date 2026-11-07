/**
 * OCR for a run, resolved per workspace (server-only).
 *
 *   1. The workspace's own setting (tenants.settings.document_ocr): its
 *      Azure AI Document Intelligence connector (endpoint + encrypted key,
 *      every request egress-guarded), built-in tesseract, or off.
 *   2. Otherwise the instance configuration (DOCUMENT_OCR_PROVIDER), only
 *      where DOCUMENT_OCR_INSTANCE_DEFAULT allows it (off by default on the
 *      cloud, so a platform key is never used for a workspace).
 *   3. Otherwise an OcrUnavailableError that says where to set it up.
 *
 * Usage: every recognised page image is one page sent to the provider (one
 * billed page on Azure); runs report it as `ocr.pages_sent`. Nothing here
 * logs, and no error or result carries the key.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- tenants / connector JSON is untyped */

import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSensitiveFields } from '@/lib/secret-fields'
import { resolveTenantSecretRefs } from '@/lib/config/tenant-secret-refs'
import {
  AZURE_DI_CONNECTOR_KEY, DOCUMENT_OCR_SETTINGS_PATH, decideOcrSource, workspaceOcrFromTenantSettings,
  type WorkspaceOcrSetting,
} from './ocr-settings'
import {
  azureOcrProvider, configuredOcrProvider, instanceOcrDefaultAllowed, instanceTesseractAvailable, openOcrProvider, openTesseract,
  OcrUnavailableError, type AzureOcrOptions, type AzureOcrSettings, type OcrProvider,
} from './ocr'

export type OcrSource = 'workspace' | 'instance'

export interface OcrUsage {
  /** Provider id that read the pages (azure_document_intelligence, tesseract), null until opened. */
  provider: string | null
  /** Whose configuration it was: the workspace's own, or the instance's. */
  source: OcrSource | null
  /** Page images sent for recognition (Azure bills each as one page). */
  pages_sent: number
}

export function newOcrUsage(): OcrUsage {
  return { provider: null, source: null, pages_sent: 0 }
}

/** The workspace's stored setting (defaults when unreadable). */
export async function readWorkspaceOcrSetting(db: SupabaseClient, tenantId: string): Promise<WorkspaceOcrSetting> {
  try {
    const { data, error } = await (db as any).from('tenants').select('settings').eq('id', tenantId).maybeSingle()
    if (error) return workspaceOcrFromTenantSettings(null)
    return workspaceOcrFromTenantSettings(data?.settings)
  } catch {
    return workspaceOcrFromTenantSettings(null)
  }
}

const SETTINGS_HINT = `Settings → Document OCR (${DOCUMENT_OCR_SETTINGS_PATH})`

/**
 * The workspace's Azure endpoint, key and API version: its own connector
 * only (tenant-scoped), enabled, decrypted, `secret://` refs resolved under
 * the workspace's prefix.
 */
export async function loadWorkspaceAzureSettings(db: SupabaseClient, tenantId: string, connectorId: string): Promise<AzureOcrSettings> {
  const { data: row } = await (db as any).from('tenant_connectors')
    .select('id, connector_key, config, credentials, is_enabled')
    .eq('id', connectorId).eq('tenant_id', tenantId).maybeSingle()
  if (!row || row.connector_key !== AZURE_DI_CONNECTOR_KEY) {
    throw new OcrUnavailableError(`This workspace's Azure AI Document Intelligence connection was removed. An admin can add the key again in ${SETTINGS_HINT}.`)
  }
  if (row.is_enabled === false) {
    throw new OcrUnavailableError(`This workspace's Azure AI Document Intelligence connection is disabled or still needs its key (after an import the key must be re-entered). An admin can enter it in ${SETTINGS_HINT}.`)
  }
  const config = (decryptSensitiveFields(row.config ?? {}) ?? {}) as Record<string, any>
  let credentials = (decryptSensitiveFields(row.credentials ?? {}) ?? {}) as Record<string, any>
  try {
    credentials = await resolveTenantSecretRefs(tenantId, { api_key: credentials.api_key }, 'Azure AI Document Intelligence')
  } catch (error: any) {
    throw new OcrUnavailableError(String(error?.message ?? 'Could not resolve the secret reference for the Azure key'))
  }
  const key = typeof credentials.api_key === 'string' ? credentials.api_key.trim() : ''
  const endpoint = typeof config.endpoint === 'string' ? config.endpoint.trim() : ''
  if (!key || !endpoint) throw new OcrUnavailableError(`This workspace's Azure AI Document Intelligence connection needs its endpoint and key. An admin can enter them in ${SETTINGS_HINT}.`)
  return { endpoint, key, apiVersion: typeof config.api_version === 'string' ? config.api_version : null }
}

export interface OpenWorkspaceOcrDeps {
  /** Azure transport options (tests inject fetch / sleep). */
  azure?: AzureOcrOptions
}

/** The provider for this workspace's run, by the resolution order above. */
export async function openWorkspaceOcr(db: SupabaseClient, tenantId: string, languages: string, deps: OpenWorkspaceOcrDeps = {}): Promise<{ provider: OcrProvider; source: OcrSource }> {
  const setting = await readWorkspaceOcrSetting(db, tenantId)
  const decision = decideOcrSource(setting, { defaultAllowed: instanceOcrDefaultAllowed(), provider: configuredOcrProvider() })
  switch (decision.kind) {
    case 'error':
      throw new OcrUnavailableError(decision.message)
    case 'workspace_azure': {
      const settings = await loadWorkspaceAzureSettings(db, tenantId, decision.connectorId)
      return { provider: azureOcrProvider(settings, { ...deps.azure, guarded: true }), source: 'workspace' }
    }
    case 'workspace_tesseract':
      if (!(await instanceTesseractAvailable())) {
        throw new OcrUnavailableError(`Built-in OCR (tesseract) isn't available on this instance. An admin can add an Azure AI Document Intelligence key in ${SETTINGS_HINT}.`)
      }
      return { provider: await openTesseract(languages), source: 'workspace' }
    case 'instance':
      return { provider: await openOcrProvider(languages), source: 'instance' }
  }
}

/** Wrap a provider so each recognised page is counted in `usage`. */
export function countingProvider(provider: OcrProvider, source: OcrSource, usage: OcrUsage): OcrProvider {
  usage.provider = provider.id
  usage.source = source
  return {
    id: provider.id,
    async recognize(image, options) {
      usage.pages_sent++
      return provider.recognize(image, options)
    },
    ...(provider.close ? { close: () => provider.close!() } : {}),
  }
}
