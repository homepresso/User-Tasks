"use client";

import { useEffect, useState } from "react";
import { ProfileForm } from "./profile-form";
import { OrgList } from "./org-list";
import { PreferencesForm } from "./preferences-form";
import { THEME_DESIGNER_HREF, WorkspaceThemeCard } from "./workspace-theme-card";
import { LogoUpload } from "./logo-upload";
import Link from "next/link";
import {
  User,
  Palette,
  Building2,
  SlidersHorizontal,
  Shield,
  UserPlus,
  ChevronRight,
  Key,
  KeyRound,
  Globe,
  Plug,
  ScrollText,
  LayoutDashboard,
  GitBranch,
  Boxes,
  Radio,
  Brush,
  Server,
  Package,
  UsersRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/permissions-context";
import type { Permission } from "@/lib/permissions";
import { canViewInfrastructureAction } from "@/app/actions/infrastructure";

interface SettingsTabsProps {
  profile: any;
  tenantId: string;
  logoUrl: string | null;
}

const TABS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "organizations", label: "Organizations", icon: Building2 },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
];

type AdminLinkConfig = {
  href: string;
  icon: any;
  label: string;
  requiredPermission?: Permission;
  anyPermission?: Permission[];
  /** Shown to every member (the page itself is read-only without edit rights). */
  everyone?: boolean;
  /** Instance admins only (INSTANCE_ADMIN_EMAILS), whatever their workspace role. */
  instanceAdmin?: boolean;
};

const ADMIN_LINKS: AdminLinkConfig[] = [
  {
    href: THEME_DESIGNER_HREF,
    icon: Brush,
    label: "Theme",
    everyone: true,
  },
    {
    href: "/settings/governance",
    icon: Shield,
    label: "Governance",
    requiredPermission: "team.change_roles",
  },
  {
    href: "/settings/invitations",
    icon: UserPlus,
    label: "Invite Users",
    requiredPermission: "team.invite",
  },
  {
    href: "/settings/api-keys",
    icon: Key,
    label: "API Keys",
    requiredPermission: "settings.manage_api_keys",
  },
  {
    href: "/settings/oauth-apps",
    icon: Boxes,
    label: "OAuth Apps",
    requiredPermission: "settings.manage_api_keys",
  },
  {
    href: "/settings/webhooks",
    icon: Globe,
    label: "Webhooks",
    requiredPermission: "settings.manage_webhooks",
  },
  {
    href: "/settings/packages",
    icon: Package,
    label: "Packages",
    requiredPermission: "packages.view",
  },
  {
    href: "/settings/github-sync",
    icon: GitBranch,
    label: "GitHub Sync",
    requiredPermission: "settings.view",
  },
  {
    href: "/settings/sso",
    icon: KeyRound,
    label: "SSO & Directory",
    requiredPermission: "settings.view",
  },
  {
    href: "/settings/mcp",
    icon: Plug,
    label: "MCP Servers",
    requiredPermission: "settings.view",
  },
  {
    href: "/settings/logs",
    icon: ScrollText,
    label: "Live Logs",
    requiredPermission: "settings.view",
  },
  {
    href: "/settings/log-export",
    icon: Radio,
    label: "Log Export",
    requiredPermission: "observability.view",
  },
  {
    href: "/settings/infrastructure",
    icon: Server,
    label: "Infrastructure",
    instanceAdmin: true,
  },
  {
    href: "/settings/gallery-review",
    icon: UsersRound,
    label: "Gallery review",
    instanceAdmin: true,
  },
];

export function SettingsTabs({
  profile,
  tenantId,
  logoUrl,
}: SettingsTabsProps) {
  const [activeTab, setActiveTab] = useState("profile");
  const { can } = usePermissions();
  const [instanceAdmin, setInstanceAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    canViewInfrastructureAction().then((ok) => { if (active) setInstanceAdmin(ok); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const visibleAdminLinks = ADMIN_LINKS.filter((link) => {
    if (link.instanceAdmin) return instanceAdmin;
    if (link.everyone) return true;
    const anyPermission =
      "anyPermission" in link ? link.anyPermission : undefined;
    return anyPermission
      ? anyPermission.some((permission) => can(permission))
      : Boolean(link.requiredPermission && can(link.requiredPermission));
  });

  return (
    <div className="flex max-md:flex-col gap-6">
      {/* Sidebar tabs */}
      <div className="md:w-48 md:shrink-0">
        <nav className="max-md:flex max-md:gap-1 max-md:overflow-x-auto max-md:pb-2 md:space-y-1 md:sticky md:top-6">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-sm font-medium transition-all text-left",
                )}
                style={{
                  backgroundColor: isActive
                    ? "var(--theme-primary-light)"
                    : "transparent",
                  color: isActive
                    ? "var(--theme-primary-text)"
                    : "var(--theme-muted-text)",
                }}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}

          {/* Admin page links */}
          {visibleAdminLinks.length > 0 && (
            <>
              <div
                className="my-2 border-t"
                style={{ borderColor: "var(--theme-surface-border)" }}
              />
              {visibleAdminLinks.map((link) => {
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-sm font-medium transition-all text-left hover:opacity-80"
                    style={{ color: "var(--theme-muted-text)" }}
                  >
                    <Icon size={16} />
                    {link.label}
                    <ChevronRight size={12} className="ml-auto" />
                  </Link>
                );
              })}
            </>
          )}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-6">
        {/* ─── Profile ─── */}
        {activeTab === "profile" && (
          <Section
            title="Profile"
            description="Manage your personal information"
          >
            <ProfileForm profile={profile} />
          </Section>
        )}

        {/* ─── Appearance ─── */}
        {activeTab === "appearance" && (
          <>
            <Section
              title="Workspace Logo"
              description="Upload a custom logo for the sidebar"
            >
              <LogoUpload tenantId={tenantId} currentLogoUrl={logoUrl} readOnly={!can("settings.edit")} />
            </Section>

            <Section
              title="Workspace theme"
              description="The brand theme everyone in this workspace sees"
            >
              <WorkspaceThemeCard />
            </Section>
          </>
        )}

        {/* ─── Organizations ─── */}
        {activeTab === "organizations" && (
          <Section
            title="Organizations"
            description="Your workspace memberships"
          >
            <OrgList />
          </Section>
        )}

        {/* ─── Preferences ─── */}
        {activeTab === "preferences" && (
          <Section title="Preferences" description="Customize your experience">
            <PreferencesForm
              userId={profile.id}
              preferences={(profile.preferences as any) ?? {}}
            />
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl border p-6"
      style={{
        backgroundColor: "var(--theme-card-bg)",
        borderColor: "var(--theme-surface-border)",
      }}
    >
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p
          className="text-xs mt-0.5"
          style={{ color: "var(--theme-muted-text)" }}
        >
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}
