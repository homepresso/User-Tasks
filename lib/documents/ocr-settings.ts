/**
 * Workspace OCR setting (client-safe): which OCR provider a workspace's
 * document steps use. Stored in tenants.settings.document_ocr as
 * { provider, connector_id } — never a key: an Azure key is the credential
 * of the workspace's Azure AI Document Intelligence connector
 * (tenant_connectors, encrypted, write-only).
 *
 * Resolution at run time (lib/documents/ocr-workspace.ts):
 *   1. the workspace's own setting (azure / tesseract / off);
 *   2. `instance_default` → the instance's DOCUMENT_OCR_PROVIDER, but only
 *      where DOCUMENT_OCR_INSTANCE_DEFAULT allows it (never on the cloud by
 *      default);
 *   3. otherwise the step fails with OCR_NOT_CONFIGURED_MESSAGE.
 */

export const DOCUMENT_OCR_SETTINGS_PATH = '/settings/document-ocr'
export const AZURE_DI_CONNECTOR_KEY = 'azure_document_intelligence'

export const WORKSPACE_OCR_PROVIDERS = ['instance_default', 'azure_document_intelligence', 'tesseract', 'off'] as const
export type WorkspaceOcrProvider = (typeof WORKSPACE_OCR_PROVIDERS)[number]

export const WORKSPACE_OCR_PROVIDER_LABELS: Record<WorkspaceOcrProvider, string> = {
  instance_default: 'Instance default',
  azure_document_intelligence: 'Azure AI Document Intelligence (your key)',
  tesseract: 'Built-in (tesseract)',
  off: 'Off',
}

export interface WorkspaceOcrSetting {
  provider: WorkspaceOcrProvider
  /** The tenant connector holding the Azure endpoint and key. */
  connector_id: string | null
}

export const DEFAULT_WORKSPACE_OCR: WorkspaceOcrSetting = { provider: 'instance_default', connector_id: null }

export const OCR_NOT_CONFIGURED_MESSAGE = `OCR isn't set up for this workspace. An admin can add an Azure AI Document Intelligence key in Settings → Document OCR (${DOCUMENT_OCR_SETTINGS_PATH}).`
export const OCR_OFF_MESSAGE = `OCR is turned off for this workspace. An admin can turn it on in Settings → Document OCR (${DOCUMENT_OCR_SETTINGS_PATH}).`

export function isWorkspaceOcrProvider(value: unknown): value is WorkspaceOcrProvider {
  return typeof value === 'string' && (WORKSPACE_OCR_PROVIDERS as readonly string[]).includes(value)
}

/** tenants.settings → the workspace's OCR setting (defaults for anything malformed). */
export function workspaceOcrFromTenantSettings(settings: unknown): WorkspaceOcrSetting {
  const raw = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>).document_ocr : null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_WORKSPACE_OCR }
  const value = raw as Record<string, unknown>
  const provider = isWorkspaceOcrProvider(value.provider) ? value.provider : 'instance_default'
  const connectorId = typeof value.connector_id === 'string' && value.connector_id.trim() ? value.connector_id.trim() : null
  return { provider, connector_id: connectorId }
}

export type OcrSourceDecision =
  | { kind: 'workspace_azure'; connectorId: string }
  | { kind: 'workspace_tesseract' }
  | { kind: 'instance' }
  | { kind: 'error'; message: string; code: 'not_configured' | 'off' | 'instance_off' }

/**
 * Where a run's OCR comes from (pure). `instanceDefaultAllowed` is
 * DOCUMENT_OCR_INSTANCE_DEFAULT; `instanceProvider` the instance's
 * DOCUMENT_OCR_PROVIDER. A workspace without its own setting never falls
 * back to the instance when the flag is off.
 */
export function decideOcrSource(
  setting: WorkspaceOcrSetting,
  instance: { defaultAllowed: boolean; provider: 'tesseract' | 'azure_document_intelligence' | 'none' },
): OcrSourceDecision {
  switch (setting.provider) {
    case 'off':
      return { kind: 'error', code: 'off', message: OCR_OFF_MESSAGE }
    case 'azure_document_intelligence':
      return setting.connector_id
        ? { kind: 'workspace_azure', connectorId: setting.connector_id }
        : { kind: 'error', code: 'not_configured', message: OCR_NOT_CONFIGURED_MESSAGE }
    case 'tesseract':
      return { kind: 'workspace_tesseract' }
    default:
      if (!instance.defaultAllowed) return { kind: 'error', code: 'not_configured', message: OCR_NOT_CONFIGURED_MESSAGE }
      if (instance.provider === 'none') return { kind: 'error', code: 'instance_off', message: 'OCR is turned off on this instance (DOCUMENT_OCR_PROVIDER=none)' }
      return { kind: 'instance' }
  }
}
