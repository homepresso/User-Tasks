// UserTasks reference deployment: the "Azure profile" (Bicep, resource-group scope).
//
//   web        Container App (node server.js, ingress :3000), user-assigned managed identity
//   tick       Container Apps Job, cron "* * * * *": POST <app>/api/cron/tick with CRON_SECRET
//   migrate    Container Apps Job, manual trigger: node admin.cjs db migrate
//   database   PostgreSQL Flexible Server 16, private access (VNet), Microsoft Entra auth only
//   storage    Storage account (no shared keys, no public blobs), three blob containers
//   secrets    Key Vault (RBAC): encryption-key, cron-secret
//   email      Azure Communication Services + Email Communication Service (Azure-managed domain)
//   logs       Log Analytics workspace for the Container Apps environment
//   registry   Azure Container Registry (pull by managed identity)
//   cache      Azure Cache for Redis (TLS, Microsoft Entra auth only, private
//              endpoint): shared rate limits / invalidations (CACHE_PROVIDER=redis)
//
// Same resources and settings as ../terraform. See ../README.md.

targetScope = 'resourceGroup'

@description('Azure region.')
param location string = resourceGroup().location

@description('Short lowercase prefix for every resource (3-12 letters/digits).')
@minLength(3)
@maxLength(12)
param name string = 'usertasks'

@description('Create the Container App and jobs. false for the first deployment (registry, database, storage, Key Vault), push the image, then deploy again with true.')
param deployApps bool = true

@description('Tag of the usertasks image in the created registry.')
param imageTag string = 'latest'

@description('Public origin (custom domain). Empty = the generated https://<app>.<environment domain>.')
param appUrl string = ''

@description('Comma-separated INSTANCE_ADMIN_EMAILS.')
param instanceAdminEmails string = ''

@allowed(['builtin', 'oidc', 'saml'])
param authProvider string = 'builtin'

@description('AUTH_SSO_PROVIDERS JSON array; client secrets as secret://<key-vault-secret-name>. Empty = none.')
param authSsoProviders string = ''

@secure()
@minLength(44)
@description('ENCRYPTION_KEY: 32 bytes as 64 hex chars or base64 (openssl rand -hex 32). Stored in Key Vault only.')
param encryptionKey string

@secure()
@minLength(32)
@description('CRON_SECRET (openssl rand -hex 32). Stored in Key Vault only.')
param cronSecret string

param postgresSkuName string = 'Standard_B1ms'
@allowed(['Burstable', 'GeneralPurpose', 'MemoryOptimized'])
param postgresSkuTier string = 'Burstable'
param postgresStorageGb int = 32

@description('Optional extra Entra admin for the database server (a user or group); empty objectId = none.')
param postgresAdminObjectId string = ''
param postgresAdminName string = ''
@allowed(['User', 'Group', 'ServicePrincipal'])
param postgresAdminType string = 'Group'

param vnetAddressSpace string = '10.40.0.0/16'
@description('Container Apps environment subnet (workload profiles: /27 or larger).')
param containerAppsSubnetPrefix string = '10.40.0.0/23'
param postgresSubnetPrefix string = '10.40.2.0/28'
@description('Private endpoint subnet (Azure Cache for Redis).')
param privateEndpointSubnetPrefix string = '10.40.3.0/27'

@description('Azure Cache for Redis as the shared cache (CACHE_PROVIDER=redis); false uses the postgres cache provider (no extra service).')
param cacheEnabled bool = true
@allowed(['Basic', 'Standard', 'Premium'])
@description('Basic has no replica and no SLA; use Standard (or Premium) in production.')
param cacheSkuName string = 'Basic'
@minValue(0)
@maxValue(6)
param cacheCapacity int = 0

@description('Data location of Azure Communication Services (e.g. Europe, United States).')
param communicationDataLocation string = 'Europe'

param appCpu string = '1.0'
param appMemory string = '2Gi'
@minValue(1)
param appMinReplicas int = 1
param appMaxReplicas int = 3

param tags object = { app: 'usertasks' }

var suffix = take(uniqueString(resourceGroup().id, name), 5)
var databaseName = 'usertasks'
var bucketPrefix = 'usertasks-'
var buckets = ['task-files', 'logos', 'brand-fonts']
var appName = '${name}-web'
var tenantId = subscription().tenantId

var roles = {
  storageBlobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
  storageBlobDelegator: 'db58b8e5-c6ad-4a2a-8342-4190687cbf4a'
  keyVaultSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  acrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d'
  contributor: 'b24988ac-6180-42a0-ab88-20f7382dd24c'
}

// ── Identity ─────────────────────────────────────────────────────────────────

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${name}'
  location: location
  tags: tags
}

// ── Logs ─────────────────────────────────────────────────────────────────────

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${name}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ── Network ──────────────────────────────────────────────────────────────────

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: 'vnet-${name}'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [vnetAddressSpace] }
    subnets: [
      {
        name: 'snet-apps'
        properties: {
          addressPrefix: containerAppsSubnetPrefix
          delegations: [{ name: 'containerapps', properties: { serviceName: 'Microsoft.App/environments' } }]
        }
      }
      {
        name: 'snet-postgres'
        properties: {
          addressPrefix: postgresSubnetPrefix
          delegations: [{ name: 'postgres', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }]
        }
      }
      {
        name: 'snet-endpoints'
        properties: {
          addressPrefix: privateEndpointSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource appsSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' existing = {
  parent: vnet
  name: 'snet-apps'
}

resource postgresSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' existing = {
  parent: vnet
  name: 'snet-postgres'
}

resource endpointsSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' existing = {
  parent: vnet
  name: 'snet-endpoints'
}

resource postgresDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: '${name}.private.postgres.database.azure.com'
  location: 'global'
  tags: tags
}

resource postgresDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: postgresDns
  name: 'postgres'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnet.id }
  }
}

// ── Cache ────────────────────────────────────────────────────────────────────

// Microsoft Entra auth only (no access keys): the app signs in as the managed
// identity (CACHE_REDIS_AUTH=entra, username = its object id). Reached over
// a private endpoint; no public network access.
resource redis 'Microsoft.Cache/redis@2024-03-01' = if (cacheEnabled) {
  name: 'redis-${name}-${suffix}'
  location: location
  tags: tags
  properties: {
    sku: { name: cacheSkuName, family: cacheSkuName == 'Premium' ? 'P' : 'C', capacity: cacheCapacity }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled'
    disableAccessKeyAuthentication: true
    redisConfiguration: {
      'aad-enabled': 'true'
      'maxmemory-policy': 'volatile-lru'
    }
  }
}

resource redisAccess 'Microsoft.Cache/redis/accessPolicyAssignments@2024-03-01' = if (cacheEnabled) {
  parent: redis
  name: 'usertasks-app'
  properties: {
    accessPolicyName: 'Data Contributor'
    objectId: identity.properties.principalId
    objectIdAlias: identity.name
  }
}

resource redisDns 'Microsoft.Network/privateDnsZones@2024-06-01' = if (cacheEnabled) {
  name: 'privatelink.redis.cache.windows.net'
  location: 'global'
  tags: tags
}

resource redisDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = if (cacheEnabled) {
  parent: redisDns
  name: 'redis'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnet.id }
  }
}

resource redisEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = if (cacheEnabled) {
  name: 'pe-redis-${name}'
  location: location
  tags: tags
  properties: {
    subnet: { id: endpointsSubnet.id }
    privateLinkServiceConnections: [
      {
        name: 'redis'
        properties: {
          privateLinkServiceId: redis.id
          groupIds: ['redisCache']
        }
      }
    ]
  }
}

resource redisEndpointDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = if (cacheEnabled) {
  parent: redisEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [{ name: 'redis', properties: { privateDnsZoneId: redisDns.id } }]
  }
}

// ── Database ─────────────────────────────────────────────────────────────────

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: 'psql-${name}-${suffix}'
  location: location
  tags: tags
  sku: { name: postgresSkuName, tier: postgresSkuTier }
  properties: {
    version: '16'
    storage: { storageSizeGB: postgresStorageGb }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    network: {
      delegatedSubnetResourceId: postgresSubnet.id
      privateDnsZoneArmResourceId: postgresDns.id
      publicNetworkAccess: 'Disabled'
    }
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: tenantId
    }
    highAvailability: { mode: 'Disabled' }
  }
  dependsOn: [postgresDnsLink]
}

// pg_trgm (required) and pgcrypto (used when present).
resource postgresExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'azure.extensions'
  properties: {
    value: 'PG_TRGM,PGCRYPTO'
    source: 'user-override'
  }
}

// The app's identity is an Entra admin (member of azure_pg_admin: CREATEROLE),
// so it runs the migrations and owns the schema.
module postgresAppAdmin 'modules/postgres-admin.bicep' = {
  name: 'postgres-admin-app'
  params: {
    serverName: postgres.name
    objectId: identity.properties.principalId
    principalName: identity.name
    principalType: 'ServicePrincipal'
    tenantId: tenantId
  }
  dependsOn: [postgresExtensions]
}

module postgresHumanAdmin 'modules/postgres-admin.bicep' = if (!empty(postgresAdminObjectId)) {
  name: 'postgres-admin-extra'
  params: {
    serverName: postgres.name
    objectId: postgresAdminObjectId
    principalName: postgresAdminName
    principalType: postgresAdminType
    tenantId: tenantId
  }
  dependsOn: [postgresAppAdmin]
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: databaseName
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
  dependsOn: [postgresAppAdmin]
}

// ── Storage ──────────────────────────────────────────────────────────────────

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'st${name}${suffix}'
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_ZRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowSharedKeyAccess: false // Entra ID (managed identity) only
    allowBlobPublicAccess: false // files are served through the app's /files route
    defaultToOAuthAuthentication: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 7 }
    containerDeleteRetentionPolicy: { enabled: true, days: 7 }
  }
}

resource containers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [
  for bucket in buckets: {
    parent: blobService
    name: '${bucketPrefix}${bucket}'
    properties: { publicAccess: 'None' }
  }
]

resource blobContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, identity.id, roles.storageBlobDataContributor)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.storageBlobDataContributor)
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Signed URLs are user-delegation SAS.
resource blobDelegator 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, identity.id, roles.storageBlobDelegator)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.storageBlobDelegator)
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Key Vault ────────────────────────────────────────────────────────────────

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-${name}-${suffix}'
  location: location
  tags: tags
  properties: {
    tenantId: tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 30
    enablePurgeProtection: true
  }
}

resource vaultSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, identity.id, roles.keyVaultSecretsUser)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.keyVaultSecretsUser)
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource encryptionKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'encryption-key'
  properties: { value: encryptionKey, contentType: 'ENCRYPTION_KEY' }
}

resource cronSecretSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'cron-secret'
  properties: { value: cronSecret, contentType: 'CRON_SECRET' }
}

// ── Email ────────────────────────────────────────────────────────────────────

resource emailService 'Microsoft.Communication/emailServices@2023-04-01' = {
  name: 'ecs-${name}-${suffix}'
  location: 'global'
  tags: tags
  properties: { dataLocation: communicationDataLocation }
}

// Azure-managed sender domain (<guid>.azurecomm.net). Add a custom domain for
// production mail and change EMAIL_FROM.
resource emailDomain 'Microsoft.Communication/emailServices/domains@2023-04-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  tags: tags
  properties: {
    domainManagement: 'AzureManaged'
    userEngagementTracking: 'Disabled'
  }
}

resource communication 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: 'acs-${name}-${suffix}'
  location: 'global'
  tags: tags
  properties: {
    dataLocation: communicationDataLocation
    linkedDomains: [emailDomain.id]
  }
}

// docs/infrastructure.md: Contributor, or a narrower custom role that allows sending.
resource communicationSender 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: communication
  name: guid(communication.id, identity.id, roles.contributor)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.contributor)
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Registry ─────────────────────────────────────────────────────────────────

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'acr${name}${suffix}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource registryPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, identity.id, roles.acrPull)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.acrPull)
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Container Apps ───────────────────────────────────────────────────────────

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${name}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: appsSubnet.id
      internal: false
    }
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
  }
}

var effectiveAppUrl = empty(appUrl) ? 'https://${appName}.${environment.properties.defaultDomain}' : appUrl
var image = '${registry.properties.loginServer}/usertasks:${imageTag}'

// Shared by the web app and the migration job.
var dbEnv = [
  { name: 'DB_PROVIDER', value: 'postgres' }
  { name: 'DATABASE_URL', value: 'postgresql://${identity.name}@${postgres.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require' }
  // Entra token for https://ossrdbms-aad.database.windows.net/.default via DefaultAzureCredential.
  { name: 'DATABASE_AUTH', value: 'azure' }
  // DefaultAzureCredential picks the user-assigned identity by client id.
  { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
]

var appEnvAll = concat(dbEnv, [
  { name: 'DEPLOYMENT_MODE', value: 'self_hosted' }
  { name: 'APP_URL', value: effectiveAppUrl }
  { name: 'INSTANCE_ADMIN_EMAILS', value: instanceAdminEmails }
  { name: 'AUTH_PROVIDER', value: authProvider }
  { name: 'AUTH_SSO_PROVIDERS', value: authSsoProviders }
  { name: 'REALTIME_PROVIDER', value: 'sse' }
  { name: 'SCHEDULER_PROVIDER', value: 'external' }
  { name: 'STORAGE_PROVIDER', value: 'azure_blob' }
  { name: 'AZURE_STORAGE_ACCOUNT', value: storage.name }
  { name: 'STORAGE_BUCKET_PREFIX', value: bucketPrefix }
  { name: 'EMAIL_PROVIDER', value: 'azure_communication' }
  { name: 'EMAIL_FROM', value: 'DoNotReply@${emailDomain.properties.mailFromSenderDomain}' }
  { name: 'ACS_EMAIL_ENDPOINT', value: 'https://${communication.properties.hostName}' }
  { name: 'SECRETS_PROVIDER', value: 'azure_key_vault' }
  { name: 'AZURE_KEY_VAULT_URL', value: vault.properties.vaultUri }
  // Resolved by the app from Key Vault at startup (fails closed if unreadable).
  { name: 'ENCRYPTION_KEY', value: 'secret://encryption-key' }
  // Shared rate limits / invalidations for every replica: Azure Cache for Redis
  // with an Entra token for the managed identity, else the postgres cache table.
  { name: 'CACHE_PROVIDER', value: cacheEnabled ? 'redis' : 'postgres' }
  { name: 'CACHE_REDIS_URL', value: cacheEnabled ? 'rediss://${redis!.properties.hostName}:${redis!.properties.sslPort}' : '' }
  { name: 'CACHE_REDIS_AUTH', value: cacheEnabled ? 'entra' : '' }
  { name: 'CACHE_REDIS_USERNAME', value: cacheEnabled ? identity.properties.principalId : '' }
])
var appEnv = concat(filter(appEnvAll, e => !empty(e.value)), [
  // Key Vault reference resolved by the platform.
  { name: 'CRON_SECRET', secretRef: 'cron-secret' }
])

var cronSecretRef = {
  name: 'cron-secret'
  keyVaultUrl: '${vault.properties.vaultUri}secrets/cron-secret'
  identity: identity.id
}

resource web 'Microsoft.App/containerApps@2024-03-01' = if (deployApps) {
  name: appName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        traffic: [{ latestRevision: true, weight: 100 }]
      }
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
      secrets: [cronSecretRef]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: image
          resources: { cpu: json(appCpu), memory: appMemory }
          env: appEnv
          probes: [
            { type: 'Startup', tcpSocket: { port: 3000 }, failureThreshold: 10 }
            { type: 'Liveness', tcpSocket: { port: 3000 } }
          ]
        }
      ]
      scale: { minReplicas: appMinReplicas, maxReplicas: appMaxReplicas }
    }
  }
  dependsOn: [registryPull, vaultSecretsUser, blobContributor, cronSecretSecret, encryptionKeySecret, database, redisAccess, redisEndpointDns]
}

// Per-minute scheduler tick (SCHEDULER_PROVIDER=external) with the cron secret.
resource tick 'Microsoft.App/jobs@2024-03-01' = if (deployApps) {
  name: '${name}-tick'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 120
      replicaRetryLimit: 0
      scheduleTriggerConfig: { cronExpression: '* * * * *', parallelism: 1, replicaCompletionCount: 1 }
      secrets: [cronSecretRef]
    }
    template: {
      containers: [
        {
          name: 'tick'
          image: 'docker.io/curlimages/curl:8.10.1'
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          command: ['/bin/sh', '-c']
          args: ['curl -fsS --max-time 90 -X POST -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/tick"']
          env: [
            { name: 'APP_URL', value: effectiveAppUrl }
            { name: 'CRON_SECRET', secretRef: 'cron-secret' }
          ]
        }
      ]
    }
  }
  dependsOn: [vaultSecretsUser, cronSecretSecret]
}

// One-shot migrations: az containerapp job start -n <name>-migrate -g <rg>
resource migrate 'Microsoft.App/jobs@2024-03-01' = if (deployApps) {
  name: '${name}-migrate'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 1800
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: image
          resources: { cpu: json('0.5'), memory: '1Gi' }
          command: ['node', 'admin.cjs', 'db', 'migrate']
          env: dbEnv
        }
      ]
    }
  }
  dependsOn: [registryPull, database]
}

output appUrl string = effectiveAppUrl
output registryLoginServer string = registry.properties.loginServer
output migrateJobName string = '${name}-migrate'
output postgresFqdn string = postgres.properties.fullyQualifiedDomainName
output databaseUser string = identity.name
output managedIdentityClientId string = identity.properties.clientId
output keyVaultUri string = vault.properties.vaultUri
output storageAccount string = storage.name
output cacheHostName string = cacheEnabled ? redis!.properties.hostName : ''
output emailFrom string = 'DoNotReply@${emailDomain.properties.mailFromSenderDomain}'
