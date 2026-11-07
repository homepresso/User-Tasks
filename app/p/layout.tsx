import { PublicThemeReset } from '@/components/layout/public-theme-reset'

/**
 * Minimal public layout of anonymous form links (/p/<token>): no navigation,
 * no session, no workspace data — the platform's light default, the form's
 * own theme on top (components/forms/form-theme-scope.tsx).
 */
export default function PublicFormLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-bg px-4 py-8 text-fg sm:py-12" data-public-form-layout>
      <PublicThemeReset />
      {children}
    </main>
  )
}
