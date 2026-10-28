"use client"

import { useDashboardAuth } from '@/lib/dashboard-auth-context'
import { TenantOnboarding } from '@/components/onboarding/tenant-onboarding'
import { PageSkeleton } from '@/components/ui/page-skeleton'

export default function OnboardingPage() {
  const { profile, loading } = useDashboardAuth()

  if (loading) return <PageSkeleton variant="settings" />

  const tenant = profile?.tenant as any
  if (!tenant) return null
  if (tenant.onboarding_completed) return null

  return <TenantOnboarding tenantId={tenant.id} tenantName={tenant.name ?? ''} tenantSlug={tenant.slug ?? null} />
}
