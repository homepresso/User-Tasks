/**
 * The Nintex readers' view of XML: element name, attributes, child elements
 * and own text — over the safe core reader (lib/documents/xml.ts: no DTDs,
 * no external entities, bounded depth and size).
 */
import { decodeXmlEntities, parseXml as parseSafe, type XmlChild, type XmlElement } from '@/lib/documents/xml'

export interface XmlNode {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
}

const MAX_CHARS = 32 * 1024 * 1024

function convert(e: XmlElement): XmlNode {
  const children: XmlNode[] = []
  let text = ''
  for (const c of e.children as XmlChild[]) {
    if (typeof c === 'string') text += c
    else children.push(convert(c))
  }
  return { name: e.name, attrs: e.attrs, children, text }
}

export function parseXml(xml: string): XmlNode {
  if (xml.length > MAX_CHARS) throw new Error('XML document too large')
  const root = convert(parseSafe(xml, { maxDepth: 400, maxNodes: 2_000_000 }))
  // The safe reader returns the root element: give the readers a document around it.
  return root.name === '#document' ? root : { name: '#document', attrs: {}, children: [root], text: '' }
}

export function local(name: string): string {
  const i = name.indexOf(':')
  return i >= 0 ? name.slice(i + 1) : name
}

/** All text under a node, in document order. */
export function textOf(node: XmlNode): string {
  return node.text + node.children.map(textOf).join('')
}

export const decodeXml = decodeXmlEntities

/** Bytes → text (UTF-8, or UTF-16 with a byte order mark). */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '')
}
