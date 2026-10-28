// Microsoft Entra admin on a PostgreSQL Flexible Server. A module because the
// resource name is the principal's object id, which for a managed identity is
// only known once the identity exists (BCP120 in the parent template).

param serverName string
param objectId string
param principalName string
@allowed(['User', 'Group', 'ServicePrincipal'])
param principalType string
param tenantId string

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: serverName
}

resource admin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: server
  name: objectId
  properties: {
    principalType: principalType
    principalName: principalName
    tenantId: tenantId
  }
}
