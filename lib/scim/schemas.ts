import { CORE_GROUP_SCHEMA, CORE_USER_SCHEMA, ENTERPRISE_USER_SCHEMA } from './filter'

/**
 * SCIM discovery documents (RFC 7643 §5–7, RFC 7644 §4): what the endpoint
 * supports — PATCH and filtering yes; bulk, sorting and password change no;
 * ETags (weak, on Users and Groups) yes.
 */

export const LIST_RESPONSE_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse'
export const SPC_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'
export const RESOURCE_TYPE_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:ResourceType'
export const SCHEMA_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Schema'

export const MAX_FILTER_RESULTS = 1000
export const DEFAULT_PAGE_SIZE = 100

const meta = (baseUrl: string, resourceType: string, path: string) => ({ resourceType, location: `${baseUrl}/${path}` })

export function serviceProviderConfig(baseUrl: string, docsUrl: string) {
  return {
    schemas: [SPC_SCHEMA],
    documentationUri: docsUrl,
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: MAX_FILTER_RESULTS },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: true },
    authenticationSchemes: [{
      type: 'oauthbearertoken',
      name: 'Bearer token',
      description: 'A workspace SCIM token from Settings → SSO & Directory → SCIM, sent as Authorization: Bearer <token>.',
      documentationUri: docsUrl,
      primary: true,
    }],
    meta: meta(baseUrl, 'ServiceProviderConfig', 'ServiceProviderConfig'),
  }
}

export function resourceTypes(baseUrl: string) {
  return [
    {
      schemas: [RESOURCE_TYPE_SCHEMA],
      id: 'User',
      name: 'User',
      endpoint: '/Users',
      description: 'Workspace member',
      schema: CORE_USER_SCHEMA,
      schemaExtensions: [{ schema: ENTERPRISE_USER_SCHEMA, required: false }],
      meta: meta(baseUrl, 'ResourceType', 'ResourceTypes/User'),
    },
    {
      schemas: [RESOURCE_TYPE_SCHEMA],
      id: 'Group',
      name: 'Group',
      endpoint: '/Groups',
      description: 'Team',
      schema: CORE_GROUP_SCHEMA,
      meta: meta(baseUrl, 'ResourceType', 'ResourceTypes/Group'),
    },
  ]
}

type AttributeDef = Record<string, unknown>

function attribute(name: string, options: Partial<{
  type: string; multiValued: boolean; required: boolean; caseExact: boolean; mutability: string; returned: string; uniqueness: string
  subAttributes: AttributeDef[]; description: string; referenceTypes: string[]
}> = {}): AttributeDef {
  return {
    name,
    type: options.type ?? 'string',
    multiValued: options.multiValued ?? false,
    description: options.description ?? name,
    required: options.required ?? false,
    caseExact: options.caseExact ?? false,
    mutability: options.mutability ?? 'readWrite',
    returned: options.returned ?? 'default',
    uniqueness: options.uniqueness ?? 'none',
    ...(options.subAttributes ? { subAttributes: options.subAttributes } : {}),
    ...(options.referenceTypes ? { referenceTypes: options.referenceTypes } : {}),
  }
}

const multiValue = (name: string, extra: AttributeDef[] = []) => attribute(name, {
  type: 'complex',
  multiValued: true,
  subAttributes: [attribute('value'), attribute('display'), attribute('type'), attribute('primary', { type: 'boolean' }), ...extra],
})

export function schemas(baseUrl: string) {
  return [
    {
      schemas: [SCHEMA_SCHEMA],
      id: CORE_USER_SCHEMA,
      name: 'User',
      description: 'User account',
      attributes: [
        attribute('userName', { required: true, uniqueness: 'server' }),
        attribute('name', {
          type: 'complex',
          subAttributes: ['formatted', 'familyName', 'givenName', 'middleName', 'honorificPrefix', 'honorificSuffix'].map((n) => attribute(n)),
        }),
        attribute('displayName'),
        attribute('nickName'),
        attribute('title'),
        attribute('userType'),
        attribute('preferredLanguage'),
        attribute('locale'),
        attribute('timezone'),
        attribute('active', { type: 'boolean' }),
        attribute('password', { mutability: 'writeOnly', returned: 'never' }),
        multiValue('emails'),
        multiValue('phoneNumbers'),
        multiValue('addresses', ['formatted', 'streetAddress', 'locality', 'region', 'postalCode', 'country'].map((n) => attribute(n))),
        attribute('groups', {
          type: 'complex', multiValued: true, mutability: 'readOnly', returned: 'never',
          subAttributes: [attribute('value', { mutability: 'readOnly' }), attribute('display', { mutability: 'readOnly' })],
        }),
      ],
      meta: meta(baseUrl, 'Schema', `Schemas/${CORE_USER_SCHEMA}`),
    },
    {
      schemas: [SCHEMA_SCHEMA],
      id: ENTERPRISE_USER_SCHEMA,
      name: 'EnterpriseUser',
      description: 'Enterprise user',
      attributes: [
        ...['employeeNumber', 'costCenter', 'organization', 'division', 'department'].map((n) => attribute(n)),
        attribute('manager', { type: 'complex', subAttributes: [attribute('value'), attribute('$ref', { type: 'reference', referenceTypes: ['User'] }), attribute('displayName', { mutability: 'readOnly' })] }),
      ],
      meta: meta(baseUrl, 'Schema', `Schemas/${ENTERPRISE_USER_SCHEMA}`),
    },
    {
      schemas: [SCHEMA_SCHEMA],
      id: CORE_GROUP_SCHEMA,
      name: 'Group',
      description: 'Group (a team in UserTasks)',
      attributes: [
        attribute('displayName', { required: true }),
        attribute('members', {
          type: 'complex',
          multiValued: true,
          subAttributes: [
            attribute('value', { mutability: 'immutable' }),
            attribute('display', { mutability: 'readOnly' }),
            attribute('$ref', { type: 'reference', mutability: 'immutable', referenceTypes: ['User'] }),
            attribute('type', { mutability: 'immutable' }),
          ],
        }),
      ],
      meta: meta(baseUrl, 'Schema', `Schemas/${CORE_GROUP_SCHEMA}`),
    },
  ]
}

export function listResponse(resources: unknown[], totalResults: number, startIndex: number) {
  return { schemas: [LIST_RESPONSE_SCHEMA], totalResults, startIndex, itemsPerPage: resources.length, Resources: resources }
}
