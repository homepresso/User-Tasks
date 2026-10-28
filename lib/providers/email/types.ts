import { isMissingSdkError } from '../storage/optional-sdk'
import { optionalPackageInstallHint } from '../../optional-drivers'

/** One outgoing message, after lib/email.ts applied the from / reply-to defaults. */
export interface EmailMessage {
  /** Display form allowed: `Name <addr@example.com>`. */
  from: string
  to: string[]
  subject: string
  html: string
  /** Plain-text alternative (derived from the HTML when absent). */
  text?: string
  replyTo?: string
}

export interface EmailSendResult {
  success: boolean
  id?: string
  error?: string
}

export interface EmailProviderInfo {
  readonly id: string
  /** Runs fully on-premises / air-gapped (plan: provider catalogue). */
  readonly onPrem: boolean
}

export interface EmailTransport extends EmailProviderInfo {
  /** Throws on failure; lib/email.ts turns errors into `{ success: false }`. */
  send(message: EmailMessage): Promise<{ id?: string }>
}

export type EmailOptions = Record<string, unknown>

export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailConfigError'
  }
}

export function emailOption(options: EmailOptions, name: string): string | undefined {
  const value = options[name]
  if (value === undefined || value === null) return undefined
  const text = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return text.trim() === '' ? undefined : text.trim()
}

export function emailBool(options: EmailOptions, name: string): boolean | undefined {
  const value = options[name]
  if (typeof value === 'boolean') return value
  const text = emailOption(options, name)?.toLowerCase()
  if (text === undefined) return undefined
  if (['1', 'true', 'yes', 'on'].includes(text)) return true
  if (['0', 'false', 'no', 'off'].includes(text)) return false
  return undefined
}

export function requireEmailOption(options: EmailOptions, name: string, env: string, provider: string): string {
  const value = emailOption(options, name)
  if (!value) throw new EmailConfigError(`EMAIL_PROVIDER=${provider} requires ${env} (email.${name})`)
  return value
}

/** `Name <addr>` → { name, address }; a bare address has no name. */
export function parseAddress(value: string): { name?: string; address: string } {
  const match = /^\s*(?:"?([^"<]*?)"?\s*)?<\s*([^>\s]+)\s*>\s*$/.exec(value)
  if (match) return { ...(match[1]?.trim() ? { name: match[1].trim() } : {}), address: match[2] }
  return { address: value.trim() }
}

/** Plain text from HTML for the text/plain alternative. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Lazy import of an optional SDK with an actionable error when it is missing. */
export async function loadEmailSdk<T>(pkg: string, provider: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load()
  } catch (error) {
    if (isMissingSdkError(error, pkg)) {
      throw new EmailConfigError(`EMAIL_PROVIDER=${provider} needs the optional package ${pkg}: ${optionalPackageInstallHint(pkg)}.`)
    }
    throw error
  }
}
