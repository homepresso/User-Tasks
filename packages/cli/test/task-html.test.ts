import { describe, expect, it } from 'vitest'
import { htmlToText, stripHtmlFields } from '../src/html'
import { harness, ok } from './helpers'

const HTML = '<p>Ship <strong>today</strong> &amp; invoice</p><ul><li>One</li></ul>'

describe('CLI: task descriptions are plain text unless --html', () => {
  const env = { USERTASKS_URL: 'https://tasks.test', USERTASKS_API_KEY: 'ut_key' }

  it('requests strip_html=true and strips client-side; --html keeps the HTML', async () => {
    const h = harness({ env, responder: () => ok({ task: { id: 'task-a', description: HTML } }) })
    expect(await h.run('tasks', 'get', 'task-a', '-o', 'json')).toBe(0)
    expect(h.requests[0].url.searchParams.get('strip_html')).toBe('true')
    expect(JSON.parse(h.stdout()).task.description).toBe('Ship today & invoice\n- One')

    const raw = harness({ env, responder: () => ok({ task: { id: 'task-a', description: HTML } }) })
    expect(await raw.run('tasks', 'get', 'task-a', '--html', '-o', 'json')).toBe(0)
    expect(raw.requests[0].url.searchParams.has('strip_html')).toBe(false)
    expect(JSON.parse(raw.stdout()).task.description).toBe(HTML)
  })

  it('strips list output and PATCH responses (no server option there)', async () => {
    const h = harness({ env, responder: (r) => (r.method === 'PATCH'
      ? ok({ task: { id: 'task-a', description: '<p>Done</p>' } })
      : ok({ tasks: [{ id: 'task-a', title: 'Review', description: HTML }], total: 1 })) })
    expect(await h.run('tasks', 'list', '-o', 'json')).toBe(0)
    expect(h.requests[0].url.searchParams.get('strip_html')).toBe('true')
    expect(JSON.parse(h.stdout()).tasks[0].description).toBe('Ship today & invoice\n- One')
    expect(await h.run('tasks', 'update', 'task-a', '--set', 'description=<p>Done</p>', '-o', 'json')).toBe(0)
    expect(h.stdout()).toContain('"description": "Done"')
  })

  it('htmlToText / stripHtmlFields', () => {
    expect(htmlToText('Plain & simple')).toBe('Plain & simple')
    expect(htmlToText('<p>a<br>b</p><script>x()</script>&lt;tag&gt;')).toBe('a\nb\n<tag>')
    expect(stripHtmlFields({ tasks: [{ description: '<b>x</b>', title: '<b>t</b>' }] }, ['description'])).toEqual({ tasks: [{ description: 'x', title: '<b>t</b>' }] })
  })
})
