/** Shape of the generated command table (src/generated/commands.ts). */

export interface QueryParamSpec {
  /** Query parameter name as sent to the API (`workflow_id`). */
  name: string
  /** CLI flag without dashes (`workflow-id`). */
  flag: string
  description?: string
  required: boolean
  type?: string
  enum?: string[]
}

export interface BodyFieldSpec {
  name: string
  type?: string
  required: boolean
  description?: string
}

export interface CommandSpec {
  operationId: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Path template relative to /api/v1. */
  path: string
  /** Command group (`workflows`). */
  resource: string
  /** Sub-command (`list`). */
  verb: string
  summary: string
  permission: string | null
  /** Path params taken as positional arguments, in order. */
  positional: string[]
  /** Body fields taken as positional arguments after the path ones (`apply-preset <preset_id>`). */
  bodyPositional?: string[]
  /** Path params not covered by `positional` (become required flags). */
  pathFlags: string[]
  query: QueryParamSpec[]
  /** null when the operation takes no request body. */
  body: { required: boolean; fields: BodyFieldSpec[] } | null
  listKey?: string
  /** true when the operation accepts limit/offset (enables --all). */
  paginated: boolean
  /** Cursor-paged list (`limit` + `after`): --limit maps to `limit`; page with --after <next_cursor>. */
  cursor?: boolean
  envelope: boolean
  /**
   * Async variant: the command runs it as a background job and waits for the
   * result (`--no-wait` prints the job instead).
   */
  async?: boolean
  /** Deletes or revokes something: confirmation required unless --yes / non-TTY. */
  destructive: boolean
}
