/**
 * Hand-written job commands on top of the generated `jobs` group
 * (list / get / cancel / retry / result):
 *
 *   usertasks jobs wait <id>                       poll until the job finishes (exit 1 when it failed)
 *   usertasks jobs download <id> [--out <file>]    save the job's result file (default: its own file name)
 */

import { writeFileSync } from 'node:fs'
import type { Command } from 'commander'
import { UsertasksJobError } from '@usertasks/sdk'
import type { Runtime } from '../runtime'
import { jobProgressLine } from './resources'

export function registerJobCommands(program: Command, runtime: Runtime) {
  const jobs = program.commands.find((command) => command.name() === 'jobs') ?? program.command('jobs').description('Background jobs')

  jobs
    .command('wait <id>')
    .description('Wait for a background job to finish and print it')
    .option('--timeout <seconds>', 'Give up after this many seconds')
    .addHelpText('after', '\nAPI: GET /api/v1/jobs/{id} (polled)')
    .action(async (id: string, opts: { timeout?: string }, self: Command) => {
      const timeoutMs = opts.timeout ? Math.max(1, Number(opts.timeout)) * 1000 : undefined
      const job = await runtime.client(self).waitForJob(id, { timeoutMs, onProgress: (j) => runtime.info(self, jobProgressLine(j)) })
      runtime.print(self, { job })
      if (job.status !== 'succeeded') throw new UsertasksJobError(job)
    })

  jobs
    .command('download <id>')
    .description('Save the result file of a finished job')
    .option('--out <file>', 'Where to write it (default: the file name of the result)')
    .addHelpText('after', '\nAPI: GET /api/v1/jobs/{id}/download')
    .action(async (id: string, opts: { out?: string }, self: Command) => {
      const file = await runtime.client(self).downloadJob(id)
      const target = opts.out || file.filename.replace(/[\\/]/g, '_')
      writeFileSync(target, file.bytes)
      runtime.info(self, `Wrote ${target} (${file.bytes.byteLength} bytes)`)
    })
}
