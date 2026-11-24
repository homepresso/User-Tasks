/**
 * Registers where the Settings → Query resolver (lib/reports/data-source.ts)
 * reads its settings: tenants.settings.query per workspace (self-hosted), or
 * the one instance-wide configuration (instance setting
 * instance.query_settings) in the cloud edition. Imported for its side
 * effect by every read path that resolves a data source; kept small so
 * those paths don't pull in the admin code of lib/services/query-settings.
 */

import { createServiceClient } from '@/lib/cron-auth'
import { getInstanceSetting } from '@/lib/config/instance-settings'
import { isCloud } from '@/lib/deployment'
import { INSTANCE_QUERY_SETTING, setQuerySettingsLoader } from '@/lib/reports/data-source'

/* eslint-disable @typescript-eslint/no-explicit-any -- tenants.settings is untyped JSON */

setQuerySettingsLoader(async (tenantId) => {
  const { data, error } = await (createServiceClient() as any).from('tenants').select('settings').eq('id', tenantId).maybeSingle()
  if (error) throw new Error(error.message)
  return data?.settings ?? null
}, {
  instance: () => getInstanceSetting(INSTANCE_QUERY_SETTING),
  isCloud,
})
