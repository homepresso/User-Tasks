// Compiles every server chunk from a production build the way Node loads it,
// so a minifier-broken file (e.g. an embedded wasm string turned into an
// invalid template literal) fails before deploy instead of at runtime.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

const root = process.argv[2] ?? '.next/server'
const bad = []
let count = 0
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (name.endsWith('.js')) {
      count++
      try { new vm.Script(`(function (exports, require, module, __filename, __dirname) {${readFileSync(p, 'utf8')}\n})`, { filename: p }) }
      catch (e) { bad.push(`${p}: ${e.message}`) }
    }
  }
}
walk(root)
if (bad.length) { console.error(`✗ ${bad.length} of ${count} server chunks do not compile:\n${bad.join('\n')}`); process.exit(1) }
console.log(`✓ ${count} server chunks compile`)
