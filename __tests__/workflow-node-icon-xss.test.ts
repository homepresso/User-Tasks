/**
 * A node's custom SVG icon (config.node_icon_svg) is rendered inline. It can be
 * saved through the API, MCP or a package import (the browser upload sanitises,
 * the server does not), so the card must sanitise it itself — it shows in the
 * designer and in requesters' run-progress view.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultNode, type WorkflowNode } from '@/lib/workflow-schema'
import { nodeCardModel, WorkflowNodeCard } from '@/components/automations/workflow-node-card'

describe('workflow node custom icon', () => {
  const payloads = [
    '<svg onload="alert(1)"><path d="M0 0"/></svg>',
    '<svg><a href="javascript:alert(1)"><circle r="2"/></a></svg>',
    '<img src=x onerror="alert(1)">',
  ]
  it.each(payloads)('never renders a script vector: %s', (payload) => {
    const node = { ...createDefaultNode('send_email'), config: { node_icon_svg: payload } } as WorkflowNode
    const html = renderToStaticMarkup(createElement(WorkflowNodeCard, { node }))
    expect(html).not.toMatch(/onload|onerror|javascript:|<img/i)
    expect(nodeCardModel(node).customIcon.svg ?? '').not.toMatch(/onload|onerror|javascript:|<img/i)
  })
})
