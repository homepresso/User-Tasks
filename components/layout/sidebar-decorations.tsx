/**
 * Optional sidebar glows and floating illustrations. Hidden unless the
 * workspace theme turns them on (the theme stylesheet adds `display: block`
 * to `.premium-sidebar .sidebar-decorations`); the default presets don't.
 */
export function SidebarDecorations() {
  return (
  <div className="sidebar-decorations pointer-events-none absolute inset-0 z-0">
    {/* Teal glow — top-left */}
    <div
      className="absolute rounded-full"
      style={{
        top: '20%',
        left: '-80px',
        width: '360px',
        height: '360px',
        background: 'radial-gradient(circle, var(--sidebar-glow-1) 0%, transparent 70%)',
        animation: 'glowPulse 6s ease-in-out infinite',
      }}
    />
    {/* Indigo glow — bottom-right */}
    <div
      className="absolute rounded-full"
      style={{
        bottom: '15%',
        right: '-40px',
        width: '300px',
        height: '300px',
        background: 'radial-gradient(circle, var(--sidebar-glow-2) 0%, transparent 70%)',
        animation: 'glowPulse 8s ease-in-out 3s infinite',
      }}
    />
    {/* Agent orbit — top-right, behind nav */}
    <div
      className="deco-orbit absolute"
      style={{
        top: '220px',
        right: '12px',
        opacity: 0.04,
        animation: 'floatY 10s ease-in-out 2s infinite',
      }}
    >
      <svg width="80" height="80" viewBox="0 0 120 120" fill="none">
        <circle cx="60" cy="60" r="50" stroke="white" strokeWidth="2" />
        <circle cx="60" cy="60" r="30" stroke="white" strokeWidth="1.5" strokeDasharray="6 4" />
        <circle cx="60" cy="60" r="8" fill="white" />
        <circle cx="60" cy="10" r="4" fill="white" style={{ transformOrigin: '60px 60px', animation: 'orbit 6s linear infinite' }} />
        <circle cx="110" cy="60" r="3" fill="white" style={{ transformOrigin: '60px 60px', animation: 'orbit 8s linear 1s infinite' }} />
      </svg>
    </div>
    {/* Workflow nodes — bottom area */}
    <div
      className="deco-workflow absolute"
      style={{
        bottom: '48px',
        left: '12px',
        opacity: 0.05,
        animation: 'floatY 8s ease-in-out infinite',
      }}
    >
      <svg width="220" height="160" viewBox="0 0 280 200" fill="none">
        <rect x="110" y="10" width="60" height="32" rx="8" fill="white" />
        <rect x="30" y="80" width="60" height="32" rx="8" fill="white" />
        <rect x="190" y="80" width="60" height="32" rx="8" fill="white" />
        <rect x="70" y="155" width="60" height="32" rx="8" fill="white" />
        <rect x="150" y="155" width="60" height="32" rx="8" fill="white" />
        <path d="M130 42 L60 80" stroke="white" strokeWidth="2" />
        <path d="M150 42 L220 80" stroke="white" strokeWidth="2" />
        <path d="M60 112 L100 155" stroke="white" strokeWidth="2" />
        <path d="M220 112 L180 155" stroke="white" strokeWidth="2" />
      </svg>
    </div>
  </div>
  )
}
