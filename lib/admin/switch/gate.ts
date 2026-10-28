import { getBootstrapConfig, readEnv } from '@/lib/config/bootstrap'
import { decodeSettings, readSettingRows, type SqlClient } from '../ops/instance-db'
import { ALLOW_UI_SWITCHING_SETTING, switchingGate, type SwitchingGate } from '../switch-runtime'

/** The page's switching gate for this deployment, read over a direct connection (see ../switch-runtime). */
export async function uiSwitchingGateFor(db: SqlClient): Promise<SwitchingGate> {
  const settings = decodeSettings(await readSettingRows(db))
  return switchingGate({ flag: readEnv('INFRA_UI_SWITCHING'), deploymentMode: getBootstrapConfig().deploymentMode, allowSetting: settings.get(ALLOW_UI_SWITCHING_SETTING) })
}
