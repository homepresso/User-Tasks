/**
 * Program assembly and error → exit-code mapping. `run()` never calls
 * process.exit, so tests can drive the CLI in-process.
 */

import { Command, CommanderError, Option } from 'commander'
import { UsertasksApiError, UsertasksOAuthError } from '@usertasks/sdk'
import { registerApiCommand } from './commands/api'
import { registerAuthCommands } from './commands/auth'
import { registerCompletionCommand } from './commands/completion'
import { registerConfigCommands } from './commands/config'
import { registerJobCommands } from './commands/jobs'
import { registerFileCommands } from './commands/files'
import { registerLogCommands } from './commands/logs'
import { registerPackageAuthoringCommands } from './commands/package-authoring'
import { registerPackageCommands } from './commands/packages'
import { registerProfileCommands } from './commands/profiles'
import { registerResourceCommands } from './commands/resources'
import { registerTaskCommands } from './commands/tasks'
import { registerWorkflowCommands } from './commands/workflows'
import { CliExit, EXIT, exitCodeFor } from './exit-codes'
import { COMMAND_SPECS } from './generated/commands'
import type { Io } from './io'
import { CLI_VERSION, Runtime } from './runtime'
import { OUTPUT_FORMATS } from './settings'
import type { CommandSpec } from './spec'

export function buildProgram(runtime: Runtime, specs: readonly CommandSpec[] = COMMAND_SPECS): Command {
  const program = new Command('usertasks')
  program
    .description('Command-line interface for the UserTasks API')
    .version(CLI_VERSION, '-v, --version')
    .exitOverride()
    .configureOutput({
      writeOut: (text) => runtime.io.stdout.write(text),
      writeErr: (text) => runtime.io.stderr.write(text),
    })
    .showHelpAfterError('(run with --help for usage)')
    .configureHelp({ showGlobalOptions: true })
    .option('--profile <name>', 'Profile to use (env USERTASKS_PROFILE)')
    .option('--url <url>', 'Server URL (env USERTASKS_URL)')
    .addOption(new Option('-o, --output <format>', 'Output format (env USERTASKS_OUTPUT; default table on a terminal, json otherwise; text = table)').choices([...OUTPUT_FORMATS, 'text']))
    .option('-f, --file <path>', 'Request body from a JSON/YAML file, or - for stdin')
    .option('--all', 'Fetch every page of a list')
    .option('--limit <n>', 'Page size for list commands')
    .option('--offset <n>', 'Rows to skip for list commands')
    .option('-y, --yes', 'Do not prompt for confirmation')
    .option('--quiet', 'Suppress informational messages')
    .option('--debug', 'Log HTTP requests to stderr')
    .addHelpText('after', '\nCredentials: USERTASKS_API_KEY overrides the profile\'s stored key.\nExit codes: 0 ok, 1 error, 2 usage, 3 unauthenticated, 4 forbidden, 5 not found, 6 validation/conflict, 7 config changes / apply errors, 8 rate limited, 10 network/server error.')

  registerAuthCommands(program, runtime)
  registerProfileCommands(program, runtime)
  registerApiCommand(program, runtime)
  registerCompletionCommand(program, runtime)
  registerConfigCommands(program, runtime)
  registerResourceCommands(program, specs, runtime)
  registerTaskCommands(program, runtime)
  registerFileCommands(program, runtime)
  registerWorkflowCommands(program, runtime)
  registerLogCommands(program, runtime)
  registerPackageCommands(program, runtime)
  registerJobCommands(program, runtime)
  registerPackageAuthoringCommands(program, runtime)
  return program
}

/**
 * A 403 `insufficient_scope` (e.g. `api-keys create` with an OAuth login that
 * lacks `keys:write`) names the missing scope and the granted ones: suggest
 * logging in again with the scope added.
 */
export function missingScopeHint(error: UsertasksApiError): string | null {
  if (error.status !== 403 || error.code !== 'insufficient_scope') return null
  const details = (error.details ?? {}) as { required_scope?: unknown; granted_scopes?: unknown }
  if (typeof details.required_scope !== 'string') return null
  const granted = Array.isArray(details.granted_scopes) ? details.granted_scopes.filter((s): s is string => typeof s === 'string') : []
  const scopes = [...granted.filter((s) => s !== details.required_scope), details.required_scope]
  return `re-run: usertasks login --scopes ${scopes.join(',')}`
}

function reportError(runtime: Runtime, error: unknown, debug: boolean) {
  const write = (text: string) => runtime.io.stderr.write(`${text}\n`)
  if (error instanceof UsertasksApiError) {
    write(`error: ${error.message} (HTTP ${error.status}${error.code ? `, ${error.code}` : ''})`)
    if (Array.isArray(error.details)) {
      for (const detail of error.details as { path?: string; message?: string }[]) {
        write(`  - ${detail.path ? `${detail.path}: ` : ''}${detail.message ?? JSON.stringify(detail)}`)
      }
    }
    if (error.requestId) write(`  request id: ${error.requestId}`)
    if (error.status === 401) write('  hint: run `usertasks login` (or `usertasks login --api-key`), or check USERTASKS_API_KEY')
    const scopeHint = missingScopeHint(error)
    if (scopeHint) write(`  ${scopeHint}`)
  } else if (error instanceof UsertasksOAuthError) {
    write(`error: ${error.description ?? error.error} (${error.error})`)
    if (error.error === 'login_required' || error.error === 'invalid_grant') write('  hint: your session has ended; run `usertasks login` again')
  } else {
    write(`error: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (debug && error instanceof Error && error.stack) write(error.stack)
}

/** Run the CLI with `args` (without the node/script prefix); resolves to the exit code. */
export async function run(args: readonly string[], io: Io): Promise<number> {
  const runtime = new Runtime(io)
  const program = buildProgram(runtime)
  try {
    await program.parseAsync([...args], { from: 'user' })
    return EXIT.ok
  } catch (error) {
    if (error instanceof CommanderError) {
      // Help / version requests exit 0; parse errors were already printed by commander.
      return error.exitCode === 0 ? EXIT.ok : EXIT.usage
    }
    if (error instanceof CliExit) return error.code
    reportError(runtime, error, Boolean(args.includes('--debug')))
    return exitCodeFor(error)
  }
}
