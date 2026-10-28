export interface ThemeComponents {
  borderRadius: string      // e.g. '8px', '12px', '16px', '9999px'
  cardShadow: string        // e.g. 'none', 'sm', 'md', 'lg'
  buttonRadius: string      // e.g. '6px', '8px', '9999px'
  fontSize: string          // e.g. 'sm', 'base', 'lg'
  sidebarWidth: string      // e.g. '240px', '280px'
  inputRadius: string       // e.g. '6px', '8px', '9999px'
}

export const DEFAULT_COMPONENTS: ThemeComponents = {
  borderRadius: '12px',
  cardShadow: 'sm',
  buttonRadius: '8px',
  fontSize: 'base',
  sidebarWidth: '256px',
  inputRadius: '8px',
}

export interface Theme {
  id: string
  name: string
  description: string
  /** Explicit light/dark classification; when omitted it is derived from surface luminance. */
  mode?: 'light' | 'dark'
  colors: {
    primary: string
    primaryHover: string
    primaryLight: string
    accent: string
    accentLight: string
    sidebar: string
    sidebarText: string
    sidebarActive: string
    sidebarBorder: string
    topbar: string
    topbarText: string
    surface: string
    surfaceBorder: string
    cardBg: string
    cardText: string
    mutedText: string
    success: string
    warning: string
    danger: string
  }
  components?: Partial<ThemeComponents>
  dark?: {
    primary?: string
    primaryHover?: string
    accent?: string
    sidebar: string
    sidebarText: string
    sidebarActive: string
    sidebarBorder: string
    topbar: string
    topbarText: string
    surface: string
    surfaceBorder: string
    cardBg: string
    cardText: string
    mutedText: string
    primaryLight?: string
    success?: string
    warning?: string
    danger?: string
  }
}

export const THEMES: Theme[] = [
  // ─── Gallery — monochrome enterprise default: warm white, ink black, camel accents ───
  // Brand trio (Gallery / Atelier / Noir): black · tan · white.
  {
    id: "basecamp",
    name: "Gallery",
    description: "Warm white canvas, ink-black actions and sidebar, camel accents — striking and professional",
    colors: {
      primary: "#17150F",
      primaryHover: "#2E2A24",
      primaryLight: "rgba(23,21,15,0.08)",
      accent: "#B08A54",
      accentLight: "rgba(176,138,84,0.14)",
      sidebar: "#161411",
      sidebarText: "#E9E4D8",
      sidebarActive: "rgba(176,138,84,0.22)",
      sidebarBorder: "rgba(243,239,231,0.10)",
      topbar: "#FFFFFF",
      topbarText: "#1B1916",
      surface: "#FAF8F3",
      surfaceBorder: "#E6E1D5",
      cardBg: "#FFFFFF",
      cardText: "#1B1916",
      mutedText: "#6E6759",
      success: "#4F7A5B",
      warning: "#A6721C",
      danger: "#B23A2E",
    },
  },

  // ─── Atelier — tan-forward light: camel primary on warm stone surfaces ───
  {
    id: "trailside",
    name: "Atelier",
    description: "Camel and stone on warm paper — tailored, quiet luxury for long working sessions",
    colors: {
      primary: "#977443",
      primaryHover: "#7E6138",
      primaryLight: "rgba(176,138,84,0.16)",
      accent: "#17150F",
      accentLight: "rgba(23,21,15,0.08)",
      sidebar: "#2B261F",
      sidebarText: "#E9E0CE",
      sidebarActive: "rgba(176,138,84,0.26)",
      sidebarBorder: "rgba(233,224,206,0.12)",
      topbar: "#F5F0E6",
      topbarText: "#1B1916",
      surface: "#F3EDE2",
      surfaceBorder: "#E0D7C4",
      cardBg: "#FCFAF5",
      cardText: "#1B1916",
      mutedText: "#78705F",
      success: "#4F7A5B",
      warning: "#A6721C",
      danger: "#B23A2E",
    },
  },

  // ─── Noir — near-black night mode with warm white type and camel wayfinding ───
  {
    id: "night-drive",
    name: "Noir",
    description: "Near-black surfaces, warm white type, camel accents — the executive dark mode",
    colors: {
      primary: "#C7A575",
      primaryHover: "#B08A54",
      primaryLight: "rgba(199,165,117,0.16)",
      accent: "#8C857A",
      accentLight: "rgba(140,133,122,0.18)",
      sidebar: "#121110",
      sidebarText: "#D9D2C2",
      sidebarActive: "rgba(199,165,117,0.20)",
      sidebarBorder: "rgba(243,239,231,0.08)",
      topbar: "#121110",
      topbarText: "#F2EFE7",
      surface: "#171512",
      surfaceBorder: "rgba(243,239,231,0.10)",
      cardBg: "#1F1C18",
      cardText: "#F2EFE7",
      mutedText: "#A29A89",
      success: "#7FA98A",
      warning: "#D9A441",
      danger: "#D07A6A",
    },
  },

  // ─── Midnight Teal — the default, premium navy+teal matching the login screen ───
  {
    id: "default",
    name: "Midnight Teal",
    description: "Premium dark navy sidebar with teal accents, matching the login experience",
    colors: {
      // Teal family — darkened a step so primary text/icons stay readable on
      // the light canvas (bright #14B8A6 was 2.5:1 on white)
      primary: "#0D9488",
      primaryHover: "#0F766E",
      primaryLight: "rgba(20,184,166,0.12)",
      accent: "rgba(20,184,166,0.14)",
      accentLight: "rgba(13,148,136,0.15)",
      // Sidebar — dark navy (gradient layered on via .premium-sidebar class in globals.css)
      sidebar: "#0F172A",
      sidebarText: "#CBD5E1",
      sidebarActive: "rgba(20,184,166,0.12)",
      sidebarBorder: "rgba(255,255,255,0.06)",
      // Topbar — stays white/refined (matches login right panel)
      topbar: "#FFFFFF",
      topbarText: "#1E293B",
      // Content area — light, matches login right panel
      surface: "#FAFAFA",
      surfaceBorder: "#E5E7EB",
      cardBg: "#FFFFFF",
      cardText: "#1E293B",
      // Darkened from #64748B (~4.6:1) → #475569 (~7.4:1) so small muted text
      // (topbar date, secondary labels, placeholders) stays clearly legible on
      // the white topbar and light surface.
      mutedText: "#475569",
      success: "#047857",
      warning: "#B45309",
      danger: "#DC2626",
    },
  },

  // ─── Nebula Teal — fully dark (sidebar + main) with all Midnight animations ───
  {
    id: "nebula",
    name: "Nebula Teal",
    description: "Fully dark experience — Midnight sidebar with a deep navy main screen and all floating illustrations",
    colors: {
      primary: "#14B8A6",
      primaryHover: "#0D9488",
      primaryLight: "rgba(20,184,166,0.14)",
      accent: "rgba(20,184,166,0.14)",
      accentLight: "rgba(13,148,136,0.15)",
      sidebar: "#0F172A",
      sidebarText: "#CBD5E1",
      sidebarActive: "rgba(20,184,166,0.14)",
      sidebarBorder: "rgba(255,255,255,0.06)",
      topbar: "#0F172A",
      topbarText: "#F1F5F9",
      surface: "#0F172A",
      surfaceBorder: "rgba(255,255,255,0.08)",
      cardBg: "#1E293B",
      cardText: "#F1F5F9",
      mutedText: "#94A3B8",
      success: "#22C55E",
      warning: "#FBBF24",
      danger: "#F87171",
    },
  },

  // ─── Aurora Teal — daylight variant of Midnight: light sidebar + light main ───
  {
    id: "aurora",
    name: "Aurora Teal",
    description: "Daylight counterpart to Midnight — light sidebar with floating illustrations, light main screen",
    colors: {
      primary: "#0D9488",
      primaryHover: "#0F766E",
      primaryLight: "rgba(13,148,136,0.10)",
      accent: "#0F766E",
      accentLight: "rgba(15,118,110,0.12)",
      sidebar: "#FFFFFF",
      sidebarText: "#1E293B",
      sidebarActive: "rgba(13,148,136,0.12)",
      sidebarBorder: "#E5E7EB",
      topbar: "#FFFFFF",
      topbarText: "#0F172A",
      surface: "#FAFAFA",
      surfaceBorder: "#E5E7EB",
      cardBg: "#FFFFFF",
      cardText: "#0F172A",
      mutedText: "#475569",
      success: "#059669",
      warning: "#D97706",
      danger: "#DC2626",
    },
  },

  // ─── Dawn Teal — Midnight sidebar + Aurora-tinted light main ───
  {
    id: "dawn",
    name: "Dawn Teal",
    description: "Dark Midnight sidebar with illustrations, teal-tinted light main screen — inverse of Eclipse",
    colors: {
      primary: "#0D9488",
      primaryHover: "#0F766E",
      primaryLight: "rgba(20,184,166,0.12)",
      accent: "#0D9488",
      accentLight: "rgba(13,148,136,0.15)",
      sidebar: "#0F172A",
      sidebarText: "#CBD5E1",
      sidebarActive: "rgba(20,184,166,0.12)",
      sidebarBorder: "rgba(255,255,255,0.06)",
      topbar: "#FFFFFF",
      topbarText: "#1E293B",
      surface: "#F0FDFA",
      surfaceBorder: "#CCFBF1",
      cardBg: "#FFFFFF",
      cardText: "#0F172A",
      mutedText: "#475569",
      success: "#059669",
      warning: "#D97706",
      danger: "#DC2626",
    },
  },

  // ─── Eclipse Teal — inverse variant: light sidebar + dark main ───
  {
    id: "eclipse",
    name: "Eclipse Teal",
    description: "Inverted — light sidebar with illustrations, deep navy main screen for focus",
    colors: {
      primary: "#14B8A6",
      primaryHover: "#0D9488",
      primaryLight: "rgba(20,184,166,0.15)",
      accent: "#0D9488",
      accentLight: "rgba(13,148,136,0.15)",
      sidebar: "#FFFFFF",
      sidebarText: "#475569",
      sidebarActive: "rgba(13,148,136,0.12)",
      sidebarBorder: "#E5E7EB",
      topbar: "#0F172A",
      topbarText: "#F1F5F9",
      surface: "#0F172A",
      surfaceBorder: "rgba(255,255,255,0.08)",
      cardBg: "#1E293B",
      cardText: "#F1F5F9",
      mutedText: "#94A3B8",
      success: "#22C55E",
      warning: "#FBBF24",
      danger: "#F87171",
    },
  },

  // ─── Studio — pure white everything, ultra-minimal ───
  {
    id: "studio",
    name: "Studio",
    description: "Pure white with clean lines — always light",
    colors: {
      primary: "#64748B",
      primaryHover: "#475569",
      primaryLight: "#F1F5F9",
      accent: "#334155",
      accentLight: "#E2E8F0",
      sidebar: "#FFFFFF",
      sidebarText: "#475569",
      sidebarActive: "#F1F5F9",
      sidebarBorder: "#F1F5F9",
      topbar: "#FFFFFF",
      topbarText: "#111827",
      surface: "#FFFFFF",
      surfaceBorder: "#E5E7EB",
      cardBg: "#FFFFFF",
      cardText: "#111827",
      mutedText: "#6B7280",
      success: "#059669",
      warning: "#D97706",
      danger: "#DC2626",
    },
    // No dark overrides — stays light regardless of OS dark mode
  },

  // ─── Snowfall — crisp white with blue, fixed blue-on-blue ───
  {
    id: "snowfall",
    name: "Snowfall",
    description: "Crisp white with cool blue accents",
    colors: {
      primary: "#2563EB",
      primaryHover: "#1D4ED8",
      primaryLight: "#DBEAFE",
      accent: "#1E40AF",
      accentLight: "#C7D2FE",
      sidebar: "#FFFFFF",
      sidebarText: "#64748B",
      sidebarActive: "#DBEAFE",
      sidebarBorder: "#E8ECF0",
      topbar: "#FFFFFF",
      topbarText: "#0F172A",
      surface: "#FEFEFF",
      surfaceBorder: "#DDE4ED",
      cardBg: "#FFFFFF",
      cardText: "#0F172A",
      mutedText: "#64748B",
      success: "#059669",
      warning: "#D97706",
      danger: "#DC2626",
    },
  },

  // ─── Midnight Blue — dark navy sidebar with blue accents, fixed ───
  {
    id: "midnight",
    name: "Midnight Blue",
    description: "Dark navy sidebar with vibrant blue accents",
    colors: {
      primary: "#2563EB",
      primaryHover: "#1D4ED8",
      primaryLight: "#DBEAFE",
      accent: "#1E40AF",
      accentLight: "#C7D2FE",
      sidebar: "#0F172A",
      sidebarText: "#94A3B8",
      sidebarActive: "#1E3A5F",
      sidebarBorder: "#1E293B",
      topbar: "#FFFFFF",
      topbarText: "#0F172A",
      surface: "#F8FAFC",
      surfaceBorder: "#DDE4ED",
      cardBg: "#FFFFFF",
      cardText: "#0F172A",
      mutedText: "#64748B",
      success: "#059669",
      warning: "#D97706",
      danger: "#DC2626",
    },
    dark: {
      primary: "#60A5FA",
      primaryHover: "#3B82F6",
      sidebar: "#020617",
      sidebarText: "#94A3B8",
      sidebarActive: "#0F172A",
      sidebarBorder: "#0F172A",
      topbar: "#020617",
      topbarText: "#E2E8F0",
      surface: "#020617",
      surfaceBorder: "#1E293B",
      cardBg: "#1E293B",
      cardText: "#E2E8F0",
      mutedText: "#94A3B8",
    },
  },

  // ─── Ember — warm orange and charcoal, with floating workflow illustrations ───
  {
    id: "ember",
    name: "Ember",
    description: "Warm orange and charcoal with floating workflow illustrations — bold and energetic",
    colors: {
      primary: "#EA580C",
      primaryHover: "#C2410C",
      primaryLight: "rgba(249,115,22,0.14)",
      accent: "#EA580C",
      accentLight: "rgba(234,88,12,0.15)",
      sidebar: "#1C1917",
      sidebarText: "#D6D3D1",
      sidebarActive: "rgba(249,115,22,0.14)",
      sidebarBorder: "rgba(255,255,255,0.06)",
      topbar: "#FFFFFF",
      topbarText: "#1C1917",
      surface: "#FAFAF9",
      surfaceBorder: "#E7E5E4",
      cardBg: "#FFFFFF",
      cardText: "#1C1917",
      mutedText: "#78716C",
      success: "#16A34A",
      warning: "#A16207",
      danger: "#DC2626",
    },
  },

  // ─── Ember Minimal — same warm colors, no sidebar illustrations ───
  {
    id: "ember-minimal",
    name: "Ember Minimal",
    description: "Clean Ember without the floating illustrations — pure warm charcoal sidebar",
    colors: {
      primary: "#EA580C",
      primaryHover: "#C2410C",
      primaryLight: "rgba(249,115,22,0.14)",
      accent: "#EA580C",
      accentLight: "rgba(234,88,12,0.15)",
      sidebar: "#1C1917",
      sidebarText: "#D6D3D1",
      sidebarActive: "rgba(249,115,22,0.14)",
      sidebarBorder: "#292524",
      topbar: "#FFFFFF",
      topbarText: "#1C1917",
      surface: "#FAFAF9",
      surfaceBorder: "#E7E5E4",
      cardBg: "#FFFFFF",
      cardText: "#1C1917",
      mutedText: "#78716C",
      success: "#16A34A",
      warning: "#A16207",
      danger: "#DC2626",
    },
  },

  // ─── Ember Dawn — reverse of Ember: light sidebar + dark charcoal main ───
  {
    id: "ember-dawn",
    name: "Ember Dawn",
    description: "Inverted Ember — light sidebar with orange illustrations, deep charcoal main screen",
    colors: {
      primary: "#F97316",
      primaryHover: "#EA580C",
      primaryLight: "rgba(249,115,22,0.15)",
      accent: "#EA580C",
      accentLight: "rgba(234,88,12,0.15)",
      sidebar: "#FFFFFF",
      sidebarText: "#1C1917",
      sidebarActive: "rgba(234,88,12,0.12)",
      sidebarBorder: "#E7E5E4",
      topbar: "#1C1917",
      topbarText: "#FAFAF9",
      surface: "#1C1917",
      surfaceBorder: "rgba(255,255,255,0.08)",
      cardBg: "#292524",
      cardText: "#FAFAF9",
      mutedText: "#A8A29E",
      success: "#22C55E",
      warning: "#FBBF24",
      danger: "#F87171",
    },
  },

  // ─── Sage — deep emerald and warm stone, grounded and calm ───
  {
    id: "sage",
    name: "Sage",
    description: "Deep emerald and warm stone — grounded, calm, and confident",
    colors: {
      primary: "#059669",
      primaryHover: "#047857",
      primaryLight: "rgba(5,150,105,0.12)",
      accent: "#047857",
      accentLight: "rgba(4,120,87,0.15)",
      sidebar: "#0F1B17",
      sidebarText: "#D1D5DB",
      sidebarActive: "rgba(5,150,105,0.18)",
      sidebarBorder: "rgba(255,255,255,0.06)",
      topbar: "#FFFFFF",
      topbarText: "#0F1B17",
      surface: "#F8FAF9",
      surfaceBorder: "#E4E7E4",
      cardBg: "#FFFFFF",
      cardText: "#0F1B17",
      mutedText: "#6B7570",
      success: "#16A34A",
      warning: "#A16207",
      danger: "#DC2626",
    },
  },

  // ─── Sage Minimal — same emerald palette, clean sidebar, no illustrations ───
  {
    id: "sage-minimal",
    name: "Sage Minimal",
    description: "Clean Sage without the floating illustrations — pure emerald and stone",
    colors: {
      primary: "#059669",
      primaryHover: "#047857",
      primaryLight: "rgba(5,150,105,0.12)",
      accent: "#047857",
      accentLight: "rgba(4,120,87,0.15)",
      sidebar: "#0F1B17",
      sidebarText: "#D1D5DB",
      sidebarActive: "rgba(5,150,105,0.18)",
      sidebarBorder: "#1C2A24",
      topbar: "#FFFFFF",
      topbarText: "#0F1B17",
      surface: "#F8FAF9",
      surfaceBorder: "#E4E7E4",
      cardBg: "#FFFFFF",
      cardText: "#0F1B17",
      mutedText: "#6B7570",
      success: "#16A34A",
      warning: "#A16207",
      danger: "#DC2626",
    },
  },

  // ─── Sage Dawn — inverted Sage: light sidebar, deep forest main canvas ───
  {
    id: "sage-dawn",
    name: "Sage Dawn",
    description: "Inverted Sage — light sidebar with emerald illustrations, deep forest main screen",
    colors: {
      primary: "#10B981",
      primaryHover: "#059669",
      primaryLight: "rgba(16,185,129,0.18)",
      accent: "#047857",
      accentLight: "rgba(4,120,87,0.15)",
      sidebar: "#FFFFFF",
      sidebarText: "#0F1B17",
      sidebarActive: "rgba(5,150,105,0.12)",
      sidebarBorder: "#E4E7E4",
      topbar: "#0F1B17",
      topbarText: "#F8FAF9",
      surface: "#0F1B17",
      surfaceBorder: "rgba(255,255,255,0.08)",
      cardBg: "#1A2A23",
      cardText: "#F8FAF9",
      mutedText: "#9CA8A1",
      success: "#22C55E",
      warning: "#FBBF24",
      danger: "#F87171",
    },
  },

  // ─── Lagoon — vibrant teal and deep navy, fresh and clinical ───
  {
    id: "lagoon",
    name: "Lagoon",
    description: "Vibrant teal and deep navy — fresh, clinical, and precise",
    colors: {
      primary: "#0D9488",
      primaryHover: "#0F766E",
      primaryLight: "rgba(13,148,136,0.12)",
      accent: "#0F766E",
      accentLight: "rgba(15,118,110,0.15)",
      sidebar: "#0B1724",
      sidebarText: "#CBD5E1",
      sidebarActive: "rgba(13,148,136,0.18)",
      sidebarBorder: "rgba(255,255,255,0.06)",
      topbar: "#FFFFFF",
      topbarText: "#0B1724",
      surface: "#F6FAFA",
      surfaceBorder: "#E2E8E8",
      cardBg: "#FFFFFF",
      cardText: "#0B1724",
      mutedText: "#64748B",
      success: "#16A34A",
      warning: "#A16207",
      danger: "#DC2626",
    },
  },

  // ─── Lagoon Minimal — clean teal without the floating illustrations ───
  {
    id: "lagoon-minimal",
    name: "Lagoon Minimal",
    description: "Clean Lagoon without the floating illustrations — pure teal and navy",
    colors: {
      primary: "#0D9488",
      primaryHover: "#0F766E",
      primaryLight: "rgba(13,148,136,0.12)",
      accent: "#0F766E",
      accentLight: "rgba(15,118,110,0.15)",
      sidebar: "#0B1724",
      sidebarText: "#CBD5E1",
      sidebarActive: "rgba(13,148,136,0.18)",
      sidebarBorder: "#1E293B",
      topbar: "#FFFFFF",
      topbarText: "#0B1724",
      surface: "#F6FAFA",
      surfaceBorder: "#E2E8E8",
      cardBg: "#FFFFFF",
      cardText: "#0B1724",
      mutedText: "#64748B",
      success: "#16A34A",
      warning: "#A16207",
      danger: "#DC2626",
    },
  },

  // ─── Lagoon Dawn — inverted Lagoon: light sidebar, deep navy canvas ───
  {
    id: "lagoon-dawn",
    name: "Lagoon Dawn",
    description: "Inverted Lagoon — light sidebar with teal illustrations, deep navy main screen",
    colors: {
      primary: "#14B8A6",
      primaryHover: "#0D9488",
      primaryLight: "rgba(20,184,166,0.18)",
      accent: "#0F766E",
      accentLight: "rgba(15,118,110,0.15)",
      sidebar: "#FFFFFF",
      sidebarText: "#0B1724",
      sidebarActive: "rgba(13,148,136,0.12)",
      sidebarBorder: "#E2E8E8",
      topbar: "#0B1724",
      topbarText: "#F6FAFA",
      surface: "#0B1724",
      surfaceBorder: "rgba(255,255,255,0.08)",
      cardBg: "#152233",
      cardText: "#F6FAFA",
      mutedText: "#94A3B8",
      success: "#22C55E",
      warning: "#FBBF24",
      danger: "#F87171",
    },
  },

  // ─── Silver — cool slate and graphite, metallic and professional ───
  {
    id: "silver",
    name: "Silver",
    description: "Cool slate and graphite — metallic, professional, and understated",
    colors: {
      primary: "#475569",
      primaryHover: "#334155",
      primaryLight: "rgba(71,85,105,0.12)",
      accent: "#334155",
      accentLight: "rgba(51,65,85,0.15)",
      sidebar: "#1E293B",
      sidebarText: "#CBD5E1",
      sidebarActive: "rgba(148,163,184,0.18)",
      sidebarBorder: "rgba(255,255,255,0.06)",
      topbar: "#FFFFFF",
      topbarText: "#1E293B",
      surface: "#F8FAFC",
      surfaceBorder: "#E2E8F0",
      cardBg: "#FFFFFF",
      cardText: "#0F172A",
      mutedText: "#64748B",
      success: "#16A34A",
      warning: "#A16207",
      danger: "#DC2626",
    },
  },

  // ─── Silver Minimal — same metallic palette, clean sidebar, no illustrations ───
  {
    id: "silver-minimal",
    name: "Silver Minimal",
    description: "Clean Silver without the floating illustrations — pure slate and graphite",
    colors: {
      primary: "#475569",
      primaryHover: "#334155",
      primaryLight: "rgba(71,85,105,0.12)",
      accent: "#334155",
      accentLight: "rgba(51,65,85,0.15)",
      sidebar: "#1E293B",
      sidebarText: "#CBD5E1",
      sidebarActive: "rgba(148,163,184,0.18)",
      sidebarBorder: "#334155",
      topbar: "#FFFFFF",
      topbarText: "#1E293B",
      surface: "#F8FAFC",
      surfaceBorder: "#E2E8F0",
      cardBg: "#FFFFFF",
      cardText: "#0F172A",
      mutedText: "#64748B",
      success: "#16A34A",
      warning: "#A16207",
      danger: "#DC2626",
    },
  },

  // ─── Silver Dawn — inverted Silver: light silver sidebar, graphite main canvas ───
  {
    id: "silver-dawn",
    name: "Silver Dawn",
    description: "Inverted Silver — light silver sidebar with graphite illustrations, deep slate main screen",
    colors: {
      primary: "#94A3B8",
      primaryHover: "#64748B",
      primaryLight: "rgba(148,163,184,0.18)",
      accent: "#64748B",
      accentLight: "rgba(100,116,139,0.15)",
      sidebar: "#FFFFFF",
      sidebarText: "#1E293B",
      sidebarActive: "rgba(71,85,105,0.12)",
      sidebarBorder: "#E2E8F0",
      topbar: "#0F172A",
      topbarText: "#F8FAFC",
      surface: "#0F172A",
      surfaceBorder: "rgba(255,255,255,0.08)",
      cardBg: "#1E293B",
      cardText: "#F8FAFC",
      mutedText: "#94A3B8",
      success: "#22C55E",
      warning: "#FBBF24",
      danger: "#F87171",
    },
  },

  // ─── Onyx — true black and soft grey, high contrast and stark ───
  {
    id: "onyx",
    name: "Onyx",
    description: "True black and soft grey — high contrast, stark, and precise",
    colors: {
      primary: "#374151",
      primaryHover: "#1F2937",
      primaryLight: "rgba(55,65,81,0.12)",
      accent: "#1F2937",
      accentLight: "rgba(31,41,55,0.15)",
      sidebar: "#0A0A0A",
      sidebarText: "#D4D4D8",
      sidebarActive: "rgba(212,212,216,0.14)",
      sidebarBorder: "rgba(255,255,255,0.06)",
      topbar: "#FFFFFF",
      topbarText: "#0A0A0A",
      surface: "#FAFAFA",
      surfaceBorder: "#E4E4E7",
      cardBg: "#FFFFFF",
      cardText: "#0A0A0A",
      mutedText: "#71717A",
      success: "#16A34A",
      warning: "#A16207",
      danger: "#DC2626",
    },
  },

  // ─── Onyx Minimal — same black/grey palette without floating illustrations ───
  {
    id: "onyx-minimal",
    name: "Onyx Minimal",
    description: "Clean Onyx without the floating illustrations — pure black and zinc",
    colors: {
      primary: "#374151",
      primaryHover: "#1F2937",
      primaryLight: "rgba(55,65,81,0.12)",
      accent: "#1F2937",
      accentLight: "rgba(31,41,55,0.15)",
      sidebar: "#0A0A0A",
      sidebarText: "#D4D4D8",
      sidebarActive: "rgba(212,212,216,0.14)",
      sidebarBorder: "#1C1C1F",
      topbar: "#FFFFFF",
      topbarText: "#0A0A0A",
      surface: "#FAFAFA",
      surfaceBorder: "#E4E4E7",
      cardBg: "#FFFFFF",
      cardText: "#0A0A0A",
      mutedText: "#71717A",
      success: "#16A34A",
      warning: "#A16207",
      danger: "#DC2626",
    },
  },

  // ─── Onyx Dawn — inverted Onyx: near-white sidebar + true black canvas ───
  {
    id: "onyx-dawn",
    name: "Onyx Dawn",
    description: "Inverted Onyx — near-white sidebar with black illustrations, true black main screen",
    colors: {
      primary: "#A1A1AA",
      primaryHover: "#71717A",
      primaryLight: "rgba(161,161,170,0.18)",
      accent: "#71717A",
      accentLight: "rgba(113,113,122,0.15)",
      sidebar: "#FAFAFA",
      sidebarText: "#0A0A0A",
      sidebarActive: "rgba(55,65,81,0.10)",
      sidebarBorder: "#E4E4E7",
      topbar: "#0A0A0A",
      topbarText: "#FAFAFA",
      surface: "#0A0A0A",
      surfaceBorder: "rgba(255,255,255,0.08)",
      cardBg: "#18181B",
      cardText: "#FAFAFA",
      mutedText: "#A1A1AA",
      success: "#22C55E",
      warning: "#FBBF24",
      danger: "#F87171",
    },
  },

  // ─── Lavender — calm creative purple ───
  {
    id: "lavender",
    name: "Lavender",
    description: "Soft purple tones — calm and creative",
    colors: {
      primary: "#8B5CF6",
      primaryHover: "#7C3AED",
      primaryLight: "#F5F3FF",
      accent: "#6D28D9",
      accentLight: "#EDE9FE",
      sidebar: "#FFFFFF",
      sidebarText: "#4B5563",
      sidebarActive: "#F5F3FF",
      sidebarBorder: "#E5E7EB",
      topbar: "#FFFFFF",
      topbarText: "#1F2937",
      surface: "#FDFCFE",
      surfaceBorder: "#E5E7EB",
      cardBg: "#FFFFFF",
      cardText: "#1F2937",
      mutedText: "#6B7280",
      success: "#059669",
      warning: "#D97706",
      danger: "#DC2626",
    },
  },

  // ─── Rose Gold — elegant pink, refined ───
  {
    id: "rose",
    name: "Rose Gold",
    description: "Elegant pink and warm gray — refined and modern",
    colors: {
      primary: "#E11D48",
      primaryHover: "#BE123C",
      primaryLight: "#FFF1F2",
      accent: "#9F1239",
      accentLight: "#FFE4E6",
      sidebar: "#FFFFFF",
      sidebarText: "#4B5563",
      sidebarActive: "#FFF1F2",
      sidebarBorder: "#F3F4F6",
      topbar: "#FFFFFF",
      topbarText: "#1F2937",
      surface: "#FEFCFC",
      surfaceBorder: "#E5E7EB",
      cardBg: "#FFFFFF",
      cardText: "#1F2937",
      mutedText: "#6B7280",
      success: "#059669",
      warning: "#D97706",
      danger: "#DC2626",
    },
  },

  // ─── Cloud — sky cyan, fixed from pure blue to cyan-teal ───
  {
    id: "cloud",
    name: "Cloud",
    description: "Airy and light with cyan accents",
    colors: {
      primary: "#0891B2",
      primaryHover: "#0E7490",
      primaryLight: "#ECFEFF",
      accent: "#155E75",
      accentLight: "#CFFAFE",
      sidebar: "#FFFFFF",
      sidebarText: "#64748B",
      sidebarActive: "#ECFEFF",
      sidebarBorder: "#E8ECF0",
      topbar: "#FFFFFF",
      topbarText: "#0F172A",
      surface: "#FAFCFD",
      surfaceBorder: "#DDE4ED",
      cardBg: "#FFFFFF",
      cardText: "#0F172A",
      mutedText: "#64748B",
      success: "#059669",
      warning: "#D97706",
      danger: "#DC2626",
    },
  },

  // ─── Pearl — clean indigo, subtle warm undertones ───
  {
    id: "pearl",
    name: "Pearl",
    description: "Clean white with subtle indigo accents",
    colors: {
      primary: "#6366F1",
      primaryHover: "#4F46E5",
      primaryLight: "#EEF2FF",
      accent: "#4338CA",
      accentLight: "#E0E7FF",
      sidebar: "#FEFEFE",
      sidebarText: "#6B7280",
      sidebarActive: "#EEF2FF",
      sidebarBorder: "#F3F4F6",
      topbar: "#FFFFFF",
      topbarText: "#111827",
      surface: "#FDFCFE",
      surfaceBorder: "#F3F4F6",
      cardBg: "#FFFFFF",
      cardText: "#111827",
      mutedText: "#6B7280",
      success: "#059669",
      warning: "#D97706",
      danger: "#DC2626",
    },
  },

  // ─── Slate — minimal monochrome, distraction-free ───
  {
    id: "slate",
    name: "Slate",
    description: "Minimal and monochrome — distraction-free",
    colors: {
      primary: "#475569",
      primaryHover: "#334155",
      primaryLight: "#F1F5F9",
      accent: "#1E293B",
      accentLight: "#E2E8F0",
      sidebar: "#FFFFFF",
      sidebarText: "#475569",
      sidebarActive: "#F1F5F9",
      sidebarBorder: "#E2E8F0",
      topbar: "#FFFFFF",
      topbarText: "#0F172A",
      surface: "#F8FAFC",
      surfaceBorder: "#E2E8F0",
      cardBg: "#FFFFFF",
      cardText: "#0F172A",
      mutedText: "#64748B",
      success: "#059669",
      warning: "#D97706",
      danger: "#DC2626",
    },
  },

  // ─── Charcoal — dark sidebar with warm gray, enterprise ───
  {
    id: "charcoal",
    name: "Charcoal",
    description: "Dark sidebar with warm gray — sophisticated enterprise",
    colors: {
      primary: "#6B7280",
      primaryHover: "#4B5563",
      primaryLight: "#F3F4F6",
      accent: "#374151",
      accentLight: "#E5E7EB",
      sidebar: "#111827",
      sidebarText: "#9CA3AF",
      sidebarActive: "#1F2937",
      sidebarBorder: "#1F2937",
      topbar: "#FFFFFF",
      topbarText: "#111827",
      surface: "#F9FAFB",
      surfaceBorder: "#E5E7EB",
      cardBg: "#FFFFFF",
      cardText: "#111827",
      mutedText: "#6B7280",
      success: "#059669",
      warning: "#D97706",
      danger: "#DC2626",
    },
    dark: {
      primary: "#9CA3AF",
      primaryHover: "#D1D5DB",
      sidebar: "#030712",
      sidebarText: "#9CA3AF",
      sidebarActive: "#111827",
      sidebarBorder: "#111827",
      topbar: "#030712",
      topbarText: "#D1D5DB",
      surface: "#030712",
      surfaceBorder: "#1F2937",
      cardBg: "#1F2937",
      cardText: "#D1D5DB",
      mutedText: "#9CA3AF",
    },
  },

  // ─── Cobalt — deep blue sidebar with contrasting teal accent ───
  {
    id: "cobalt",
    name: "Cobalt",
    description: "Deep blue with teal accents — bold and professional",
    colors: {
      primary: "#1E40AF",
      primaryHover: "#1E3A8A",
      primaryLight: "#EEF2FF",
      accent: "#14B8A6",
      accentLight: "#CCFBF1",
      sidebar: "#0F172A",
      sidebarText: "#94A3B8",
      sidebarActive: "#172554",
      sidebarBorder: "#1E293B",
      topbar: "#FFFFFF",
      topbarText: "#0F172A",
      surface: "#F8FAFC",
      surfaceBorder: "#DDE4ED",
      cardBg: "#FFFFFF",
      cardText: "#0F172A",
      mutedText: "#64748B",
      success: "#059669",
      warning: "#D97706",
      danger: "#DC2626",
    },
    dark: {
      primary: "#60A5FA",
      primaryHover: "#93C5FD",
      accent: "#2DD4BF",
      sidebar: "#020617",
      sidebarText: "#94A3B8",
      sidebarActive: "#0F172A",
      sidebarBorder: "#0F172A",
      topbar: "#020617",
      topbarText: "#E2E8F0",
      surface: "#020617",
      surfaceBorder: "#1E293B",
      cardBg: "#1E293B",
      cardText: "#E2E8F0",
      mutedText: "#94A3B8",
    },
  },

  // ─── Ultraviolet — deep space violet, neon glow, fully dark ───
  {
    id: "ultraviolet",
    name: "Ultraviolet",
    description: "Deep space violet with neon glow — fully dark, bold, and electric",
    colors: {
      primary: "#A78BFA",
      primaryHover: "#C4B5FD",
      primaryLight: "rgba(167,139,250,0.16)",
      accent: "#E879F9",
      accentLight: "rgba(232,121,249,0.15)",
      sidebar: "#13102B",
      sidebarText: "#C7C3E0",
      sidebarActive: "rgba(167,139,250,0.18)",
      sidebarBorder: "rgba(255,255,255,0.07)",
      topbar: "#13102B",
      topbarText: "#EDEBFF",
      surface: "#0D0B1F",
      surfaceBorder: "rgba(255,255,255,0.09)",
      cardBg: "#1C1838",
      cardText: "#EDEBFF",
      mutedText: "#A5A0C8",
      success: "#4ADE80",
      warning: "#FBBF24",
      danger: "#FB7185",
    },
  },

  // ─── Abyss — black-blue ocean depths with electric cyan ───
  {
    id: "abyss",
    name: "Abyss",
    description: "Ocean-depth navy black with electric cyan — immersive and luminous",
    colors: {
      primary: "#22D3EE",
      primaryHover: "#67E8F9",
      primaryLight: "rgba(34,211,238,0.14)",
      accent: "#38BDF8",
      accentLight: "rgba(56,189,248,0.15)",
      sidebar: "#020D1C",
      sidebarText: "#B0C4D8",
      sidebarActive: "rgba(34,211,238,0.16)",
      sidebarBorder: "rgba(255,255,255,0.07)",
      topbar: "#020D1C",
      topbarText: "#E6F3FA",
      surface: "#02101F",
      surfaceBorder: "rgba(255,255,255,0.09)",
      cardBg: "#0A1C30",
      cardText: "#E6F3FA",
      mutedText: "#93AEC4",
      success: "#4ADE80",
      warning: "#FBBF24",
      danger: "#FB7185",
    },
  },

  // ─── Aurum — charcoal and gold, luxurious light canvas ───
  {
    id: "aurum",
    name: "Aurum",
    description: "Charcoal sidebar with rich gold accents on warm ivory — luxurious and confident",
    colors: {
      primary: "#A16207",
      primaryHover: "#854D0E",
      primaryLight: "rgba(202,138,4,0.14)",
      accent: "#854D0E",
      accentLight: "rgba(133,77,14,0.15)",
      sidebar: "#141210",
      sidebarText: "#D9D2C7",
      sidebarActive: "rgba(202,138,4,0.20)",
      sidebarBorder: "rgba(255,255,255,0.07)",
      topbar: "#FFFFFF",
      topbarText: "#1C1917",
      surface: "#FBF9F4",
      surfaceBorder: "#EAE4D8",
      cardBg: "#FFFFFF",
      cardText: "#1C1917",
      mutedText: "#6E655A",
      success: "#15803D",
      warning: "#A16207",
      danger: "#B91C1C",
    },
  },

  // ─── Sakura — blossom pink and deep plum, soft light canvas ───
  {
    id: "sakura",
    name: "Sakura",
    description: "Cherry blossom pink with deep plum accents — soft, elegant, and warm",
    colors: {
      primary: "#BE185D",
      primaryHover: "#9D174D",
      primaryLight: "rgba(236,72,153,0.12)",
      accent: "#9D174D",
      accentLight: "rgba(157,23,77,0.14)",
      sidebar: "#2B0A1C",
      sidebarText: "#EBD3DE",
      sidebarActive: "rgba(236,72,153,0.20)",
      sidebarBorder: "rgba(255,255,255,0.07)",
      topbar: "#FFFFFF",
      topbarText: "#500724",
      surface: "#FDF6F9",
      surfaceBorder: "#F5DEE9",
      cardBg: "#FFFFFF",
      cardText: "#3B0A22",
      mutedText: "#8A6474",
      success: "#15803D",
      warning: "#A16207",
      danger: "#B91C1C",
    },
  },
]

export function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace("#", ""), 16)
  let r = (num >> 16) & 255
  let g = (num >> 8) & 255
  let b = num & 255

  if (amount > 0) {
    const factor = amount / 100
    r = Math.round(r + (255 - r) * factor)
    g = Math.round(g + (255 - g) * factor)
    b = Math.round(b + (255 - b) * factor)
  } else {
    const factor = Math.abs(amount) / 100
    r = Math.round(r * (1 - factor))
    g = Math.round(g * (1 - factor))
    b = Math.round(b * (1 - factor))
  }

  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0").toUpperCase()}`
}

/** Calculate relative luminance for contrast ratio */
export function getLuminance(hex: string): number {
  const num = parseInt(hex.replace("#", ""), 16)
  const r = ((num >> 16) & 255) / 255
  const g = ((num >> 8) & 255) / 255
  const b = (num & 255) / 255
  const toLinear = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

/** WCAG contrast ratio between two colors */
export function getContrastRatio(color1: string, color2: string): number {
  const l1 = getLuminance(color1)
  const l2 = getLuminance(color2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

export const CARD_SHADOWS: Record<string, string> = {
  none: 'none',
  sm: '0 1px 2px rgba(0,0,0,0.05)',
  md: '0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05)',
  lg: '0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.04)',
}

export const FONT_SCALES: Record<string, string> = {
  sm: '0.925',
  base: '1',
  lg: '1.05',
}

/**
 * Readable text color for content rendered ON the primary color (buttons,
 * filled chips). Light primaries (gold, cyan, silver) get near-black text;
 * everything else gets white. Fixes the washed-out white-on-light-primary
 * buttons several themes shipped with.
 */
export function onPrimaryColor(primary: string): string {
  try {
    const hex = primary.startsWith('#') ? primary : '#000000'
    const vsWhite = getContrastRatio('#FFFFFF', hex)
    const vsDark = getContrastRatio('#0F172A', hex)
    return vsDark > vsWhite ? '#0F172A' : '#FFFFFF'
  } catch {
    return '#FFFFFF'
  }
}

/**
 * Highlight colour for text ON the sidebar (the brand wordmark's accent, the
 * active nav item). The primary is used when it reads on the sidebar; themes
 * whose primary matches the sidebar (e.g. ink-black actions on an ink-black
 * sidebar) fall back to the accent, then to the sidebar text colour. Needs a
 * 3:1 contrast (large / bold UI text).
 */
export function sidebarAccentColor(colors: { primary: string; accent: string; sidebar: string; sidebarText: string }): string {
  const isHex = (c: string) => /^#[0-9a-f]{6}$/i.test(c)
  if (!isHex(colors.sidebar)) return colors.primary
  for (const candidate of [colors.primary, colors.accent]) {
    if (isHex(candidate) && getContrastRatio(candidate, colors.sidebar) >= 3) return candidate
  }
  return colors.sidebarText
}

export function themeToCSS(theme: Theme, isDark: boolean = false): Record<string, string> {
  const dark = isDark && theme.dark ? theme.dark : null
  const comp = { ...DEFAULT_COMPONENTS, ...(theme.components ?? {}) }
  const primary = dark?.primary ?? theme.colors.primary
  return {
    "--theme-primary": primary,
    "--theme-primary-hover": dark?.primaryHover ?? theme.colors.primaryHover,
    "--theme-on-primary": onPrimaryColor(primary),
    "--theme-primary-light": dark?.primaryLight ?? (isDark ? adjustColor(theme.colors.primary, -70) : theme.colors.primaryLight),
    "--theme-accent": dark?.accent ?? theme.colors.accent,
    "--theme-accent-light": isDark ? adjustColor(theme.colors.accent, -70) : theme.colors.accentLight,
    "--theme-sidebar": dark?.sidebar ?? theme.colors.sidebar,
    "--theme-sidebar-text": dark?.sidebarText ?? theme.colors.sidebarText,
    "--theme-sidebar-active": dark?.sidebarActive ?? theme.colors.sidebarActive,
    "--theme-sidebar-border": dark?.sidebarBorder ?? theme.colors.sidebarBorder,
    "--theme-sidebar-accent": sidebarAccentColor({
      primary,
      accent: dark?.accent ?? theme.colors.accent,
      sidebar: dark?.sidebar ?? theme.colors.sidebar,
      sidebarText: dark?.sidebarText ?? theme.colors.sidebarText,
    }),
    "--theme-topbar": dark?.topbar ?? theme.colors.topbar,
    "--theme-topbar-text": dark?.topbarText ?? theme.colors.topbarText,
    "--theme-surface": dark?.surface ?? theme.colors.surface,
    "--theme-surface-border": dark?.surfaceBorder ?? theme.colors.surfaceBorder,
    "--theme-card-bg": dark?.cardBg ?? theme.colors.cardBg,
    "--theme-card-text": dark?.cardText ?? theme.colors.cardText,
    "--theme-muted-text": dark?.mutedText ?? theme.colors.mutedText,
    "--theme-success": dark?.success ?? theme.colors.success,
    "--theme-warning": dark?.warning ?? theme.colors.warning,
    "--theme-danger": dark?.danger ?? theme.colors.danger,
    // Component overrides
    "--theme-border-radius": comp.borderRadius,
    "--theme-card-shadow": CARD_SHADOWS[comp.cardShadow] ?? CARD_SHADOWS.sm,
    "--theme-button-radius": comp.buttonRadius,
    "--theme-font-scale": FONT_SCALES[comp.fontSize] ?? '1',
    "--theme-sidebar-width": comp.sidebarWidth,
    "--theme-input-radius": comp.inputRadius,
  }
}

/** Marketplace presets — extra starting templates for the workspace theme (lib/theme/presets.ts) */
export const THEME_PRESETS: { name: string; description: string; category: string; colors: Theme['colors']; components?: Partial<ThemeComponents> }[] = [
  {
    name: 'Corporate Blue',
    description: 'Classic enterprise blue — trustworthy and professional',
    category: 'Business',
    colors: {
      primary: '#1D4ED8', primaryHover: '#1E40AF', primaryLight: '#DBEAFE',
      accent: '#1E3A8A', accentLight: '#BFDBFE',
      sidebar: '#FFFFFF', sidebarText: '#475569', sidebarActive: '#EFF6FF', sidebarBorder: '#E2E8F0',
      topbar: '#FFFFFF', topbarText: '#0F172A',
      surface: '#F8FAFC', surfaceBorder: '#E2E8F0',
      cardBg: '#FFFFFF', cardText: '#0F172A', mutedText: '#64748B',
      success: '#059669', warning: '#D97706', danger: '#DC2626',
    },
    components: { borderRadius: '8px', cardShadow: 'sm', buttonRadius: '6px' },
  },
  {
    name: 'Startup',
    description: 'Vibrant and modern with rounded corners',
    category: 'Creative',
    colors: {
      primary: '#7C3AED', primaryHover: '#6D28D9', primaryLight: '#F5F3FF',
      accent: '#5B21B6', accentLight: '#EDE9FE',
      sidebar: '#FFFFFF', sidebarText: '#6B7280', sidebarActive: '#F5F3FF', sidebarBorder: '#F3F4F6',
      topbar: '#FFFFFF', topbarText: '#111827',
      surface: '#FAFAFA', surfaceBorder: '#F3F4F6',
      cardBg: '#FFFFFF', cardText: '#111827', mutedText: '#6B7280',
      success: '#059669', warning: '#D97706', danger: '#DC2626',
    },
    components: { borderRadius: '16px', cardShadow: 'md', buttonRadius: '9999px', fontSize: 'base' },
  },
  {
    name: 'Healthcare',
    description: 'Calming blue-green with accessible contrast',
    category: 'Industry',
    colors: {
      primary: '#0891B2', primaryHover: '#0E7490', primaryLight: '#ECFEFF',
      accent: '#155E75', accentLight: '#CFFAFE',
      sidebar: '#FFFFFF', sidebarText: '#475569', sidebarActive: '#ECFEFF', sidebarBorder: '#E2E8F0',
      topbar: '#FFFFFF', topbarText: '#0F172A',
      surface: '#FAFFFE', surfaceBorder: '#D1D5DB',
      cardBg: '#FFFFFF', cardText: '#0F172A', mutedText: '#6B7280',
      success: '#059669', warning: '#D97706', danger: '#DC2626',
    },
    components: { borderRadius: '10px', cardShadow: 'sm', buttonRadius: '8px', fontSize: 'lg' },
  },
  {
    name: 'Finance',
    description: 'Dark sidebar with gold accents — premium and authoritative',
    category: 'Industry',
    colors: {
      primary: '#B45309', primaryHover: '#92400E', primaryLight: '#FFFBEB',
      accent: '#78350F', accentLight: '#FEF3C7',
      sidebar: '#1C1917', sidebarText: '#A8A29E', sidebarActive: '#292524', sidebarBorder: '#292524',
      topbar: '#FFFFFF', topbarText: '#1C1917',
      surface: '#FAFAF9', surfaceBorder: '#E7E5E4',
      cardBg: '#FFFFFF', cardText: '#1C1917', mutedText: '#78716C',
      success: '#059669', warning: '#D97706', danger: '#DC2626',
    },
    components: { borderRadius: '8px', cardShadow: 'sm', buttonRadius: '6px' },
  },
  {
    name: 'SaaS Modern',
    description: 'Clean indigo with generous whitespace',
    category: 'Business',
    colors: {
      primary: '#4F46E5', primaryHover: '#4338CA', primaryLight: '#EEF2FF',
      accent: '#3730A3', accentLight: '#E0E7FF',
      sidebar: '#FAFAFA', sidebarText: '#6B7280', sidebarActive: '#EEF2FF', sidebarBorder: '#F3F4F6',
      topbar: '#FFFFFF', topbarText: '#111827',
      surface: '#FEFEFE', surfaceBorder: '#F3F4F6',
      cardBg: '#FFFFFF', cardText: '#111827', mutedText: '#6B7280',
      success: '#059669', warning: '#D97706', danger: '#DC2626',
    },
    components: { borderRadius: '12px', cardShadow: 'md', buttonRadius: '8px' },
  },
  {
    name: 'Legal',
    description: 'Understated navy with conservative styling',
    category: 'Industry',
    colors: {
      primary: '#1E3A5F', primaryHover: '#172E4A', primaryLight: '#EFF6FF',
      accent: '#0F2440', accentLight: '#DBEAFE',
      sidebar: '#0F172A', sidebarText: '#94A3B8', sidebarActive: '#1E293B', sidebarBorder: '#1E293B',
      topbar: '#FFFFFF', topbarText: '#0F172A',
      surface: '#F8FAFC', surfaceBorder: '#E2E8F0',
      cardBg: '#FFFFFF', cardText: '#0F172A', mutedText: '#64748B',
      success: '#059669', warning: '#D97706', danger: '#DC2626',
    },
    components: { borderRadius: '6px', cardShadow: 'sm', buttonRadius: '4px', fontSize: 'base' },
  },
]

/** Platform default theme id (Gallery) — new workspaces start from it. */
export const PLATFORM_DEFAULT_THEME_ID = "basecamp"
