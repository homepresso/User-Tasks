export function hasExtensibilityFeatureAccess(permissions: Iterable<string>) {
  const permissionSet = permissions instanceof Set ? permissions : new Set(permissions)
  if (permissionSet.has('extensibility.view')) return true

  // Compatibility path for tenants whose admin-style roles predate the
  // Extensibility permission group. This keeps legitimate platform
  // administrators unblocked while the permission refresh migration
  // updates stored role payloads.
  return (
    permissionSet.has('settings.edit')
    && permissionSet.has('integrations.view')
    && permissionSet.has('workflows.view')
  )
}
