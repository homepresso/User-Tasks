import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  OPTIONAL_DRIVERS_DOCS_PATH,
  OPTIONAL_PACKAGES,
  missingStubPath,
  optionalPackageInstallHint,
  optionalPackageNames,
} from '@/lib/optional-drivers'
import { loadOptionalSdk } from '@/lib/providers/storage/optional-sdk'
import { loadSecretsSdk } from '@/lib/providers/secrets/types'
import { loadKmsSdk } from '@/lib/providers/kms/types'
import { getDocPage } from '@/lib/docs/registry'

/**
 * lib/optional-drivers is the one list of optionalDependencies: next.config.ts
 * aliases the missing ones to stubs, the loaders' errors point at the docs, and
 * the Dockerfile's build args decide what the image keeps.
 */

const root = process.cwd()
const pkgJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { optionalDependencies: Record<string, string> }
const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8')

describe('optional packages', () => {
  it('match package.json optionalDependencies, names and versions', () => {
    const fromRegistry = Object.fromEntries(Object.entries(OPTIONAL_PACKAGES).map(([pkg, info]) => [pkg, info.version]))
    expect(fromRegistry).toEqual(pkgJson.optionalDependencies)
  })

  it('each have a build-time stub that fails like a missing module', async () => {
    for (const pkg of optionalPackageNames()) {
      const stub = missingStubPath(pkg)
      expect(existsSync(path.join(root, stub)), stub).toBe(true)
      expect(readFileSync(path.join(root, stub), 'utf8')).toContain(`Cannot find module '${pkg}'`)
    }
  })

  it('follow the Dockerfile build args', () => {
    const removedBy = (arg: string) => {
      const block = dockerfile.match(new RegExp(`"\\$${arg}" != "true" \\]; then \\\\\\s*rm -rf ([^;]+);`))
      expect(block, arg).not.toBeNull()
      return block![1].split(/\s+/).filter(Boolean).map((p) => p.replace(/^node_modules\//, ''))
    }
    for (const [pkg, info] of Object.entries(OPTIONAL_PACKAGES)) {
      const arg = info.dockerArg
      if (arg === null) {
        expect(dockerfile.includes(`node_modules/${pkg} `) || dockerfile.includes(`node_modules/${pkg};`), pkg).toBe(false)
      } else {
        expect(removedBy(arg.name), pkg).toContain(pkg)
        expect(dockerfile).toContain(`ARG ${arg.name}=${arg.default}`)
      }
    }
  })

  it('install hints name the version, the rebuild, the Docker build arg and the docs page', () => {
    expect(optionalPackageInstallHint('snowflake-sdk')).toBe(
      'install it with `npm install snowflake-sdk@^2.4.0`, then rebuild (`npm run build`) and restart '
      + '(Docker: rebuild the image with --build-arg INCLUDE_OPTIONAL_DB_DRIVERS=true). See /docs/self-hosting/optional-drivers',
    )
    expect(optionalPackageInstallHint('@node-saml/node-saml')).toContain('Docker: rebuild the image from this repository')
    expect(getDocPage(OPTIONAL_DRIVERS_DOCS_PATH.replace(/^\/docs\//, ''))).toBeDefined()
  })

  it('provider loaders turn a missing SDK into the hint', async () => {
    const missing = (pkg: string) => async () => { throw new Error(`Cannot find module '${pkg}'`) }
    await expect(loadOptionalSdk('@aws-sdk/client-s3', missing('@aws-sdk/client-s3')))
      .rejects.toThrow('This storage provider needs the optional package @aws-sdk/client-s3: install it with `npm install @aws-sdk/client-s3@^3.1156.0`')
    await expect(loadSecretsSdk('@google-cloud/secret-manager', 'gcp_secret_manager', missing('@google-cloud/secret-manager')))
      .rejects.toThrow(/INCLUDE_PROVIDER_SDKS=true\)\. See \/docs\/self-hosting\/optional-drivers\.$/)
    await expect(loadKmsSdk('@aws-sdk/client-kms', 'aws_kms', missing('@aws-sdk/client-kms')))
      .rejects.toThrow(/^KMS_PROVIDER=aws_kms needs the optional package @aws-sdk\/client-kms: install it with/)
  })
})
