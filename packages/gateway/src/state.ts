/**
 * The instance's registration (state.json in the state directory): its
 * key id, Ed25519 private key and the cloud keys it trusts. Written
 * atomically with owner-only permissions (0600; on Windows the installer
 * restricts the folder to SYSTEM, Administrators and the service account).
 * Never logged.
 */
import fs from 'node:fs'
import path from 'node:path'

export interface GatewayState {
  version: 1
  cloudUrl: string
  gatewayId: string
  gatewayName: string | null
  keyId: string
  privateKeyPem: string
  publicKey: string
  cloudKeys: Array<{ id: string; publicKey: string }>
  registeredAt: string
  keyCreatedAt: string
}

export function stateFile(stateDir: string): string {
  return path.join(stateDir, 'state.json')
}

export function readState(stateDir: string): GatewayState | null {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(stateDir), 'utf8')) as GatewayState
    if (raw?.version !== 1 || !raw.keyId || !raw.privateKeyPem || !Array.isArray(raw.cloudKeys) || !raw.cloudKeys.length) return null
    return raw
  } catch {
    return null
  }
}

export function writeState(stateDir: string, state: GatewayState): void {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const file = stateFile(stateDir)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file)
  try { fs.chmodSync(file, 0o600) } catch { /* Windows: ACLs from the installer */ }
}
