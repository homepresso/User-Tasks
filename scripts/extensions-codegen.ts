/**
 * Generate the build-time extension registry from USERTASKS_EXTENSIONS
 * (lib/extensions/build/codegen.ts). next.config.ts runs the same generator
 * on every build; this script is for CI and local checks.
 *
 *   npm run extensions:gen                 # write lib/extensions/generated/*
 *   npm run extensions:gen -- --check      # exit 1 when the files are stale
 *   USERTASKS_EXTENSIONS=./extensions/example-hello npm run extensions:gen
 *
 * After generating, every manifest is validated in full (zod schema, cross
 * references, compatibility) by loading the registry.
 */
import { generateExtensionRegistry } from '../lib/extensions/build/codegen'

const check = process.argv.includes('--check')
const result = generateExtensionRegistry({ root: process.cwd(), write: !check })
if (check) {
  const stale = result.files.filter((f) => f.changed)
  for (const f of stale) console.error(`${f.path} is out of date for USERTASKS_EXTENSIONS="${process.env.USERTASKS_EXTENSIONS ?? ''}". Run \`npm run extensions:gen\`.`)
  if (stale.length) process.exit(1)
}
for (const ext of result.extensions) console.log(`extension ${ext.id}@${ext.version} (${ext.spec})`)
if (!result.extensions.length) console.log('No extensions (USERTASKS_EXTENSIONS is empty): the registry is empty.')
if (!check && result.extensions.length) {
  // Full validation (zod manifests, compatibility): load the freshly written registry.
  void import('../lib/extensions/server-registry').then(({ extensionProblems }) => {
    const problems = extensionProblems()
    for (const problem of problems) console.error(`extension problem: ${problem}`)
    if (problems.length) process.exit(1)
  })
}
