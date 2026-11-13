import { NextResponse } from 'next/server'
import { instanceAdminRoute } from '@/lib/api/instance-admin-route'
import { getLicenceEndpoint, installLicenceEndpoint, removeLicenceEndpoint } from '@/lib/api-schemas/licence'
import { installLicence, licenceStatusView, removeInstalledLicence } from '@/lib/licensing/admin'
import { ServiceError } from '@/lib/services/context'

/**
 * /api/v1/licence — licence status, install / replace, remove (instance
 * admin token only; lib/licensing/admin.ts).
 */
export const GET = instanceAdminRoute(getLicenceEndpoint, async () => {
  return NextResponse.json({ success: true, data: await licenceStatusView({ fresh: true }) }, { headers: { 'Cache-Control': 'no-store' } })
})

export const PUT = instanceAdminRoute(installLicenceEndpoint, async ({ body, ip }) => {
  return installLicence(body.licence, { actor: `api (${ip})` })
})

export const DELETE = instanceAdminRoute(removeLicenceEndpoint, async ({ query, ip }) => {
  if (!query.licence_id && query.all !== 'true') throw ServiceError.validation('Pass licence_id, or all=true to remove every licence installed here')
  return removeInstalledLicence(query.licence_id ?? null, { actor: `api (${ip})` })
})
