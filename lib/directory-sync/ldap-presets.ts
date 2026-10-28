/**
 * LDAP flavour defaults (filters and attribute mapping), shared by the LDAP
 * client (lib/directory-sync/ldap.ts) and the settings form, which shows them
 * as placeholders. No server-only imports.
 */

export const LDAP_FLAVORS = ['active_directory', 'openldap', 'generic'] as const
export type LdapFlavor = (typeof LDAP_FLAVORS)[number]

export const LDAP_MAPPING_KEYS = ['id', 'username', 'email', 'display_name', 'first_name', 'last_name', 'group_name', 'group_description', 'member', 'manager'] as const
export type LdapMappingKey = (typeof LDAP_MAPPING_KEYS)[number]

export interface LdapPreset {
  label: string
  userFilter: string
  groupFilter: string
  map: Record<LdapMappingKey, string>
}

export const LDAP_PRESETS: Record<LdapFlavor, LdapPreset> = {
  active_directory: {
    label: 'Active Directory',
    userFilter: '(&(objectCategory=person)(objectClass=user))',
    groupFilter: '(objectClass=group)',
    map: {
      id: 'objectGUID', username: 'sAMAccountName', email: 'mail', display_name: 'displayName',
      first_name: 'givenName', last_name: 'sn', group_name: 'cn', group_description: 'description', member: 'member', manager: 'manager',
    },
  },
  openldap: {
    label: 'OpenLDAP',
    userFilter: '(objectClass=inetOrgPerson)',
    groupFilter: '(|(objectClass=groupOfNames)(objectClass=groupOfUniqueNames)(objectClass=posixGroup))',
    map: {
      id: 'entryUUID', username: 'uid', email: 'mail', display_name: 'displayName',
      first_name: 'givenName', last_name: 'sn', group_name: 'cn', group_description: 'description', member: 'member', manager: 'manager',
    },
  },
  generic: {
    label: 'Other LDAP (389 DS, FreeIPA, lldap, …)',
    userFilter: '(|(objectClass=inetOrgPerson)(objectClass=person))',
    groupFilter: '(|(objectClass=groupOfNames)(objectClass=groupOfUniqueNames)(objectClass=group)(objectClass=posixGroup))',
    map: {
      id: 'entryUUID', username: 'uid', email: 'mail', display_name: 'displayName',
      first_name: 'givenName', last_name: 'sn', group_name: 'cn', group_description: 'description', member: 'member', manager: 'manager',
    },
  },
}
