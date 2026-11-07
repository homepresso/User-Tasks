import { Suspense } from 'react'
import { SettingsFrame } from '@/components/settings/settings-frame'

/** Every settings page sits in the Settings frame: grouped sub-nav + content column. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={children}>
      <SettingsFrame>{children}</SettingsFrame>
    </Suspense>
  )
}
