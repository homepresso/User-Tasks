/**
 * Attachments uploads from the command line:
 *
 *   usertasks files upload <path> --field <key> (--task <id> | --form <id> | --workflow <id>)
 *
 * prints the uploaded file object; its id goes in the field's value. The
 * `--attach field=path` flag of `tasks complete`, `forms submit` and
 * `workflows start` uploads and fills the value in one step (repeat it for
 * several files; the same field collects them in order).
 */

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { Command } from 'commander'
import type { UploadedFile, UsertasksClient } from '@usertasks/sdk'
import { CliUsageError } from '../exit-codes'
import type { Runtime } from '../runtime'

export type UploadContext = { task_id?: string; form_id?: string; workflow_id?: string }

/** `field=path` → [field, path]. */
export function parseFileAssignment(value: string): [string, string] {
  const at = value.indexOf('=')
  if (at <= 0 || at === value.length - 1) throw new CliUsageError(`--attach expects field=path, got "${value}"`)
  return [value.slice(0, at), value.slice(at + 1)]
}

export async function uploadPath(client: UsertasksClient, context: UploadContext & { field_key: string }, path: string): Promise<UploadedFile> {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(readFileSync(path))
  } catch (error) {
    throw new CliUsageError(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return client.uploadFile(context, { name: basename(path), bytes })
}

/** Upload every `--attach field=path` and return the values to merge: `{ field: [file ids…] }`. */
export async function uploadFileFlags(client: UsertasksClient, context: UploadContext, assignments: readonly string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {}
  for (const assignment of assignments) {
    const [field, path] = parseFileAssignment(assignment)
    const file = await uploadPath(client, { ...context, field_key: field }, path)
    ;(out[field] ??= []).push(file.id)
  }
  return out
}

export function registerFileCommands(program: Command, runtime: Runtime) {
  const files = program.commands.find((command) => command.name() === 'files') ?? program.command('files').description('Uploads for Attachments fields')
  files
    .command('upload <path>')
    .description('Upload a file for an Attachments field; prints the file (use its id as the field value)')
    .requiredOption('--field <key>', 'The Attachments field (or start-form input) key')
    .option('--task <id>', 'For this open task')
    .option('--form <id>', 'For a submission of this reusable form')
    .option('--workflow <id>', 'For this workflow\'s start form')
    .addHelpText('after', '\nAPI: POST /api/v1/files/uploads (+ PUT to storage and /complete for large files)')
    .action(async (path: string, opts: { field: string; task?: string; form?: string; workflow?: string }, self: Command) => {
      const given = [opts.task, opts.form, opts.workflow].filter(Boolean)
      if (given.length !== 1) throw new CliUsageError('Pass exactly one of --task, --form or --workflow')
      const file = await uploadPath(runtime.client(self), {
        field_key: opts.field,
        ...(opts.task ? { task_id: opts.task } : {}),
        ...(opts.form ? { form_id: opts.form } : {}),
        ...(opts.workflow ? { workflow_id: opts.workflow } : {}),
      }, path)
      runtime.print(self, file)
    })
}
