/** Roles an invitation may grant. Kept dependency-free so API schemas can import it. */
export const INVITABLE_ROLES = ['owner', 'admin', 'manager', 'member', 'viewer'] as const
