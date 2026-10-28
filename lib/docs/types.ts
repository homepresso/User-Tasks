/** A docs page: Markdown body (see lib/docs/markdown.ts) plus metadata. */
export interface DocPageDef {
  /** Path below /docs, e.g. `workflows/nodes`. */
  slug: string
  title: string
  /** One sentence: meta description, search result and section card text. */
  description: string
  body: string
  /** Deepest heading level in the "On this page" list (default 3). */
  tocDepth?: 2 | 3
}

export interface DocSectionDef {
  title: string
  pages: DocPageDef[]
  /** Extra sidebar links that are not Markdown pages (e.g. the API Explorer). */
  links?: Array<{ title: string; href: string }>
}
