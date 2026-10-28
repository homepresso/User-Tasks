/**
 * Self-hosted first run: create the first tenant and its owner account.
 *
 * Usage:
 *   npm run bootstrap -- --email admin@example.com --password 'a-strong-password' --org "Acme Inc" [--name "Ada Lovelace"]
 *                        [--api-key "Provisioning"] [--if-missing]
 *
 * Works with any providers (the same as `usertasks-admin bootstrap`; in the
 * Docker image: `node admin.cjs bootstrap …`): the default Supabase stack
 * needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, a
 * Supabase-free install DB_PROVIDER=postgres + DATABASE_URL and
 * AUTH_PROVIDER=builtin. Export them in the shell, or load a file with
 * `set -a; . ./.env.local; set +a`. After it succeeds, sign in at /login and
 * finish setup at /onboarding.
 */
import { runBootstrap } from '../packages/admin/src/bootstrap'

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const [key, inline] = token.slice(2).split('=', 2)
    if (inline !== undefined) {
      args[key] = inline
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      args[key] = argv[++i]
    } else {
      args[key] = ''
    }
  }
  return args
}

function fail(message: string): never {
  console.error(`bootstrap: ${message}`)
  process.exit(1)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const code = await runBootstrap({
    email: String(args.email ?? '').trim(),
    password: String(args.password ?? process.env.BOOTSTRAP_PASSWORD ?? ''),
    org: String(args.org ?? '').trim(),
    name: args.name,
    apiKeyName: args['api-key'],
    ifMissing: 'if-missing' in args,
  }, { out: (line) => console.log(line), err: (line) => console.error(`bootstrap: ${line}`) })
  process.exit(code)
}

main().catch((err) => fail(String(err?.message ?? err)))
