import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { buildMimeMessage } from './mime'
import { emailOption, type EmailOptions, type EmailTransport } from './types'

/**
 * Development / test sink: logs one line per message (recipients and
 * subject, never the body) and, with console_dir (EMAIL_CONSOLE_DIR),
 * writes each message as an .eml file that any mail client opens.
 */

export function createConsoleTransport(options: EmailOptions): EmailTransport {
  const dir = emailOption(options, 'console_dir')
  return {
    id: 'console',
    onPrem: true,
    async send(message) {
      const id = `${Date.now()}-${randomBytes(4).toString('hex')}`
      let file = ''
      if (dir) {
        await mkdir(dir, { recursive: true })
        file = path.join(dir, `${id}.eml`)
        await writeFile(file, buildMimeMessage(message), { mode: 0o600 })
      }
      const files = message.attachments?.length ? ` [${message.attachments.length} attachment${message.attachments.length === 1 ? '' : 's'}: ${message.attachments.map((a) => a.filename).join(', ')}]` : ''
      console.log(`[email:console] to ${message.to.join(', ')} — ${message.subject}${files}${file ? ` (${file})` : ''}`)
      return { id }
    },
  }
}
