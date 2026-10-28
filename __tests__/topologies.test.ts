import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import robots from '@/app/robots'
import sitemap from '@/app/sitemap'
import { getDocPage } from '@/lib/docs/registry'
import { pageBlocks } from '@/lib/docs/render'
import { resolveRepoLink } from '@/lib/docs/generated'
import { AREAS, TOPOLOGIES, getTopology } from '@/lib/topologies'

describe('deployment topologies', () => {
  it('have unique ids and only known areas, each area once per diagram', () => {
    expect(new Set(TOPOLOGIES.map((t) => t.id)).size).toBe(TOPOLOGIES.length)
    const areaIds = new Set(AREAS.map((area) => area.id))
    for (const topology of TOPOLOGIES) {
      const areas = [...topology.builtIn, ...topology.zones.flatMap((zone) => zone.items)].map((item) => item.area)
      for (const area of areas) expect(areaIds.has(area), `${topology.id}: ${area}`).toBe(true)
      expect(new Set(areas).size, topology.id).toBe(areas.length)
      expect(areas, topology.id).toContain('database')
    }
  })

  it('link every area to its docs page', () => {
    for (const area of AREAS) expect(getDocPage(area.docs.replace(/^\/docs\//, '')), area.id).toBeDefined()
  })

  it('draw a diagram on every topology docs page', () => {
    const expected: Record<string, string[]> = {
      'topologies/supabase': ['supabase'],
      'topologies/hybrid': ['hybrid-aws', 'hybrid-gcp', 'hybrid-azure'],
      'topologies/aws': ['aws'],
      'topologies/azure': ['azure'],
      'topologies/google-cloud': ['gcp'],
      'topologies/multi-cloud': ['multi-cloud'],
      'topologies/on-premises': ['on-prem'],
    }
    for (const [slug, ids] of Object.entries(expected)) {
      const page = getDocPage(slug)
      expect(page, slug).toBeDefined()
      const drawn = pageBlocks(page!).filter((block) => block.kind === 'directive' && block.name === 'topology').map((block) => (block as { args: string[] }).args[0])
      expect(drawn, slug).toEqual(ids)
      for (const id of ids) expect(getTopology(id), id).toBeDefined()
    }
  })

  it('resolve links between the topology and service guides', () => {
    expect(resolveRepoLink('hybrid.md#example-1-supabase--aws', 'docs/topologies/aws.md')).toBe('/docs/topologies/hybrid#example-1-supabase--aws')
    expect(resolveRepoLink('README.md', 'docs/topologies/aws.md')).toBe('/docs/topologies')
    expect(resolveRepoLink('../services/README.md', 'docs/topologies/README.md')).toBe('/docs/services')
    expect(resolveRepoLink('../infrastructure.md#storage', 'docs/services/storage.md')).toBe('/docs/self-hosting/infrastructure#storage')
  })
})

describe('/deploy-anywhere', () => {
  beforeEach(() => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('is in the sitemap and allowed for crawlers', () => {
    expect(sitemap().map((entry) => entry.url)).toContain('https://usertasks.com/deploy-anywhere')
    const rules = robots().rules
    const allowed = (Array.isArray(rules) ? rules : [rules]).flatMap((rule) => rule.allow ?? [])
    expect(allowed).toContain('/deploy-anywhere')
  })
})
