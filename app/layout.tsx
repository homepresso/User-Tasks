import type { Metadata, Viewport } from "next"
import { DM_Sans, Space_Mono, Fraunces } from "next/font/google"
import Script from "next/script"
import { QueryProvider } from "@/components/providers/query-provider"
import { publicBaseUrl } from "@/lib/deployment"
import { buildPublicConfig, isBuildPrerender, PUBLIC_CONFIG_PATH, publicConfigScript } from "@/lib/config/public"
import "./globals.css"

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
})

const spaceMono = Space_Mono({
  weight: ["400"],
  subsets: ["latin"],
  variable: "--font-mono",
})

// Editorial display serif — page titles in the brand themes match the
// marketing site's headline face.
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
})

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export const metadata: Metadata = {
  // Absolute base for Open Graph/Twitter image URLs in link previews.
  metadataBase: new URL(publicBaseUrl()),
  title: "UserTasks — Open-Source Headless Workflow Engine",
  description: "An open-source headless workflow engine: visual designer, integrations, human tasks, decision tables, optional AI agents, and reports — all driven by an API, an MCP server and a CLI, with governance and log export built in.",
  openGraph: {
    title: "UserTasks — Open-Source Headless Workflow Engine",
    description: "Workflows, integrations, human tasks, decision tables, and reports you drive through an API and MCP server. Self-host it or use the cloud edition.",
    siteName: "UserTasks",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "UserTasks — Open-Source Headless Workflow Engine",
    description: "Workflows, human tasks, and decision tables you drive through an API and MCP.",
  },
  // Icons come from the app/icon.svg + app/apple-icon.png file conventions
  // (public/favicon.ico covers clients that request it directly). Setting
  // `icons` here would replace them; the dashboard layout sets it only for a
  // workspace theme's custom favicon.
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? { google: process.env.GOOGLE_SITE_VERIFICATION }
    : undefined,
}

// Theme bootstrap — restores the last workspace theme's colours from
// sessionStorage BEFORE React hydrates (the dashboard layout server-renders the
// authoritative theme CSS; this keeps pages outside it from flashing). React 19 warns about raw
// <script> tags inside component trees, so we use next/script with strategy
// "beforeInteractive" which Next.js injects into the initial HTML stream before
// any hydration. Requires an `id` per Next's inline-script rules. Signed-out
// pages (login, signup, invite, OAuth consent…) skip the cache and stay on the
// light default: a cached dark workspace theme turned their text light-on-light.
const THEME_BOOTSTRAP = `try{if(/^\\/(login|signup|forgot-password|reset-password|check-email|invite|oauth|auth)(\\/|$)/.test(location.pathname))throw 0;var c=sessionStorage.getItem('theme_css_cache');if(c){var v=JSON.parse(c),r=document.documentElement;for(var k in v)r.style.setProperty(k,v[k])}var t=sessionStorage.getItem('theme_id')||'basecamp';document.documentElement.setAttribute('data-theme',t);document.documentElement.setAttribute('data-theme-mode',sessionStorage.getItem('theme_mode')||'light');document.documentElement.setAttribute('data-theme-headings',sessionStorage.getItem('theme_headings')||'display')}catch(e){document.documentElement.setAttribute('data-theme','basecamp');document.documentElement.setAttribute('data-theme-mode','light');document.documentElement.setAttribute('data-theme-headings','display')}`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Runtime public config (Supabase URL/anon key, SSO flags) for the browser
  // data client — replaces build-time NEXT_PUBLIC_* values. Pages prerendered
  // at build time inline the build's values and refresh them from
  // /api/config/public in the background; one prerendered without them (a
  // Docker image built with no Supabase args) loads that object before
  // hydration instead.
  const publicConfig = buildPublicConfig()
  return (
    <html lang="en" className={`${dmSans.variable} ${spaceMono.variable} ${fraunces.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <Script
          id="theme-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }}
        />
        {publicConfig.supabaseUrl ? (
          <Script
            id="public-config"
            strategy="beforeInteractive"
            dangerouslySetInnerHTML={{ __html: publicConfigScript(publicConfig, { refresh: isBuildPrerender() }) }}
          />
        ) : (
          <Script id="public-config" strategy="beforeInteractive" src={`${PUBLIC_CONFIG_PATH}?format=js`} />
        )}
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  )
}
