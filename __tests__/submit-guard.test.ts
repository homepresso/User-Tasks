import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createSubmitGuard, ignoreRedirect, isRedirectError } from '@/lib/submit-guard'
import { SubmitButton } from '@/components/ui/submit-button'

/** A promise the test resolves / rejects by hand. */
function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function redirectError(path = '/automations/1') {
  return Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${path};307;` })
}

describe('createSubmitGuard', () => {
  it('runs the first call and ignores calls made while it is in flight', async () => {
    const guard = createSubmitGuard()
    const gate = deferred()
    const action = vi.fn(async () => { await gate.promise; return 'created' })

    // Double click / double Enter: both calls start before any await resolves.
    const first = guard.run(action)
    const second = guard.run(action)
    const third = guard.run(action)

    expect(action).toHaveBeenCalledTimes(1)
    expect(guard.pending).toBe(true)
    await expect(second).resolves.toBeUndefined()
    await expect(third).resolves.toBeUndefined()

    gate.resolve()
    await expect(first).resolves.toBe('created')
    expect(action).toHaveBeenCalledTimes(1)
    expect(guard.pending).toBe(false)
  })

  it('flips pending synchronously, before the action awaits anything', () => {
    const guard = createSubmitGuard()
    void guard.run(() => new Promise(() => {}))
    expect(guard.pending).toBe(true)
  })

  it('releases after the action resolves so a later submit runs', async () => {
    const guard = createSubmitGuard()
    const action = vi.fn(async () => 1)
    await guard.run(action)
    await guard.run(action)
    expect(action).toHaveBeenCalledTimes(2)
    expect(guard.pending).toBe(false)
  })

  it('releases after the action rejects and rethrows the error', async () => {
    const guard = createSubmitGuard()
    const failing = vi.fn(async () => { throw new Error('boom') })
    await expect(guard.run(failing)).rejects.toThrow('boom')
    expect(guard.pending).toBe(false)

    const retry = vi.fn(async () => 'ok')
    await expect(guard.run(retry)).resolves.toBe('ok')
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('releases after a synchronous throw', async () => {
    const guard = createSubmitGuard()
    await expect(guard.run(() => { throw new Error('sync') })).rejects.toThrow('sync')
    expect(guard.pending).toBe(false)
  })

  it('stays locked on a Next redirect (success + navigation) and rethrows it', async () => {
    const guard = createSubmitGuard()
    const err = redirectError()
    await expect(guard.run(async () => { throw err })).rejects.toBe(err)
    expect(guard.pending).toBe(true)

    const again = vi.fn(async () => 'second')
    await expect(guard.run(again)).resolves.toBeUndefined()
    expect(again).not.toHaveBeenCalled()

    guard.reset()
    expect(guard.pending).toBe(false)
    await expect(guard.run(again)).resolves.toBe('second')
  })

  it('reports pending changes (what the React hook mirrors into state)', async () => {
    const changes: boolean[] = []
    const guard = createSubmitGuard({ onPendingChange: (p) => changes.push(p) })
    const gate = deferred()
    const run = guard.run(() => gate.promise)
    void guard.run(() => gate.promise) // ignored: no extra change
    gate.resolve()
    await run
    expect(changes).toEqual([true, false])
  })

  it('reproduces the dialog pattern: three rapid submits create one record', async () => {
    // Mirrors a create dialog: handleSubmit(formData) → run(() => createX(formData)).
    const guard = createSubmitGuard()
    const created: string[] = []
    const createRecord = vi.fn(async (name: string) => {
      await new Promise((r) => setTimeout(r, 5))
      created.push(name)
    })
    const handleSubmit = (name: string) => guard.run(() => createRecord(name))
    await Promise.all([handleSubmit('Clients'), handleSubmit('Clients'), handleSubmit('Clients')])
    expect(createRecord).toHaveBeenCalledTimes(1)
    expect(created).toEqual(['Clients'])
  })
})

describe('isRedirectError / ignoreRedirect', () => {
  it('recognises the NEXT_REDIRECT digest only', () => {
    expect(isRedirectError(redirectError())).toBe(true)
    expect(isRedirectError(new Error('NEXT_REDIRECT'))).toBe(false)
    expect(isRedirectError({ digest: 'NEXT_NOT_FOUND' })).toBe(false)
    expect(isRedirectError(null)).toBe(false)
    expect(isRedirectError('NEXT_REDIRECT')).toBe(false)
  })

  it('swallows redirects and rethrows anything else', () => {
    expect(ignoreRedirect(redirectError())).toBeUndefined()
    const other = new Error('nope')
    expect(() => ignoreRedirect(other)).toThrow(other)
  })
})

describe('SubmitButton', () => {
  it('is a submit button, enabled when idle, with its children', () => {
    const html = renderToStaticMarkup(createElement(SubmitButton, { pendingLabel: 'Creating…' }, 'Create'))
    expect(html).toContain('type="submit"')
    expect(html).not.toContain('disabled=""')
    expect(html).not.toContain('aria-busy')
    expect(html).toContain('>Create<')
  })

  it('disables itself and shows the pending label while pending', () => {
    const html = renderToStaticMarkup(createElement(SubmitButton, { pending: true, pendingLabel: 'Creating…' }, 'Create'))
    expect(html).toMatch(/disabled=""/)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Creating…')
    expect(html).toContain('animate-spin')
    expect(html).not.toContain('>Create<')
  })

  it('keeps its children while pending when no pending label is given', () => {
    const html = renderToStaticMarkup(createElement(SubmitButton, { pending: true, size: 'sm' }, 'Generate Key'))
    expect(html).toMatch(/disabled=""/)
    expect(html).toContain('Generate Key')
  })

  it('honours an explicit disabled and passes button props through', () => {
    const html = renderToStaticMarkup(createElement(SubmitButton, { disabled: true, 'data-testid': 'save' } as never, 'Save'))
    expect(html).toMatch(/disabled=""/)
    expect(html).toContain('data-testid="save"')
  })
})
