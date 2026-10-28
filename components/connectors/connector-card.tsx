"use client"

import {
  MessageSquare, Mail, Sparkles, Brain, CreditCard, Phone,
  Cloud, HardDrive, Users, Plug, CloudCog, FolderOpen,
  Container, Database, Snowflake, Leaf, UserCircle, Globe,
  Archive, Ticket, Inbox, FileText, CheckSquare, PenTool, Cog, ServerCog,
  Workflow, Layers, Briefcase,
} from "lucide-react"
import { ConnectorLogo } from "./connector-logo"
import { getConnectorLogoSource } from "@/lib/connectors/logo-sources"

const iconMap: Record<string, any> = {
  MessageSquare, Mail, Sparkles, Brain, CreditCard, Phone,
  Cloud, HardDrive, Users, Plug, CloudCog, FolderOpen,
  Container, Database, Snowflake, Leaf, UserCircle, Globe,
  Archive, Ticket, Inbox, FileText, CheckSquare, PenTool, Cog, ServerCog,
  Workflow, Layers, Briefcase,
}

interface ConnectorCardProps {
  name: string
  description: string
  connectorKey: string
  icon: string
  color: string
  category: string
  isEnabled: boolean
  status?: 'connected' | 'untested' | 'error' | null
  onClick: () => void
}

export function ConnectorCard({ name, description, connectorKey, icon, color, category, isEnabled, status, onClick }: ConnectorCardProps) {
  const Icon = iconMap[icon] ?? Plug
  const logoSource = getConnectorLogoSource(connectorKey)

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border p-4 transition-all hover:shadow-md group"
      style={{
        backgroundColor: 'var(--theme-card-bg)',
        borderColor: isEnabled ? color + '40' : 'var(--theme-surface-border)',
      }}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: logoSource ? '#ffffff' : color + '15' }}
        >
          {logoSource ? (
            <ConnectorLogo
              connectorName={name}
              color={color}
              initials={name.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()}
              logoSource={logoSource}
              imageClassName="h-6 w-6"
              fallbackClassName="text-xs"
            />
          ) : (
            <Icon size={20} style={{ color }} />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--theme-card-text)' }}>
              {name}
            </span>
            {isEnabled && status && (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{
                  backgroundColor:
                    status === 'connected' ? 'var(--theme-success)' :
                    status === 'error' ? 'var(--theme-danger)' :
                    'var(--theme-warning)',
                }}
                title={status === 'connected' ? 'Connected' : status === 'error' ? 'Error' : 'Not tested'}
              />
            )}
          </div>
          <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: 'var(--theme-muted-text)' }}>
            {description}
          </p>
        </div>

        {/* Status badge */}
        <div className="shrink-0">
          {isEnabled ? (
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: color + '15', color }}
            >
              Active
            </span>
          ) : (
            <span
              className="text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}
            >
              {category}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
