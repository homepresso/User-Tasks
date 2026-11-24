/**
 * Page-size changes on lists whose page and size live in ONE state (the URL:
 * the workflow queue, Active tasks, workflows). Pagination calls
 * onPageSizeChange and then onPageChange(1) unless pageSizeResetsPage is
 * false; when both go through the same `update(patch)` built from the
 * current filters, the second call starts from the OLD filters and puts the
 * old page size back — the size picker did nothing. Those lists already go
 * back to page 1 on a size change, so they must turn the extra reset off.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { describe, expect, it } from 'vitest'
import { nextQueueFilters, parseQueueFilters } from '@/lib/automations/queue-filters'
import { nextActiveFilters, DEFAULT_ACTIVE_FILTERS } from '@/lib/automations/active-task-filters'

const root = path.resolve(__dirname, '..')

describe('page size on URL-driven lists', () => {
  it('a size change alone goes back to page 1 (so no second onPageChange(1) is needed)', () => {
    const f = { ...parseQueueFilters(new URLSearchParams('view=all')), page: 3 }
    expect(nextQueueFilters(f, { pageSize: 50 })).toMatchObject({ pageSize: 50, page: 1 })
    expect(nextActiveFilters({ ...DEFAULT_ACTIVE_FILTERS, page: 4 }, { pageSize: 50 })).toMatchObject({ pageSize: 50, page: 1 })
    // The bug: the second update starts from the stale filters and restores the old size.
    expect(nextQueueFilters(f, { page: 1 }).pageSize).toBe(25)
  })

  it('every Pagination whose size goes through update(...) turns the extra page reset off', () => {
    const files = execSync("git ls-files 'app/**/*.tsx' 'components/**/*.tsx'", { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(path.join(root, file), 'utf8')
      for (const m of src.matchAll(/<Pagination\b[\s\S]*?\/>/g)) {
        const tag = m[0]
        const sizeViaUpdate = /onPageSizeChange=\{\s*\(\s*\w+\s*(?::\s*\w+)?\s*\)\s*=>\s*update\(/.test(tag)
        // QueueList forwards its props: checked by name below.
        const forwarded = /onPageSizeChange=\{onPageSizeChange\}/.test(tag) && /queue-list\.tsx$/.test(file)
        if ((sizeViaUpdate || forwarded) && !/pageSizeResetsPage=\{false\}/.test(tag)) offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })
})
