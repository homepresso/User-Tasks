import type { SetupDb } from '@/lib/setup/state'

/**
 * `usertasks-admin setup-code [status]`: the first-run setup code of a
 * self-hosted install with no workspaces yet (lib/setup).
 *   setup-code         a new code, printed once (the previous one stops working);
 *   setup-code status  whether setup is still needed and when the code was made.
 * Only a hash is stored, so an existing code can't be printed again.
 */

export interface SetupCodeIO {
  out: (line: string) => void
  err: (line: string) => void
  env: Record<string, string | undefined>
}

export async function runSetupCode(action: 'new' | 'status', io: SetupCodeIO, db?: SetupDb): Promise<number> {
  if (io.env.DEPLOYMENT_MODE?.trim().toLowerCase() === 'cloud') {
    io.err('The cloud edition has no first-run setup (DEPLOYMENT_MODE=cloud).')
    return 2
  }
  const [{ isInstanceEmpty, readCodeRow, rotateSetupCode }, { envSetupCode, setupCodeLogLine, SETUP_CODE_ENV, MIN_ENV_CODE_LENGTH }] = await Promise.all([
    import('@/lib/setup/state'),
    import('@/lib/setup/code'),
  ])
  const store: SetupDb = db ?? ((await import('@/lib/providers/db')).getServiceDb() as unknown as SetupDb)

  let empty: boolean
  try {
    empty = await isInstanceEmpty(store)
  } catch (error) {
    io.err(`Can't read the database: ${(error as Error).message}`)
    return 1
  }
  const fromEnv = envSetupCode(io.env)

  if (action === 'status') {
    if (!empty) { io.out('Setup is complete: this install has an admin account. Sign in at /login.'); return 0 }
    io.out('Setup is needed: open /setup to create the admin account.')
    if (fromEnv && 'code' in fromEnv) io.out(`${SETUP_CODE_ENV} is set in this environment: the server uses it as the setup code.`)
    else if (fromEnv) io.out(`${SETUP_CODE_ENV} is shorter than ${MIN_ENV_CODE_LENGTH} characters and is ignored.`)
    const row = await readCodeRow(store).catch(() => null)
    io.out(row ? `Current setup code made at ${row.createdAt}. Run \`usertasks-admin setup-code\` for a new one.` : 'No setup code yet: the server makes one when it starts (or run `usertasks-admin setup-code`).')
    return 0
  }

  if (!empty) {
    io.err('Setup is complete: this install already has an admin account, so there is no setup code. Sign in at /login (or add an account with `usertasks-admin bootstrap`).')
    return 1
  }
  if (fromEnv && 'code' in fromEnv) {
    io.out(`${SETUP_CODE_ENV} is set in this environment. If the server has the same setting, that is the setup code; unset it there to use a generated one.`)
  }
  let code: string
  try {
    code = await rotateSetupCode(store, 'usertasks-admin')
  } catch (error) {
    io.err(`Could not save a setup code: ${(error as Error).message}. Apply the migrations first (usertasks-admin db migrate).`)
    return 1
  }
  io.out(setupCodeLogLine(code))
  io.out('Any earlier setup code no longer works.')
  return 0
}
