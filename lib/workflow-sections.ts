/**
 * Utilities for collapsible workflow sections (section_group nodes).
 * Sections are a purely visual grouping concept — they don't affect execution.
 * When a section_group node is collapsed, its contained nodes are hidden and
 * edges re-route to the section header boundary.
 */

import type { WorkflowNode, WorkflowEdge } from './workflow-schema'

export const SECTION_HEADER_HEIGHT = 40
export const SECTION_COLLAPSED_WIDTH = 240

export interface ResolvedGraph {
  visibleNodes: WorkflowNode[]
  hiddenNodeIds: Set<string>
  resolvedEdges: WorkflowEdge[]
}

/** Get all section_group nodes from a nodes array */
export function getSectionNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.filter(n => n.type === 'section_group')
}

/** Get section dimensions from a section_group node's config */
export function getSectionDimensions(section: WorkflowNode): { width: number; height: number; color: string } {
  return {
    width: section.config?.width ?? 500,
    height: section.config?.height ?? 300,
    color: section.config?.color ?? '#6366F1',
  }
}

/**
 * Resolves which nodes/edges are visible given collapsed section states.
 * Edges to/from hidden nodes get re-routed to the collapsed section header.
 */
export function resolveVisibleGraph(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): ResolvedGraph {
  const sectionNodes = getSectionNodes(nodes)
  const collapsedSectionIds = new Set(sectionNodes.filter(s => s.collapsed).map(s => s.id))

  // Determine which nodes are hidden
  const hiddenNodeIds = new Set<string>()
  const nodeToSection = new Map<string, string>()
  for (const node of nodes) {
    if (node.type === 'section_group') continue
    if (node.sectionId && collapsedSectionIds.has(node.sectionId)) {
      hiddenNodeIds.add(node.id)
    }
    if (node.sectionId) {
      nodeToSection.set(node.id, node.sectionId)
    }
  }

  const visibleNodes = nodes.filter(n => !hiddenNodeIds.has(n.id))

  // Re-route edges: if source/target is hidden, point to the section node
  const resolvedEdges = edges.map(edge => {
    const sourceHidden = hiddenNodeIds.has(edge.source)
    const targetHidden = hiddenNodeIds.has(edge.target)
    if (!sourceHidden && !targetHidden) return edge

    const newEdge = { ...edge }
    if (sourceHidden) {
      const sectionId = nodeToSection.get(edge.source)
      if (sectionId) newEdge.source = sectionId
    }
    if (targetHidden) {
      const sectionId = nodeToSection.get(edge.target)
      if (sectionId) newEdge.target = sectionId
    }
    return newEdge
  })

  // Deduplicate edges that collapse into the same section
  // When multiple branch edges point to hidden nodes in the same section,
  // they all remap to section — just drop the label to avoid confusion
  const edgeMap = new Map<string, WorkflowEdge>()
  for (const e of resolvedEdges) {
    if (e.source === e.target) continue // Skip internal edges
    const key = `${e.source}→${e.target}`
    if (edgeMap.has(key)) {
      // Multiple edges collapsed to same target — clear the label since it's ambiguous
      const existing = edgeMap.get(key)!
      if (existing.label && e.label && existing.label !== e.label) {
        edgeMap.set(key, { ...existing, label: undefined })
      }
    } else {
      edgeMap.set(key, e)
    }
  }
  const deduped = [...edgeMap.values()]
  return { visibleNodes, hiddenNodeIds, resolvedEdges: deduped }
}

/**
 * Check if a point (node position) is within an expanded section_group node's bounds.
 */
export function isPointInSection(
  x: number, y: number,
  section: WorkflowNode,
): boolean {
  if (section.collapsed) return false
  const { width, height } = getSectionDimensions(section)
  return (
    x >= section.position.x &&
    x <= section.position.x + width &&
    y >= section.position.y + SECTION_HEADER_HEIGHT &&
    y <= section.position.y + height
  )
}

/**
 * Auto-assign sectionId based on node position within expanded section_group nodes.
 */
export function autoAssignSection(
  node: WorkflowNode,
  allNodes: WorkflowNode[],
): string | undefined {
  const sections = getSectionNodes(allNodes)
  for (const section of sections) {
    if (isPointInSection(node.position.x, node.position.y, section)) {
      return section.id
    }
  }
  return undefined
}

export const SECTION_COLORS = [
  '#B08A54', // Camel
  '#4F7A5B', // Sage
  '#5B7285', // Slate blue
  '#C25E4C', // Terracotta
  '#A6721C', // Ochre
  '#7D5B7A', // Plum
  '#8A9B6E', // Olive
  '#6E8CA0', // Dusty blue
]
