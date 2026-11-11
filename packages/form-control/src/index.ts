/**
 * @user-tasks/form-control — build UserTasks custom form controls.
 *
 * - The contract: manifest, element API, events, theme tokens, bridge
 *   messages and limits (the same types the app uses).
 * - UserTasksControlElement: a plain HTMLElement base class.
 * - UserTasksControlMixin: the same helpers for Lit, without importing Lit.
 */
export * from './contract'
export {
  HOST_PROPERTY_NAMES,
  LIT_HOST_PROPERTIES,
  accessibleDescription,
  coerceHostProperty,
  controlEventInit,
  defaultHostProperties,
  dispatchRequest,
  isDeclarablePropName,
  isThemeToken,
  resolveProp,
  resolveThemeToken,
  validityDetail,
  type ControlRequestDetail,
  type ControlRequestFn,
  type HostProperties,
  type HostPropertyName,
  type LitLikePropertyDeclaration,
} from './core'
export { UserTasksControlElement, type UserTasksControlHelpers, type UserTasksControlHost } from './element'
export { UserTasksControlMixin, type Constructor, type UserTasksControlStatics } from './mixin'
