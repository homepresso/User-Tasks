/**
 * Pure helpers of `npm run stack` (scripts/stack.ts), separate so tests can
 * import them without running the CLI.
 */

import { DOCKER_BUILD_MEMORY_GB } from '../lib/docker-build-memory'

/** Memory Docker needs to build the image (lib/docker-build-memory.ts). */
export const BUILD_MEMORY_GB = DOCKER_BUILD_MEMORY_GB

/**
 * Docker's memory (the Docker Desktop VM's, or the host's on Linux) against
 * what the image build needs: stop early with how to raise it, instead of
 * `next build` being killed ten minutes in.
 */
export function memoryCheckMessage(memTotalBytes: number, needGb = BUILD_MEMORY_GB): string | null {
  if (!Number.isFinite(memTotalBytes) || memTotalBytes <= 0) return null
  const haveGb = memTotalBytes / 1024 ** 3
  // Docker Desktop reports a little under the setting (8 GB shows as ~7.7).
  if (haveGb >= needGb - 0.5) return null
  return [
    `Docker has ${haveGb.toFixed(1)} GB of memory; building UserTasks needs about ${needGb} GB.`,
    `In Docker Desktop: Settings → Resources → Memory → set it to ${needGb} GB or more → Apply & restart, then run this again.`,
    'Other containers running in Docker (a local Supabase, for example) use some of that memory too.',
    'Or run UserTasks from source instead, which needs much less: npm run setup:local (see /open-source).',
    'To build anyway: add --skip-memory-check.',
  ].join('\n')
}

/** The first-login file's contents: where to sign in, and the generated password. */
export function firstLoginText(appUrl: string, email: string, org: string, password: string): string {
  return [
    '# UserTasks first sign-in (written by npm run stack -- up). Delete this file once you have signed in',
    '# and changed the password (Profile → Password).',
    `URL=${appUrl}/login`,
    `ORGANISATION=${org}`,
    `EMAIL=${email}`,
    `PASSWORD=${password}`,
  ].join('\n')
}

/**
 * The console's last lines after `up --email --org`: no secret in them.
 * `password` is the first-login file's path when the password was generated,
 * `chosen` when it came from --password / BOOTSTRAP_PASSWORD, `existing` when
 * the account was already there.
 */
export function loginHint(appUrl: string, email: string, password: string | 'chosen' | 'existing'): string {
  return [
    `Sign in: open ${appUrl}/login and sign in as ${email}.`,
    password === 'existing'
      ? 'That account already existed: use its password (Forgot password? on the sign-in page resets it).'
      : password === 'chosen'
        ? 'Use the password you chose.'
        : `The generated password is in ${password} (only your user can read it). Delete the file once you have signed in.`,
  ].join('\n')
}

/** The console's last lines when no workspace was created: the setup screen and its code. */
export function setupHint(appUrl: string, setupCode: string | undefined): string {
  return setupCode && setupCode.replace(/[\s-]/g, '').length >= 8
    ? [
        `Create your admin account: open ${appUrl}/setup and enter the setup code ${setupCode}`,
        '(USERTASKS_SETUP_CODE in the env file; it only works until the first account exists).',
      ].join('\n')
    : `Create your admin account: open ${appUrl}/setup with the setup code from \`docker compose logs app\` (or \`docker compose exec app node admin.cjs setup-code\`), or run: npm run stack -- up --email you@example.com --org "Your org"`
}
