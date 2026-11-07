import type { Metadata } from 'next'
import { HomeDashboard } from '@/components/home/home-dashboard'
import '@/components/home/home-grid.css'

export const metadata: Metadata = { title: 'Home' }

/** The signed-in landing page: metrics, favourite forms and the My tasks / Queue / Following / Submissions list. */
export default function HomePage() {
  return <HomeDashboard />
}
