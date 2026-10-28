'use client'

import {
  Archive, Brain, Briefcase, CheckSquare, Cloud, CloudCog, Cog, Container, CreditCard,
  Database, FileText, Flame, FolderOpen, Globe, HardDrive, Inbox, Landmark, Layers, Leaf,
  Mail, MessageSquare, Monitor, PenTool, Phone, Search, ServerCog, Snowflake, Sparkles,
  Ticket, UserCircle, Users, Workflow, Zap,
} from 'lucide-react'
import { useState } from 'react'
import { getConnectorDefinition } from './registry'
import { CONNECTOR_LOGO_SOURCES } from './logo-sources'

/**
 * OOTB connector branding for workflow nodes: resolves the connector behind an
 * integration (via the `<connector-key>` tag stamped at enable time) and
 * renders its lucide icon in the brand color. Uploaded SVG/PNG icons
 * (integration.config.icon_url) take precedence over this.
 */

const ICONS: Record<string, any> = {
  Archive, Brain, Briefcase, CheckSquare, Cloud, CloudCog, Cog, Container, CreditCard,
  Database, FileText, Flame, FolderOpen, Globe, HardDrive, Inbox, Landmark, Layers, Leaf,
  Mail, MessageSquare, Monitor, PenTool, Phone, Search, ServerCog, Snowflake, Sparkles,
  Ticket, UserCircle, Users, Workflow, Zap,
}

export interface ConnectorBrand {
  key: string
  icon: string
  color: string
  /** Official brand image (logo-sources) when we have one. */
  logoSrc?: string
}

/** Resolve the OOTB connector brand from an integration's tags (e.g. ['azure-blob']). */
export function connectorBrandForTags(tags: string[] | null | undefined): ConnectorBrand | null {
  for (const tag of tags ?? []) {
    const key = String(tag).replace(/-/g, '_')
    const def = getConnectorDefinition(key)
    if (def) return { key: def.key, icon: def.icon, color: def.color, logoSrc: CONNECTOR_LOGO_SOURCES[def.key]?.src }
  }
  return null
}

/** Lucide icon component for a stored brand icon name (node_icon_lucide). */
export function brandIconComponent(name: string | undefined | null) {
  return name ? ICONS[name] ?? null : null
}

/**
 * Workflow-node icon: uploaded/brand image first (with load-error fallback to
 * the connector's lucide brand icon), used by the canvas and process viewer.
 */
export function NodeBrandIcon({ url, lucide, color, size = 11, chipClass }: {
  url?: string | null
  lucide?: string | null
  color?: string | null
  size?: number
  chipClass: string
}) {
  const [failed, setFailed] = useState(false)
  const Icon = brandIconComponent(lucide)
  if (url && !failed) {
    return (
      <span className={chipClass}>
        <img src={url} alt="" className="h-full w-full object-contain" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </span>
    )
  }
  if (Icon) {
    return (
      <span className={chipClass}>
        <Icon size={size} style={{ color: color || undefined }} />
      </span>
    )
  }
  return null
}
