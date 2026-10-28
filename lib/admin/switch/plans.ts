import type { ProviderArea } from '@/lib/config/schema'
import { authSwitch } from './auth'
import { cacheSwitch, emailSwitch, realtimeSwitch, secretsSwitch } from './config-only'
import { databaseSwitch } from './database'
import { kmsSwitch } from './kms'
import { schedulerSwitch } from './scheduler'
import { storageSwitch } from './storage'
import type { AreaSwitch } from './types'

/** The switch plan for each area (`usertasks-admin switch <area>`). */
export const SWITCH_PLANS: Record<ProviderArea, AreaSwitch> = {
  db: databaseSwitch,
  auth: authSwitch,
  storage: storageSwitch,
  realtime: realtimeSwitch,
  scheduler: schedulerSwitch,
  email: emailSwitch,
  secrets: secretsSwitch,
  cache: cacheSwitch,
  kms: kmsSwitch,
}
