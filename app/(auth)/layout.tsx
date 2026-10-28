import { Workflow, Layers, Zap, Shield, Bot, BarChart3 } from 'lucide-react'
import { Wordmark } from '@/components/brand/logo'
import { PublicThemeReset } from '@/components/layout/public-theme-reset'

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen" style={{
      /* Reset ALL theme variables so tenant themes don't affect auth pages */
      ['--theme-primary' as any]: '#17150F',
      ['--theme-primary-hover' as any]: '#2E2A24',
      ['--theme-primary-light' as any]: 'rgba(23,21,15,0.14)',
      ['--theme-card-bg' as any]: '#FFFFFF',
      ['--theme-card-text' as any]: '#1B1916',
      ['--theme-surface' as any]: '#F5F2EA',
      ['--theme-surface-border' as any]: '#E6E1D5',
      ['--theme-muted-text' as any]: '#6E6759',
      ['--theme-sidebar-bg' as any]: '#FAF8F3',
      ['--theme-sidebar-text' as any]: '#1B1916',
      ['--theme-topbar' as any]: '#FAF8F3',
      ['--theme-topbar-text' as any]: '#1B1916',
      ['--theme-accent' as any]: '#17150F',
      ['--theme-danger' as any]: '#D07A6A',
      ['--theme-success' as any]: '#7FA98A',
    }}>
      <PublicThemeReset />
      {/* Left panel — branding & messaging */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-[55%] relative flex-col justify-between p-12 overflow-hidden" style={{ background: 'linear-gradient(145deg, #FAF8F3 0%, #F1EDE3 52%, #F5F2EA 100%)' }}>
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(27,25,22,0.28) 1px, transparent 0)', backgroundSize: '32px 32px' }} />
        {/* Glow accent — animated pulse */}
        <div className="absolute top-1/4 -left-20 w-[500px] h-[500px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(23,21,15,0.20) 0%, transparent 70%)', animation: 'glowPulse 6s ease-in-out infinite' }} />
        <div className="absolute bottom-1/4 right-0 w-[400px] h-[400px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(176,138,84,0.12) 0%, transparent 70%)', animation: 'glowPulse 8s ease-in-out 3s infinite' }} />

        {/* Floating workflow illustration */}
        <div className="absolute top-20 right-12 opacity-[0.06]" style={{ animation: 'floatY 8s ease-in-out infinite' }}>
          <svg width="280" height="200" viewBox="0 0 280 200" fill="none">
            {/* Nodes */}
            <rect x="110" y="10" width="60" height="32" rx="8" fill="white" />
            <rect x="30" y="80" width="60" height="32" rx="8" fill="white" />
            <rect x="190" y="80" width="60" height="32" rx="8" fill="white" />
            <rect x="70" y="155" width="60" height="32" rx="8" fill="white" />
            <rect x="150" y="155" width="60" height="32" rx="8" fill="white" />
            {/* Edges */}
            <path d="M130 42 L60 80" stroke="white" strokeWidth="2" />
            <path d="M150 42 L220 80" stroke="white" strokeWidth="2" />
            <path d="M60 112 L100 155" stroke="white" strokeWidth="2" />
            <path d="M220 112 L180 155" stroke="white" strokeWidth="2" />
          </svg>
        </div>

        {/* Floating agent illustration */}
        <div className="absolute bottom-32 right-16 opacity-[0.05]" style={{ animation: 'floatY 10s ease-in-out 2s infinite' }}>
          <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
            <circle cx="60" cy="60" r="50" stroke="white" strokeWidth="2" />
            <circle cx="60" cy="60" r="30" stroke="white" strokeWidth="1.5" strokeDasharray="6 4" />
            <circle cx="60" cy="60" r="8" fill="white" />
            {/* Orbiting dots */}
            <circle cx="60" cy="10" r="4" fill="white" style={{ transformOrigin: '60px 60px', animation: 'orbit 6s linear infinite' } as any} />
            <circle cx="110" cy="60" r="3" fill="white" style={{ transformOrigin: '60px 60px', animation: 'orbit 8s linear 1s infinite' } as any} />
          </svg>
        </div>

        {/* Top — logo */}
        <div className="relative" style={{ animation: 'fadeInDown 0.6s ease-out' }}>
          <h1 aria-label="UserTasks">
            <Wordmark size={40} />
          </h1>
          <p className="text-sm mt-3" style={{ color: '#6E6759' }}>Open-Source Headless Workflow Engine</p>
        </div>

        {/* Center — hero messaging */}
        <div className="relative space-y-8 max-w-lg">
          <div style={{ animation: 'fadeInUp 0.8s ease-out 0.2s both' }}>
            <h2 className="text-4xl font-bold leading-tight">
              <span style={{ color: '#1B1916' }}>Workflows run.</span><br />
              <span style={{ color: '#17150F' }}>People make</span><br />
              <span style={{ color: '#1B1916' }}>the calls.</span>
            </h2>
            <p className="text-lg mt-4 leading-relaxed" style={{ color: '#6D6759' }}>
              Design workflows visually, connect your systems, and route
              decisions to people as tasks — then drive it all from your own
              apps through the API and MCP server.
            </p>
          </div>

          {/* Feature pills — staggered animation */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: Workflow, label: 'Visual Workflow Designer', delay: '0.4s' },
              { icon: Layers, label: 'Integrations & Decision Tables', delay: '0.5s' },
              { icon: Zap, label: 'Human Tasks & SLAs', delay: '0.6s' },
              { icon: Bot, label: 'Optional AI Agents', delay: '0.7s' },
              { icon: BarChart3, label: 'Reports, API & MCP', delay: '0.8s' },
              { icon: Shield, label: 'Governance & Audit Trails', delay: '0.9s' },
            ].map(({ icon: Icon, label, delay }) => (
              <div key={label} className="flex items-center gap-2.5 rounded-lg px-3.5 py-3 transition-all hover:scale-[1.02]"
                style={{
                  backgroundColor: 'rgba(67,62,60,0.04)',
                  border: '1px solid rgba(67,62,60,0.06)',
                  animation: `fadeInUp 0.5s ease-out ${delay} both`,
                }}>
                <div className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(23,21,15,0.14)' }}>
                  <Icon size={15} style={{ color: '#17150F' }} />
                </div>
                <span className="text-[13px] font-medium" style={{ color: '#6D6759' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom — tagline */}
        <div className="relative" style={{ animation: 'fadeInUp 0.6s ease-out 1s both' }}>
          <p className="text-xs" style={{ color: '#6E6759' }}>
            Open source under Apache-2.0 — self-host it or use the cloud edition.
          </p>
        </div>

      </div>

      {/* Right panel — form */}
      <div className="abyss-auth flex flex-1 items-center justify-center p-6 sm:p-12" style={{ background: 'radial-gradient(circle at 80% 10%, rgba(23,21,15,0.08), transparent 34%), #F5F2EA' }}>
        <div className="w-full max-w-md" style={{ animation: 'fadeInUp 0.6s ease-out 0.3s both' }}>
          {/* Mobile logo */}
          <div className="lg:hidden mb-10 text-center">
            <h1 className="flex justify-center" aria-label="UserTasks">
              <Wordmark size={34} />
            </h1>
            <p className="text-xs mt-2" style={{ color: '#6E6759' }}>Open-Source Headless Workflow Engine</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}
