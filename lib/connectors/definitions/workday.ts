import type { ConnectorDefinition, ReferenceTemplate } from '../registry'

/**
 * Workday — HCM & Financials.
 *
 * Workday's public REST API spans ~20 independently-versioned services with
 * hundreds of endpoints, and each service ships new versions every Workday
 * release. This connector covers the FULL surface four ways:
 *
 *   1. WQL (Workday Query Language) — read almost any business object, plus
 *      data-source discovery so you can explore what is queryable.
 *   2. RaaS (Report as a Service) — run any custom report you own as JSON.
 *   3. Verified per-service shortcuts — one-click actions for the most common
 *      endpoints across Core HCM (Common), Absence, Time Tracking, Recruiting,
 *      Talent & Performance, Compensation, and Payroll. Paths and versions were
 *      taken from the Workday REST API directory / published OpenAPI specs.
 *   4. Universal REST passthrough — GET/POST/PUT/PATCH/DELETE against any
 *      /ccx/api/{service}/{version}/{tenant}/{resource} route, so every other
 *      documented endpoint (any service, any version) is still reachable.
 *
 * Base URL is the tenant's data-centre host; the Workday tenant name is passed
 * per call because it sits mid-path in Workday's REST routes.
 *
 * Reference: https://community.workday.com/sites/default/files/file-hosting/restapi/index.html
 */

// ── Reusable input fragments ──────────────────────────────────────────────
const TENANT = { name: 'tenant', type: 'string', required: true, description: 'Workday tenant name' }
const WORKER = { name: 'worker_id', type: 'string', required: true, description: 'Worker WID or employee ID' }
const ID = (desc: string) => ({ name: 'id', type: 'string', required: true, description: desc })
const LIMIT = { name: 'limit', type: 'number', required: false, description: 'Max rows to return', defaultValue: '100' }
const OFFSET = { name: 'offset', type: 'number', required: false, description: 'Rows to skip (pagination)', defaultValue: '0' }
const BODY = { name: 'body_json', type: 'string', required: true, description: 'JSON request body' }
const LIST_OUT = [{ name: 'total', type: 'number' }, { name: 'data', type: 'array' }]
const OBJ_OUT = [{ name: 'data', type: 'object' }]
const PAGED = '?limit={{limit}}&offset={{offset}}'

type Input = { name: string; type: string; required: boolean; description: string; defaultValue?: string }

// ── Template builders (keep the large per-service catalog maintainable) ────
function apiPath(service: string, version: string, resource: string) {
  return `/ccx/api/${service}/${version}/{{tenant}}/${resource}`
}
function listT(key: string, name: string, description: string, service: string, version: string, resource: string, extra: Input[] = []): ReferenceTemplate {
  return {
    key, name, description, method: 'GET',
    pathTemplate: apiPath(service, version, resource) + PAGED,
    inputs: [TENANT, ...extra, LIMIT, OFFSET],
    outputs: LIST_OUT,
  }
}
function getT(key: string, name: string, description: string, service: string, version: string, resource: string, extra: Input[] = []): ReferenceTemplate {
  return {
    key, name, description, method: 'GET',
    pathTemplate: apiPath(service, version, resource),
    inputs: [TENANT, ...extra],
    outputs: OBJ_OUT,
  }
}
function writeT(method: string, key: string, name: string, description: string, service: string, version: string, resource: string, extra: Input[] = []): ReferenceTemplate {
  const t: ReferenceTemplate = {
    key, name, description, method,
    pathTemplate: apiPath(service, version, resource),
    inputs: method === 'DELETE' ? [TENANT, ...extra] : [TENANT, ...extra, BODY],
    outputs: method === 'DELETE' ? [{ name: 'status', type: 'number' }] : OBJ_OUT,
  }
  if (method !== 'DELETE') {
    t.headers = { 'Content-Type': 'application/json' }
    t.bodyTemplate = '{{body_json}}'
  }
  return t
}

// Service versions confirmed from the Workday REST API directory / OpenAPI specs.
const COMMON = 'v1', ABSENCE = 'v4', TIME = 'v4', RECRUITING = 'v4', PERF = 'v5', TALENT = 'v2', COMP = 'v1', PAYROLL = 'v2'

const referenceTemplates: ReferenceTemplate[] = [
  // ═══════════════════════════ WQL — read anything ═══════════════════════════
  {
    key: 'wql_query',
    name: 'WQL Query',
    description: 'Run a Workday Query Language (WQL) query — read almost any business object',
    method: 'GET',
    pathTemplate: '/ccx/api/wql/v1/{{tenant}}/data?query={{query}}&limit={{limit}}&offset={{offset}}',
    inputs: [
      TENANT,
      { name: 'query', type: 'string', required: true, description: 'WQL query, e.g. SELECT workdayID, fullName FROM allActiveEmployees' },
      { name: 'limit', type: 'number', required: false, description: 'Max rows (1–10000)', defaultValue: '100' },
      OFFSET,
    ],
    outputs: LIST_OUT,
  },
  listT('wql_data_sources', 'WQL: List Data Sources', 'Discover the data sources (business objects) you can query with WQL', 'wql', 'v1', 'dataSources',
    [{ name: 'alias', type: 'string', required: false, description: 'Filter by data source alias (contains)' }]),
  listT('wql_data_source_fields', 'WQL: List Data Source Fields', 'List the queryable fields of a WQL data source', 'wql', 'v1', 'dataSources/{{data_source_id}}/dataSourceFields',
    [{ name: 'data_source_id', type: 'string', required: true, description: 'Data source WID (from List Data Sources)' }]),

  // ═══════════════════════════ RaaS — any custom report ══════════════════════
  {
    key: 'run_custom_report',
    name: 'Run Custom Report (RaaS)',
    description: 'Run a custom report enabled as a web service (Report as a Service) and return JSON',
    method: 'GET',
    pathTemplate: '/ccx/service/customreport2/{{tenant}}/{{report_owner}}/{{report_name}}?format=json&{{query_string}}',
    inputs: [
      TENANT,
      { name: 'report_owner', type: 'string', required: true, description: 'Report owner (ISU or user) the report is shared as' },
      { name: 'report_name', type: 'string', required: true, description: 'Custom report name (web service alias)' },
      { name: 'query_string', type: 'string', required: false, description: 'Extra report prompts, e.g. Worker!WID=abc&Effective_as_of_Date=2026-01-01' },
    ],
    outputs: [{ name: 'Report_Entry', type: 'array' }],
  },

  // ═══════════════════ Core HCM — Common API (workers, orgs, jobs) ════════════
  listT('get_workers', 'Common: Get Workers', 'List workers with current staffing information', 'common', COMMON, 'workers'),
  getT('get_worker', 'Common: Get Worker', 'Get a single worker by Workday ID (WID) or employee ID', 'common', COMMON, 'workers/{{worker_id}}', [WORKER]),
  listT('get_direct_reports', 'Common: Get Direct Reports', "Get a worker's direct reports", 'common', COMMON, 'workers/{{worker_id}}/reports', [WORKER]),
  listT('get_worker_organizations', 'Common: Get Worker Organizations', "Get the organizations a worker belongs to", 'common', COMMON, 'workers/{{worker_id}}/organizations', [WORKER]),
  listT('get_worker_history', 'Common: Get Worker History', "Get a worker's staffing history items", 'common', COMMON, 'workers/{{worker_id}}/history', [WORKER]),
  listT('get_worker_payslips', 'Common: Get Worker Pay Slips', "Get a worker's pay slips", 'common', COMMON, 'workers/{{worker_id}}/paySlips', [WORKER]),
  writeT('POST', 'create_job_change', 'Common: Create Job Change', 'Start a job change (promotion, transfer, etc.) for a worker', 'common', COMMON, 'workers/{{worker_id}}/jobChanges', [WORKER]),
  writeT('POST', 'change_business_title', 'Common: Change Business Title', "Change a worker's business title", 'common', COMMON, 'workers/{{worker_id}}/businessTitleChanges', [WORKER]),
  listT('get_organizations', 'Common: Get Organizations', 'List organizations (departments, cost centers, supervisory orgs)', 'common', COMMON, 'organizations'),
  listT('get_supervisory_orgs', 'Common: Get Supervisory Organizations', 'List supervisory organizations', 'common', COMMON, 'supervisoryOrganizations'),
  listT('get_supervisory_org_workers', 'Common: Get Org Members', 'List the workers in a supervisory organization', 'common', COMMON, 'supervisoryOrganizations/{{id}}/workers', [ID('Supervisory organization WID')]),
  listT('get_job_change_reasons', 'Common: Get Job Change Reasons', 'List available job change reasons', 'common', COMMON, 'jobChangeReasons'),

  // ═══════════════════════════ Absence Management ═════════════════════════════
  listT('get_eligible_absence_types', 'Absence: Get Eligible Absence Types', "List a worker's eligible absence/time-off types", 'absenceManagement', ABSENCE, 'workers/{{worker_id}}/eligibleAbsenceTypes', [WORKER]),
  getT('get_absence_balance', 'Absence: Get Absence Balance', "Get a worker's absence-plan and leave balances", 'absenceManagement', ABSENCE, 'workers/{{worker_id}}/absenceBalance', [WORKER]),
  listT('get_time_off_details', 'Absence: Get Time Off Details', "Get a worker's time-off detail entries", 'absenceManagement', ABSENCE, 'workers/{{worker_id}}/timeOffDetails', [WORKER]),
  writeT('POST', 'request_time_off', 'Absence: Request Time Off', 'Create a time-off request for a worker and start the business process', 'absenceManagement', ABSENCE, 'workers/{{worker_id}}/requestTimeOff', [WORKER]),

  // ═══════════════════════════ Time Tracking ══════════════════════════════════
  {
    key: 'get_time_clock_events',
    name: 'Time Tracking: Get Time Clock Events',
    description: 'Retrieve time clock (check-in/out) events, filterable by worker and date',
    method: 'GET',
    pathTemplate: '/ccx/api/timeTracking/' + TIME + '/{{tenant}}/timeClockEvents?worker={{worker_id}}&fromDate={{from_date}}&toDate={{to_date}}&limit={{limit}}&offset={{offset}}',
    inputs: [
      TENANT,
      { name: 'worker_id', type: 'string', required: false, description: 'Worker WID to filter by' },
      { name: 'from_date', type: 'string', required: false, description: 'Start date (YYYY-MM-DD)' },
      { name: 'to_date', type: 'string', required: false, description: 'End date (YYYY-MM-DD)' },
      LIMIT, OFFSET,
    ],
    outputs: LIST_OUT,
  },
  writeT('POST', 'create_time_clock_event', 'Time Tracking: Create Time Clock Event', 'Record a clock-in or clock-out for a worker', 'timeTracking', TIME, 'timeClockEvents'),
  writeT('PUT', 'update_time_clock_event', 'Time Tracking: Update Time Clock Event', 'Update an existing time clock event', 'timeTracking', TIME, 'timeClockEvents/{{id}}', [ID('Time clock event WID')]),
  writeT('DELETE', 'delete_time_clock_event', 'Time Tracking: Delete Time Clock Event', 'Delete a time clock event', 'timeTracking', TIME, 'timeClockEvents/{{id}}', [ID('Time clock event WID')]),

  // ═══════════════════════════ Recruiting ═════════════════════════════════════
  listT('get_job_postings', 'Recruiting: Get Job Postings', 'List job postings with titles, locations, and status', 'recruiting', RECRUITING, 'jobPostings'),
  getT('get_job_posting', 'Recruiting: Get Job Posting', 'Get a single job posting by ID', 'recruiting', RECRUITING, 'jobPostings/{{id}}', [ID('Job posting WID')]),
  listT('get_prospects', 'Recruiting: Get Prospects', 'List recruiting prospects (candidates) with status and source', 'recruiting', RECRUITING, 'prospects'),
  getT('get_prospect', 'Recruiting: Get Prospect', 'Get a single prospect (candidate) by ID', 'recruiting', RECRUITING, 'prospects/{{id}}', [ID('Prospect WID')]),

  // ═══════════════════════ Talent & Performance ═══════════════════════════════
  listT('get_feedback_badges', 'Performance: Get Feedback Badges', 'List feedback badges available in the tenant', 'performanceEnablement', PERF, 'feedbackBadges'),
  listT('get_requested_feedback', 'Performance: Get Requested Feedback', 'List give-requested-feedback events', 'performanceEnablement', PERF, 'giveRequestedFeedbackEvents'),
  writeT('POST', 'give_requested_feedback', 'Performance: Give Requested Feedback', 'Submit a requested-feedback response', 'performanceEnablement', PERF, 'giveRequestedFeedbackEvents'),
  listT('get_mentorships', 'Talent: Get Mentorships', 'List mentorship relationships', 'talentManagement', TALENT, 'mentorships'),
  listT('get_succession_plan_events', 'Talent: Get Succession Plan Events', 'List succession plan events', 'talentManagement', TALENT, 'successionPlanEvents'),

  // ═══════════════════════════ Compensation ═══════════════════════════════════
  writeT('POST', 'request_one_time_payment', 'Compensation: Request One-Time Payment', 'Request a one-time payment for a worker', 'compensation', COMP, 'workers/{{worker_id}}/oneTimePayments', [WORKER]),
  listT('get_compensation_scorecards', 'Compensation: Get Scorecards', 'List compensation scorecards', 'compensation', COMP, 'compensationScorecards'),

  // ═══════════════════════════ Payroll ════════════════════════════════════════
  listT('get_pay_groups', 'Payroll: Get Pay Groups', 'List payroll pay groups', 'payroll', PAYROLL, 'payGroups'),
  listT('get_payroll_inputs', 'Payroll: Get Payroll Inputs', 'List payroll inputs', 'payroll', PAYROLL, 'payrollInputs'),
  writeT('POST', 'create_payroll_input', 'Payroll: Create Payroll Input', 'Create a payroll input', 'payroll', PAYROLL, 'payrollInputs'),
  writeT('PATCH', 'update_payroll_input', 'Payroll: Update Payroll Input', 'Partially update a payroll input', 'payroll', PAYROLL, 'payrollInputs/{{id}}', [ID('Payroll input WID')]),
  listT('get_pay_components', 'Payroll: Get Pay Components', 'List valid pay component values', 'payroll', PAYROLL, 'values/payComponents'),

  // ═══════════ Universal passthrough — reaches EVERY service/endpoint ═════════
  {
    key: 'rest_get',
    name: 'REST: GET (any endpoint)',
    description: 'GET any Workday REST endpoint. Covers every service/version not wrapped by a shortcut above (e.g. benefits, learning, businessProcess, connect, additional recruiting/talent endpoints).',
    method: 'GET',
    pathTemplate: '/ccx/api/{{service}}/{{version}}/{{tenant}}/{{resource}}?{{query_string}}',
    inputs: [
      { name: 'service', type: 'string', required: true, description: 'Service, e.g. staffing, benefits, learning, businessProcess, connect' },
      { name: 'version', type: 'string', required: true, description: 'Service version, e.g. v6 (see the Workday REST API directory for the current version)', defaultValue: 'v1' },
      TENANT,
      { name: 'resource', type: 'string', required: false, description: 'Resource path after the tenant, e.g. workers/{id}/jobs' },
      { name: 'query_string', type: 'string', required: false, description: 'Raw query string, e.g. limit=100&offset=0&search=smith' },
    ],
    outputs: OBJ_OUT,
  },
  {
    key: 'rest_post',
    name: 'REST: POST (any endpoint)',
    description: 'POST to any write-enabled Workday REST endpoint (create / business-process actions) not wrapped above.',
    method: 'POST',
    pathTemplate: '/ccx/api/{{service}}/{{version}}/{{tenant}}/{{resource}}',
    headers: { 'Content-Type': 'application/json' },
    bodyTemplate: '{{body_json}}',
    inputs: [
      { name: 'service', type: 'string', required: true, description: 'Service' },
      { name: 'version', type: 'string', required: true, description: 'Service version, e.g. v6', defaultValue: 'v1' },
      TENANT,
      { name: 'resource', type: 'string', required: false, description: 'Resource path after the tenant' },
      BODY,
    ],
    outputs: OBJ_OUT,
  },
  {
    key: 'rest_put',
    name: 'REST: PUT (any endpoint)',
    description: 'PUT (replace) to any write-enabled Workday REST endpoint not wrapped above.',
    method: 'PUT',
    pathTemplate: '/ccx/api/{{service}}/{{version}}/{{tenant}}/{{resource}}',
    headers: { 'Content-Type': 'application/json' },
    bodyTemplate: '{{body_json}}',
    inputs: [
      { name: 'service', type: 'string', required: true, description: 'Service' },
      { name: 'version', type: 'string', required: true, description: 'Service version, e.g. v6', defaultValue: 'v1' },
      TENANT,
      { name: 'resource', type: 'string', required: true, description: 'Resource path after the tenant' },
      BODY,
    ],
    outputs: OBJ_OUT,
  },
  {
    key: 'rest_patch',
    name: 'REST: PATCH (any endpoint)',
    description: 'PATCH (partial update) any write-enabled Workday REST endpoint not wrapped above.',
    method: 'PATCH',
    pathTemplate: '/ccx/api/{{service}}/{{version}}/{{tenant}}/{{resource}}',
    headers: { 'Content-Type': 'application/json' },
    bodyTemplate: '{{body_json}}',
    inputs: [
      { name: 'service', type: 'string', required: true, description: 'Service' },
      { name: 'version', type: 'string', required: true, description: 'Service version, e.g. v6', defaultValue: 'v1' },
      TENANT,
      { name: 'resource', type: 'string', required: true, description: 'Resource path after the tenant' },
      BODY,
    ],
    outputs: OBJ_OUT,
  },
  {
    key: 'rest_delete',
    name: 'REST: DELETE (any endpoint)',
    description: 'DELETE any Workday REST resource that supports removal, not wrapped above.',
    method: 'DELETE',
    pathTemplate: '/ccx/api/{{service}}/{{version}}/{{tenant}}/{{resource}}',
    inputs: [
      { name: 'service', type: 'string', required: true, description: 'Service' },
      { name: 'version', type: 'string', required: true, description: 'Service version, e.g. v6', defaultValue: 'v1' },
      TENANT,
      { name: 'resource', type: 'string', required: true, description: 'Resource path after the tenant' },
    ],
    outputs: [{ name: 'status', type: 'number' }],
  },
]

export const workdayConnector: ConnectorDefinition = {
  key: 'workday',
  name: 'Workday',
  description:
    'HCM and Financials — full REST coverage with verified shortcuts for Core HCM, Absence, Time Tracking, Recruiting, Talent & Performance, Compensation, and Payroll, plus WQL, RaaS custom reports, and a universal passthrough for every other Workday endpoint',
  category: 'productivity',
  icon: 'Briefcase',
  color: '#0071CE',
  docsUrl: 'https://community.workday.com/sites/default/files/file-hosting/restapi/index.html',
  recommendedPermissions: {
    title: 'Workday setup',
    items: [
      'Register an API Client (OAuth 2.0) or Integration System User (ISU) in your Workday tenant',
      'Grant the client/ISU a security group with Get/View (and Put, for writes) access to the domains you will call — e.g. Worker Data, Organizations, Time Tracking, Absence, Recruiting, Compensation, Payroll',
      'Enable the REST API services you need in the API Client scopes (Common, WQL, Absence Management, Time Tracking, Recruiting, Performance Enablement, Talent Management, Compensation, Payroll)',
      'Note your data-centre host and tenant name from Workday Setup',
    ],
    note: 'Service versions vary by Workday release; the shortcuts use the versions published in the REST API directory, and the universal passthrough lets you override the version for any endpoint.',
  },
  fields: [
    {
      key: 'host',
      label: 'Host',
      type: 'text',
      placeholder: 'wd2-impl-services1.workday.com',
      required: true,
      helpText: 'Your Workday data-centre host (without https://). Find it in the URL you use to sign in.',
    },
    {
      key: 'default_tenant',
      label: 'Tenant (reference)',
      type: 'text',
      placeholder: 'acme_pilot',
      helpText: 'Your Workday tenant name — shown here for reference; pass it as the "tenant" input on each call.',
    },
  ],
  credentialFields: [
    {
      key: 'auth_type',
      label: 'Authentication Type',
      type: 'select',
      options: [
        { value: 'bearer', label: 'OAuth 2.0 Bearer Token (recommended)' },
        { value: 'basic', label: 'Basic Auth (ISU username / password)' },
      ],
      required: true,
      defaultValue: 'bearer',
    },
    {
      key: 'access_token',
      label: 'OAuth 2.0 Access Token',
      type: 'password',
      visibleWhen: { field: 'auth_type', equals: 'bearer' },
      requiredWhen: { field: 'auth_type', equals: 'bearer' },
      helpText: 'Bearer token from your Workday OAuth 2.0 API client. Use a refresh token to renew it automatically.',
    },
    {
      key: 'refresh_token',
      label: 'Refresh Token (optional)',
      type: 'password',
      visibleWhen: { field: 'auth_type', equals: 'bearer' },
      helpText: 'OAuth refresh token used to renew the access token automatically.',
    },
    {
      key: 'username',
      label: 'ISU Username',
      type: 'text',
      placeholder: 'integration_user@tenant',
      visibleWhen: { field: 'auth_type', equals: 'basic' },
      requiredWhen: { field: 'auth_type', equals: 'basic' },
      helpText: 'Integration System User in user@tenant format.',
    },
    {
      key: 'password',
      label: 'ISU Password',
      type: 'password',
      visibleWhen: { field: 'auth_type', equals: 'basic' },
      requiredWhen: { field: 'auth_type', equals: 'basic' },
    },
  ],
  referenceTemplates,
  buildIntegrationConfig: (config, credentials) => {
    const host = String(config.host || '')
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '')
    const baseUrl = `https://${host}`
    if (credentials.auth_type === 'basic') {
      return {
        base_url: baseUrl,
        auth_type: 'basic',
        auth_config: {
          username: credentials.username || '',
          password: credentials.password || '',
        },
      }
    }
    return {
      base_url: baseUrl,
      auth_type: 'bearer',
      auth_config: {
        token: credentials.access_token || credentials.token || '',
        refresh_token: credentials.refresh_token || '',
      },
    }
  },
}
