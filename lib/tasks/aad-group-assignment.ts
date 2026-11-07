/**
 * AAD (Entra ID) group assignment for the workflow User Task node — the
 * config shape and the pure rules shared by the designer, validation, the
 * docs and the engine. Client-safe (no server imports).
 *
 * Node config:
 *   assignment_type     'aad_group'
 *   aad_group_id        the Entra group's object id
 *   aad_group_name      its display name when picked (labels only)
 *   aad_group_mode      'claim' (default): one task, anyone in the group can
 *                       claim it, first claim wins (like a team task);
 *                       'everyone': one collaborative task, every member is
 *                       an assignee and the node's completion_rule decides
 *                       when it is done (first_response, all_complete, …)
 *   aad_include_nested  true (default): members of nested groups count
 *
 * The option exists only while the workspace has an enabled Entra ID
 * directory connection (directory capability `entraGroups`). A saved node
 * whose connection was later removed shows a warning in the designer, fails
 * validation, and at run time creates the task unassigned (the node's
 * no-assignee behaviour) with a warning in the run log.
 */

export const AAD_GROUP_ASSIGNMENT = 'aad_group'

export const AAD_GROUP_MODES = ['claim', 'everyone'] as const
export type AadGroupMode = (typeof AAD_GROUP_MODES)[number]

export const AAD_GROUP_MODE_LABELS: Record<AadGroupMode, string> = {
  claim: 'Anyone in the group can claim it',
  everyone: 'Everyone in the group gets it',
}

export const AAD_GROUP_MODE_HELP: Record<AadGroupMode, string> = {
  claim: 'One task. Every member sees it as Queued with a Claim action; the first to claim it becomes the assignee.',
  everyone: 'One collaborative task with every member as an assignee. The completion rule below decides when it is done.',
}

/** Most people one AAD group task is given to; members beyond it are skipped (run log warning). */
export const MAX_AAD_GROUP_ASSIGNEES = 500

/** Directory capabilities the designer reads (directory.capabilities). */
export interface DirectoryCapabilities {
  /** An enabled Entra ID directory connection with credentials: AAD group assignment is available. */
  entraGroups: boolean
  /** The connection also syncs groups into teams (the picker lists synced groups). */
  syncedGroups: boolean
}

export interface AadGroupConfig {
  groupId: string
  groupName: string
  mode: AadGroupMode
  includeNested: boolean
}

export function normaliseAadGroupMode(value: unknown): AadGroupMode {
  return value === 'everyone' ? 'everyone' : 'claim'
}

/** The node's AAD group settings with defaults applied. */
export function aadGroupConfigOf(config: Record<string, unknown> | null | undefined): AadGroupConfig {
  const c = config ?? {}
  return {
    groupId: typeof c.aad_group_id === 'string' ? c.aad_group_id.trim() : '',
    groupName: typeof c.aad_group_name === 'string' ? c.aad_group_name.trim() : '',
    mode: normaliseAadGroupMode(c.aad_group_mode),
    includeNested: c.aad_include_nested !== false,
  }
}

export interface AssignmentOption {
  val: 'individual' | 'team' | 'aad_group'
  label: string
}

/**
 * The Assignment segments: AAD Group only when Entra ID is configured — or
 * when this node already uses it (so a saved config stays visible, with a
 * warning, after the connection is removed).
 */
export function assignmentOptions(capabilities: Pick<DirectoryCapabilities, 'entraGroups'> | null | undefined, current: unknown): AssignmentOption[] {
  const options: AssignmentOption[] = [
    { val: 'individual', label: 'Individual' },
    { val: 'team', label: 'Team' },
  ]
  if (capabilities?.entraGroups || current === AAD_GROUP_ASSIGNMENT) options.push({ val: 'aad_group', label: 'AAD Group' })
  return options
}

export const AAD_NOT_CONFIGURED_MESSAGE = 'AAD group assignment needs an enabled Entra ID directory connection (Settings → Directory sync)'

/**
 * Validation errors for an aad_group node. `entraGroups` is the workspace's
 * capability when known (undefined: not checked, e.g. offline validation).
 */
export function aadGroupValidationErrors(config: Record<string, unknown>, env: { entraGroups?: boolean } = {}): string[] {
  if (config.assignment_type !== AAD_GROUP_ASSIGNMENT) return []
  const errors: string[] = []
  const c = aadGroupConfigOf(config)
  if (!c.groupId) errors.push('AAD group required')
  if (config.aad_group_mode !== undefined && config.aad_group_mode !== null && config.aad_group_mode !== '' && !(AAD_GROUP_MODES as readonly string[]).includes(String(config.aad_group_mode))) {
    errors.push('AAD group mode must be claim or everyone')
  }
  if (env.entraGroups === false) errors.push(AAD_NOT_CONFIGURED_MESSAGE)
  return errors
}
