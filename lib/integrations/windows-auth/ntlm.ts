/**
 * NTLMv2 client messages (MS-NLMP): NEGOTIATE, CHALLENGE parsing and
 * AUTHENTICATE with MIC, MsvAvTimestamp, MsvAvFlags, channel bindings (EPA)
 * and the target SPN. NTLMv2 only: there is no LM or NTLMv1 code path, and a
 * CHALLENGE without target info (which NTLMv2 needs) is refused.
 *
 * Pure functions with injectable randomness and clock, so the MS-NLMP
 * section 4.2.4 test vectors can be checked exactly. Server-only.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { md4 } from './md4'

export const NTLM_SIGNATURE = Buffer.from('NTLMSSP\0', 'ascii')

export const NTLMSSP = {
  NEGOTIATE_UNICODE: 0x00000001,
  NEGOTIATE_OEM: 0x00000002,
  REQUEST_TARGET: 0x00000004,
  NEGOTIATE_SIGN: 0x00000010,
  NEGOTIATE_SEAL: 0x00000020,
  NEGOTIATE_LM_KEY: 0x00000080,
  NEGOTIATE_NTLM: 0x00000200,
  NEGOTIATE_ALWAYS_SIGN: 0x00008000,
  TARGET_TYPE_DOMAIN: 0x00010000,
  TARGET_TYPE_SERVER: 0x00020000,
  NEGOTIATE_EXTENDED_SESSIONSECURITY: 0x00080000,
  NEGOTIATE_TARGET_INFO: 0x00800000,
  NEGOTIATE_VERSION: 0x02000000,
  NEGOTIATE_128: 0x20000000,
  NEGOTIATE_KEY_EXCH: 0x40000000,
  NEGOTIATE_56: 0x80000000,
} as const

/**
 * What this client asks for in NEGOTIATE (Unicode, NTLM, ESS, version). No
 * key exchange, signing or sealing: HTTP authentication needs none of them
 * (IIS / http.sys reject a key-exchange AUTHENTICATE without sign/seal).
 */
export const CLIENT_FLAGS = (
  NTLMSSP.NEGOTIATE_UNICODE
  | NTLMSSP.REQUEST_TARGET
  | NTLMSSP.NEGOTIATE_NTLM
  | NTLMSSP.NEGOTIATE_ALWAYS_SIGN
  | NTLMSSP.NEGOTIATE_EXTENDED_SESSIONSECURITY
  | NTLMSSP.NEGOTIATE_VERSION
  | NTLMSSP.NEGOTIATE_128
  | NTLMSSP.NEGOTIATE_56
) >>> 0

/** AV_PAIR ids (MS-NLMP 2.2.2.1). */
export const AV = {
  EOL: 0x0000,
  NB_COMPUTER_NAME: 0x0001,
  NB_DOMAIN_NAME: 0x0002,
  DNS_COMPUTER_NAME: 0x0003,
  DNS_DOMAIN_NAME: 0x0004,
  DNS_TREE_NAME: 0x0005,
  FLAGS: 0x0006,
  TIMESTAMP: 0x0007,
  SINGLE_HOST: 0x0008,
  TARGET_NAME: 0x0009,
  CHANNEL_BINDINGS: 0x000a,
} as const

/** MsvAvFlags bit: the AUTHENTICATE message carries a MIC. */
const AV_FLAG_MIC_PRESENT = 0x00000002

/** Windows 10 / NTLM revision 15: the VERSION structure we send. */
const CLIENT_VERSION = Buffer.from([10, 0, 0x61, 0x4a, 0, 0, 0, 0x0f])

export class NtlmProtocolError extends Error {
  constructor(message: string) {
    super(`NTLM: ${message}`)
    this.name = 'NtlmProtocolError'
  }
}

export interface AvPair { id: number; value: Buffer }

export interface ChallengeMessage {
  flags: number
  serverChallenge: Buffer
  targetName: string
  targetInfo: Buffer
  avPairs: AvPair[]
  /** MsvAvTimestamp from the server (FILETIME bytes), when present. */
  timestamp: Buffer | null
  /** The raw message bytes (input to the MIC). */
  raw: Buffer
}

export interface NtlmCredentials {
  /** User name as typed (no domain part). */
  user: string
  /** NetBIOS or DNS domain; '' for a UPN (user@realm in `user`). */
  domain: string
  password: string
}

/** Split `DOMAIN\user`, `user@realm` (UPN: domain stays empty) or a bare `user`. */
export function parseWindowsUsername(raw: string): { user: string; domain: string } {
  const value = String(raw ?? '').trim()
  const slash = value.indexOf('\\')
  if (slash > 0) return { domain: value.slice(0, slash), user: value.slice(slash + 1) }
  return { domain: '', user: value }
}

const utf16 = (s: string) => Buffer.from(s, 'utf16le')

/**
 * Uppercase as Windows does for NTOWFv2: one UTF-16 code unit at a time, never
 * changing the length (JavaScript's 'ß' → 'SS' would break the hash).
 */
export function windowsUpper(s: string): string {
  let out = ''
  for (const ch of s) {
    const up = ch.toUpperCase()
    out += up.length === ch.length ? up : ch
  }
  return out
}

/** NT hash: MD4(UTF-16LE(password)). */
export function ntHash(password: string): Buffer {
  return md4(utf16(password))
}

/** NTOWFv2 = HMAC_MD5(NT hash, UNICODE(Uppercase(User) + UserDom)). */
export function ntowfv2(password: string, user: string, domain: string): Buffer {
  return createHmac('md5', ntHash(password)).update(utf16(windowsUpper(user) + domain)).digest()
}

const hmacMd5 = (key: Buffer, ...data: Buffer[]) => {
  const h = createHmac('md5', key)
  for (const d of data) h.update(d)
  return h.digest()
}

/** NEGOTIATE_MESSAGE (no domain / workstation supplied; VERSION present). */
export function createNegotiateMessage(flags = CLIENT_FLAGS): Buffer {
  const b = Buffer.alloc(40)
  NTLM_SIGNATURE.copy(b, 0)
  b.writeUInt32LE(1, 8)
  b.writeUInt32LE(flags >>> 0, 12)
  // DomainNameFields (16) and WorkstationFields (24): empty, offset = end of header.
  b.writeUInt32LE(40, 20)
  b.writeUInt32LE(40, 28)
  CLIENT_VERSION.copy(b, 32)
  return b
}

function readField(buf: Buffer, at: number, what: string): Buffer {
  if (at + 8 > buf.length) throw new NtlmProtocolError(`${what} field header is truncated`)
  const len = buf.readUInt16LE(at)
  const offset = buf.readUInt32LE(at + 4)
  if (len === 0) return Buffer.alloc(0)
  if (offset + len > buf.length) throw new NtlmProtocolError(`${what} points outside the message`)
  return buf.subarray(offset, offset + len)
}

export function parseAvPairs(info: Buffer): AvPair[] {
  const pairs: AvPair[] = []
  let at = 0
  for (;;) {
    if (at + 4 > info.length) throw new NtlmProtocolError('target info is not terminated by MsvAvEOL')
    const id = info.readUInt16LE(at)
    const len = info.readUInt16LE(at + 2)
    at += 4
    if (id === AV.EOL) {
      if (len !== 0) throw new NtlmProtocolError('MsvAvEOL has a non-zero length')
      return pairs
    }
    if (at + len > info.length) throw new NtlmProtocolError(`AV pair ${id} runs past the target info`)
    pairs.push({ id, value: Buffer.from(info.subarray(at, at + len)) })
    at += len
    if (pairs.length > 64) throw new NtlmProtocolError('too many AV pairs')
  }
}

export function serializeAvPairs(pairs: AvPair[]): Buffer {
  const parts: Buffer[] = []
  for (const { id, value } of pairs) {
    if (id === AV.EOL) continue
    const head = Buffer.alloc(4)
    head.writeUInt16LE(id, 0)
    head.writeUInt16LE(value.length, 2)
    parts.push(head, value)
  }
  parts.push(Buffer.alloc(4)) // MsvAvEOL
  return Buffer.concat(parts)
}

/** Parse and validate a CHALLENGE_MESSAGE (base64 or bytes). */
export function parseChallengeMessage(input: string | Buffer): ChallengeMessage {
  const raw = typeof input === 'string' ? Buffer.from(input, 'base64') : Buffer.from(input)
  if (raw.length < 48) throw new NtlmProtocolError('challenge message is too short')
  if (!raw.subarray(0, 8).equals(NTLM_SIGNATURE)) throw new NtlmProtocolError('challenge has no NTLMSSP signature')
  if (raw.readUInt32LE(8) !== 2) throw new NtlmProtocolError(`expected a CHALLENGE message (type 2), got type ${raw.readUInt32LE(8)}`)
  const flags = raw.readUInt32LE(20)
  if (!(flags & NTLMSSP.NEGOTIATE_UNICODE)) {
    throw new NtlmProtocolError('the server did not agree to Unicode; OEM-only NTLM servers are not supported')
  }
  const targetNameBytes = readField(raw, 12, 'TargetName')
  const targetInfo = Buffer.from(readField(raw, 40, 'TargetInfo'))
  if (!(flags & NTLMSSP.NEGOTIATE_TARGET_INFO) || targetInfo.length === 0) {
    // Without target info only LM / NTLMv1 responses are possible: refuse.
    throw new NtlmProtocolError('the server sent no target info, so NTLMv2 is not possible (LM and NTLMv1 are refused)')
  }
  const avPairs = parseAvPairs(targetInfo)
  const ts = avPairs.find((p) => p.id === AV.TIMESTAMP)
  if (ts && ts.value.length !== 8) throw new NtlmProtocolError('MsvAvTimestamp is not 8 bytes')
  return {
    flags,
    serverChallenge: Buffer.from(raw.subarray(24, 32)),
    targetName: targetNameBytes.toString('utf16le'),
    targetInfo,
    avPairs,
    timestamp: ts ? ts.value : null,
    raw,
  }
}

/** Windows FILETIME (100 ns since 1601-01-01) as 8 little-endian bytes. */
export function fileTime(ms = Date.now()): Buffer {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE((BigInt(Math.floor(ms)) + BigInt(11644473600000)) * BigInt(10000))
  return b
}

/**
 * gss_channel_bindings_struct hash for MsvAvChannelBindings: MD5 over four
 * zero address fields and the application data (`tls-server-end-point:` +
 * certificate hash). 16 zero bytes means "no channel binding".
 */
export function channelBindingsHash(applicationData: Buffer | null): Buffer {
  if (!applicationData) return Buffer.alloc(16)
  const head = Buffer.alloc(20)
  head.writeUInt32LE(applicationData.length, 16)
  return createHash('md5').update(head).update(applicationData).digest()
}

export interface NtlmV2ResponseInput {
  responseKeyNT: Buffer
  serverChallenge: Buffer
  clientChallenge: Buffer
  timestamp: Buffer
  /** The AV pairs to embed (already serialized, ending with MsvAvEOL). */
  avPairs: Buffer
}

/** NTLMv2 response = NTProofStr || temp, plus the session base key (MS-NLMP 3.3.2). */
export function computeNtlmV2Response(i: NtlmV2ResponseInput): { ntChallengeResponse: Buffer; ntProofStr: Buffer; sessionBaseKey: Buffer } {
  const temp = Buffer.concat([
    Buffer.from([1, 1, 0, 0, 0, 0, 0, 0]), // RespType, HiRespType, Z(6)
    i.timestamp,
    i.clientChallenge,
    Buffer.alloc(4),
    i.avPairs,
    Buffer.alloc(4),
  ])
  const ntProofStr = hmacMd5(i.responseKeyNT, i.serverChallenge, temp)
  return {
    ntChallengeResponse: Buffer.concat([ntProofStr, temp]),
    ntProofStr,
    sessionBaseKey: hmacMd5(i.responseKeyNT, ntProofStr),
  }
}

/** LMv2 response (only sent when the server gave no MsvAvTimestamp). */
export function computeLmV2Response(responseKeyLM: Buffer, serverChallenge: Buffer, clientChallenge: Buffer): Buffer {
  return Buffer.concat([hmacMd5(responseKeyLM, serverChallenge, clientChallenge), clientChallenge])
}

export interface AuthenticateOptions {
  /** NEGOTIATE message bytes this exchange started with (MIC input). */
  negotiate: Buffer
  challenge: ChallengeMessage
  credentials: NtlmCredentials
  /** `tls-server-end-point:<hash>` application data, or null over plain HTTP. */
  channelBinding?: Buffer | null
  /** SPN for MsvAvTargetName, e.g. HTTP/sharepoint.contoso.com. */
  targetSpn?: string | null
  workstation?: string
  /** Injected in tests. */
  clientChallenge?: Buffer
  now?: number
}

/**
 * Build the AUTHENTICATE_MESSAGE: NTLMv2 response over the server's target
 * info amended with MsvAvFlags (MIC present), MsvAvChannelBindings and
 * MsvAvTargetName; MIC = HMAC_MD5(ExportedSessionKey, NEGOTIATE || CHALLENGE || AUTHENTICATE).
 */
export function createAuthenticateMessage(o: AuthenticateOptions): Buffer {
  const { challenge, credentials } = o
  const clientChallenge = o.clientChallenge ?? randomBytes(8)
  const timestamp = challenge.timestamp ?? fileTime(o.now)

  // Amend the server's AV pairs (MS-NLMP 3.1.5.1.2).
  const pairs = challenge.avPairs.filter((p) => ![AV.FLAGS, AV.CHANNEL_BINDINGS, AV.TARGET_NAME].includes(p.id as 6 | 9 | 10))
  const existingFlags = challenge.avPairs.find((p) => p.id === AV.FLAGS)
  const flagsValue = Buffer.alloc(4)
  flagsValue.writeUInt32LE(((existingFlags?.value.length === 4 ? existingFlags.value.readUInt32LE(0) : 0) | AV_FLAG_MIC_PRESENT) >>> 0)
  pairs.push({ id: AV.FLAGS, value: flagsValue })
  pairs.push({ id: AV.CHANNEL_BINDINGS, value: channelBindingsHash(o.channelBinding ?? null) })
  if (o.targetSpn) pairs.push({ id: AV.TARGET_NAME, value: utf16(o.targetSpn) })
  const avPairs = serializeAvPairs(pairs)

  const responseKey = ntowfv2(credentials.password, credentials.user, credentials.domain)
  const { ntChallengeResponse, sessionBaseKey } = computeNtlmV2Response({
    responseKeyNT: responseKey,
    serverChallenge: challenge.serverChallenge,
    clientChallenge,
    timestamp,
    avPairs,
  })
  // With MsvAvTimestamp the LM response is Z(24) (MS-NLMP 3.1.5.1.2).
  const lmChallengeResponse = challenge.timestamp
    ? Buffer.alloc(24)
    : computeLmV2Response(responseKey, challenge.serverChallenge, clientChallenge)

  const flags = (((challenge.flags & CLIENT_FLAGS)
    | (challenge.flags & (NTLMSSP.NEGOTIATE_TARGET_INFO | NTLMSSP.TARGET_TYPE_DOMAIN | NTLMSSP.TARGET_TYPE_SERVER))
    | NTLMSSP.NEGOTIATE_UNICODE | NTLMSSP.NEGOTIATE_NTLM | NTLMSSP.NEGOTIATE_VERSION)
    & ~(NTLMSSP.NEGOTIATE_KEY_EXCH | NTLMSSP.NEGOTIATE_SIGN | NTLMSSP.NEGOTIATE_SEAL | NTLMSSP.NEGOTIATE_LM_KEY)) >>> 0

  // NTLMv2 without key exchange: ExportedSessionKey = KeyExchangeKey = SessionBaseKey.
  const exportedSessionKey = sessionBaseKey
  const encryptedRandomSessionKey = Buffer.alloc(0)

  const domain = utf16(credentials.domain)
  const user = utf16(credentials.user)
  const workstation = utf16(o.workstation ?? 'USERTASKS')
  const HEADER = 88 // fixed fields + VERSION (8) + MIC (16)
  const payload = [lmChallengeResponse, ntChallengeResponse, domain, user, workstation, encryptedRandomSessionKey]
  const msg = Buffer.alloc(HEADER + payload.reduce((n, p) => n + p.length, 0))
  NTLM_SIGNATURE.copy(msg, 0)
  msg.writeUInt32LE(3, 8)
  let offset = HEADER
  const fieldPositions = [12, 20, 28, 36, 44, 52]
  payload.forEach((data, idx) => {
    if (data.length > 0xffff) throw new NtlmProtocolError('a message field is too long')
    const at = fieldPositions[idx]
    msg.writeUInt16LE(data.length, at)
    msg.writeUInt16LE(data.length, at + 2)
    msg.writeUInt32LE(offset, at + 4)
    data.copy(msg, offset)
    offset += data.length
  })
  msg.writeUInt32LE(flags, 60)
  CLIENT_VERSION.copy(msg, 64)
  // MIC over all three messages with the MIC field zeroed (it is zero now).
  const mic = hmacMd5(exportedSessionKey, o.negotiate, challenge.raw, msg)
  mic.copy(msg, 72)
  return msg
}

/** Is this base64 token an NTLMSSP message (any type)? */
export function isNtlmToken(base64: string): boolean {
  try {
    return Buffer.from(base64, 'base64').subarray(0, 8).equals(NTLM_SIGNATURE)
  } catch {
    return false
  }
}
