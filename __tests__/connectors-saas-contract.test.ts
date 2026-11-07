import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }))
const jwt = vi.hoisted(() => ({ calls: [] as any[] }))
vi.mock('google-auth-library', () => ({
  JWT: class {
    constructor(public opts: any) { jwt.calls.push(opts) }
    async authorize() { return { access_token: 'ya29.fake-google-token', expiry_date: Date.now() + 3_600_000 } }
  },
}))

import { getConnectorDefinition } from '@/lib/connectors/registry'
import { runConnectorProbe } from '@/lib/connectors/test-probes'
import { runConnectorPreflight } from '@/lib/connectors/preflight'
import { clearMintedTokenCache } from '@/lib/integrations/token-mint'
import { assertNoSecretInUrls, runConnectorTemplate, type RecordedRequest } from './helpers/connector-contract'

/**
 * Contract tests for the CRM / ERP / HR / ITSM, messaging, payments and AI
 * connectors: every template's request as actually sent by the runtime
 * (method, URL, key headers, body), plus the tricky cases — escaping, empty
 * optional params, paging, refresh-token mints, idempotency keys, SAP CSRF,
 * binary downloads, stored-config upgrades, credential probes and preflight.
 */

const SAAS = ['salesforce', 'servicenow', 'jira', 'workday', 'ukg_pro', 'sap_odata', 'n8n', 'slack', 'twilio', 'sendgrid', 'stripe', 'mercury', 'openai', 'claude', 'deepseek', 'groq', 'mistral', 'perplexity', 'together', 'ollama']

const CONFIG: Record<string, Record<string, any>> = {
  salesforce: { instance_url: 'https://acme.my.salesforce.com' },
  servicenow: { instance: 'acme' },
  jira: { domain: 'acme.atlassian.net' },
  workday: { host: 'wd2-impl-services1.workday.com', tenant: 'acme_pilot' },
  ukg_pro: { service_host: 'service4.ultipro.com', customer_api_key: 'FAKE-CUSTOMER-KEY' },
  sap_odata: { base_url: 'https://sap.example.com/sap/opu/odata/sap/API_BP', sap_client: '100' },
  docusign: { account_id: 'acct-fake-0001', base_url: 'https://demo.docusign.net/restapi', api_base_url: '' },
  n8n: { base_url: 'https://n8n.example.com' },
  slack: { channel: 'C0DEFAULT' },
  twilio: { from_number: '+15005550006' },
  sendgrid: { from_email: 'noreply@example.com', from_name: 'Example' },
  ollama: { base_url: 'https://ollama.example.com' },
}

const CREDENTIALS: Record<string, Record<string, any>> = {
  salesforce: { access_token: 'sf-fake-token', client_id: '', client_secret: '', refresh_token: '' },
  servicenow: { auth_type: 'basic', username: 'svc', password: 'fake-pass', client_id: '', refresh_token: '' },
  jira: { email: 'bot@example.com', api_token: 'fake-jira-token' },
  workday: { auth_type: 'bearer', access_token: 'wd-fake-token', client_id: '', client_secret: '', refresh_token: '', token_url: '' },
  ukg_pro: { username: 'svc', password: 'fake-pass' },
  sap_odata: { auth_type: 'basic', username: 'svc', password: 'fake-pass' },
  docusign: { access_token: 'ds-fake-token', client_id: '', client_secret: '', refresh_token: '' },
  n8n: { api_key: 'fake-n8n-key' },
  slack: { bot_token: 'xoxb-fake' },
  twilio: { account_sid: 'ACfake0000000000000000000000000000', auth_token: 'fake-auth-token', api_key_sid: '', api_key_secret: '' },
  sendgrid: { api_key: 'SG.fake' },
  stripe: { secret_key: 'sk_test_FAKE' },
  mercury: { api_token: 'secret-token:mercury_fake' },
  ollama: { api_key: '' },
}

const SAMPLE: Record<string, unknown> = {
  record_json: { Name: 'Acme' },
  update_json: { fields: { summary: 'x' } },
  fields_json: { project: { key: 'P' }, summary: 'S', issuetype: { name: 'Bug' } },
  entity_json: { Name: 'A' },
  blocks_json: [{ type: 'divider' }],
  body_json: { a: 1 },
  length: 10,
  amount: 100.5,
  path: '/personnel/v1/org-levels',
  query: 'SELECT Id FROM Account',
  jql: 'project = P',
}

const NEXT_LINKS: Record<string, string> = {
  'salesforce.query_more': '/services/data/v66.0/query/01gFAKE-2000',
  'sap_odata.get_next_page': 'https://sap.example.com/sap/opu/odata/sap/API_BP/Partners?$skiptoken=10',
  'slack.upload_file_bytes': 'https://files.slack.com/upload/v1/FAKEUPLOAD',
}

function requiredInputs(connector: string, template: string): Record<string, unknown> {
  const t = getConnectorDefinition(connector)!.referenceTemplates.find((x) => x.key === template)!
  const out: Record<string, unknown> = {}
  for (const i of t.inputs) if (i.required) out[i.name] = SAMPLE[i.name] ?? `v-${i.name.replace(/_/g, '-')}`
  const next = NEXT_LINKS[`${connector}.${template}`]
  if (next) out.next_link = next
  return out
}

/** SAP answers the CSRF prefetch with a token + session cookie. */
function sapRespond(req: RecordedRequest): Response {
  if (req.method === 'GET') {
    return new Response('', { status: 200, headers: { 'x-csrf-token': 'csrf-fake-token', 'set-cookie': 'SAP_SESSIONID_FAKE=abc; path=/' } })
  }
  return Response.json({ d: { ok: true } })
}

function run(connector: string, template: string, opts: { inputs?: Record<string, unknown>; credentials?: Record<string, any>; config?: Record<string, any>; respond?: (r: RecordedRequest) => Response | Promise<Response>; mutateReference?: (ref: Record<string, any>) => void; legacyIntegration?: boolean } = {}) {
  return runConnectorTemplate({
    connector,
    template,
    config: { ...(CONFIG[connector] ?? {}), ...(opts.config ?? {}) },
    credentials: { ...(CREDENTIALS[connector] ?? {}), ...(opts.credentials ?? {}) },
    inputs: { ...requiredInputs(connector, template), ...(opts.inputs ?? {}) },
    respond: opts.respond ?? (connector === 'sap_odata' ? sapRespond : undefined),
    mutateReference: opts.mutateReference,
    legacyIntegration: opts.legacyIntegration,
  })
}

type Expect = [method: string, url: string, body?: unknown]
const SF = 'https://acme.my.salesforce.com/services/data/v66.0'
const SN = 'https://acme.service-now.com/api/now'
const JI = 'https://acme.atlassian.net/rest/api'
const WD = 'https://wd2-impl-services1.workday.com/ccx/api'
const UKG = 'https://service4.ultipro.com'
const SAP = 'https://sap.example.com/sap/opu/odata/sap/API_BP'
const N8N = 'https://n8n.example.com/api/v1'
const SL = 'https://slack.com/api'
const TW = 'https://api.twilio.com/2010-04-01/Accounts/ACfake0000000000000000000000000000'
const ST = 'https://api.stripe.com/v1'
const MC = 'https://backend.mercury.com/api/v1'
const CHAT = (model: string, max: number, temperature: number) => ({
  model, messages: [{ role: 'system', content: 'You are a helpful assistant.' }, { role: 'user', content: 'v-user-message' }], max_tokens: max, temperature,
})

/** Every template with only its required inputs (sample values). Body: parsed JSON, a string, or undefined (no body check). */
const EXPECTED: Record<string, Record<string, Expect>> = {
  salesforce: {
    soql_query: ['GET', `${SF}/query/?q=SELECT%20Id%20FROM%20Account`],
    query_more: ['GET', 'https://acme.my.salesforce.com/services/data/v66.0/query/01gFAKE-2000'],
    list_records: ['GET', `${SF}/query/?q=SELECT Id,%20Name FROM v-object-type  ORDER BY Id LIMIT 100`],
    get_record: ['GET', `${SF}/sobjects/v-object-type/v-record-id`],
    create_record: ['POST', `${SF}/sobjects/v-object-type/`, { Name: 'Acme' }],
    update_record: ['PATCH', `${SF}/sobjects/v-object-type/v-record-id`, { Name: 'Acme' }],
    upsert_record: ['PATCH', `${SF}/sobjects/v-object-type/v-external-id-field/v-external-id`, { Name: 'Acme' }],
    delete_record: ['DELETE', `${SF}/sobjects/v-object-type/v-record-id`],
    bulk_query: ['POST', `${SF}/jobs/query`, { operation: 'query', query: 'SELECT Id FROM Account' }],
    bulk_query_status: ['GET', `${SF}/jobs/query/v-job-id`],
    bulk_query_results: ['GET', `${SF}/jobs/query/v-job-id/results?maxRecords=50000`],
    bulk_ingest: ['POST', `${SF}/jobs/ingest`, { object: 'v-object-type', operation: 'v-operation', contentType: 'CSV', lineEnding: 'LF' }],
    bulk_upload_data: ['PUT', `${SF}/jobs/ingest/v-job-id/batches`, 'v-csv-data'],
    bulk_close_job: ['PATCH', `${SF}/jobs/ingest/v-job-id`, { state: 'UploadComplete' }],
    bulk_job_status: ['GET', `${SF}/jobs/ingest/v-job-id`],
    bulk_get_results: ['GET', `${SF}/jobs/ingest/v-job-id/v-result-type/`],
  },
  servicenow: {
    query_table: ['GET', `${SN}/table/v-table?sysparm_limit=100&sysparm_offset=0&sysparm_display_value=true&sysparm_exclude_reference_link=true`],
    get_record: ['GET', `${SN}/table/v-table/v-sys-id?sysparm_display_value=true`],
    create_record: ['POST', `${SN}/table/v-table`, { Name: 'Acme' }],
    update_record: ['PATCH', `${SN}/table/v-table/v-sys-id`, { Name: 'Acme' }],
    delete_record: ['DELETE', `${SN}/table/v-table/v-sys-id`],
    create_incident: ['POST', `${SN}/table/incident`, { short_description: 'v-short-description', urgency: 2, impact: 2 }],
    resolve_incident: ['PATCH', `${SN}/table/incident/v-sys-id`, { state: '6', close_code: 'Solved (Permanently)', close_notes: 'v-close-notes' }],
    add_work_note: ['PATCH', `${SN}/table/incident/v-sys-id`, { work_notes: 'v-note' }],
    add_comment: ['PATCH', `${SN}/table/incident/v-sys-id`, { comments: 'v-comment' }],
    upload_attachment: ['POST', `${SN}/attachment/file?table_name=v-table&table_sys_id=v-sys-id&file_name=v-file-name`, 'v-content'],
    aggregate: ['GET', `${SN}/stats/v-table?sysparm_count=true`],
  },
  jira: {
    search_issues: ['GET', `${JI}/3/search/jql?jql=project%20%3D%20P&fields=summary,status,assignee,priority,created,updated&maxResults=50`],
    count_issues: ['POST', `${JI}/3/search/approximate-count`, { jql: 'project = P' }],
    get_issue: ['GET', `${JI}/3/issue/v-issue-key`],
    create_issue: ['POST', `${JI}/2/issue`, { fields: { project: { key: 'v-project-key' }, summary: 'v-summary', issuetype: { name: 'Task' } } }],
    create_issue_fields: ['POST', `${JI}/2/issue`, { fields: { project: { key: 'P' }, summary: 'S', issuetype: { name: 'Bug' } } }],
    update_issue: ['PUT', `${JI}/3/issue/v-issue-key`, { fields: { summary: 'x' } }],
    transition_issue: ['POST', `${JI}/3/issue/v-issue-key/transitions`, { transition: { id: 'v-transition-id' } }],
    get_transitions: ['GET', `${JI}/3/issue/v-issue-key/transitions`],
    delete_issue: ['DELETE', `${JI}/3/issue/v-issue-key?deleteSubtasks=false`],
    add_comment: ['POST', `${JI}/2/issue/v-issue-key/comment`, { body: 'v-comment' }],
    assign_issue: ['PUT', `${JI}/3/issue/v-issue-key/assignee`, { accountId: 'v-account-id' }],
    list_projects: ['GET', `${JI}/3/project/search?maxResults=50&startAt=0`],
    search_users: ['GET', `${JI}/3/user/search?query=SELECT%20Id%20FROM%20Account&maxResults=20&startAt=0`],
    add_attachment: ['POST', `${JI}/3/issue/v-issue-key/attachments`],
  },
  workday: {
    wql_query: ['GET', `${WD}/wql/v1/acme_pilot/data?query=SELECT%20Id%20FROM%20Account&limit=100&offset=0`],
    wql_data_sources: ['GET', `${WD}/wql/v1/acme_pilot/dataSources?limit=100&offset=0`],
    wql_data_source_fields: ['GET', `${WD}/wql/v1/acme_pilot/dataSources/v-data-source-id/dataSourceFields?limit=100&offset=0`],
    run_custom_report: ['GET', 'https://wd2-impl-services1.workday.com/ccx/service/customreport2/acme_pilot/v-report-owner/v-report-name?format=json'],
    get_workers: ['GET', `${WD}/common/v1/acme_pilot/workers?limit=100&offset=0`],
    get_worker: ['GET', `${WD}/common/v1/acme_pilot/workers/v-worker-id`],
    get_direct_reports: ['GET', `${WD}/common/v1/acme_pilot/workers/v-worker-id/reports?limit=100&offset=0`],
    get_worker_organizations: ['GET', `${WD}/common/v1/acme_pilot/workers/v-worker-id/organizations?limit=100&offset=0`],
    get_worker_history: ['GET', `${WD}/common/v1/acme_pilot/workers/v-worker-id/history?limit=100&offset=0`],
    get_worker_payslips: ['GET', `${WD}/common/v1/acme_pilot/workers/v-worker-id/paySlips?limit=100&offset=0`],
    create_job_change: ['POST', `${WD}/common/v1/acme_pilot/workers/v-worker-id/jobChanges`, { a: 1 }],
    change_business_title: ['POST', `${WD}/common/v1/acme_pilot/workers/v-worker-id/businessTitleChanges`, { a: 1 }],
    get_organizations: ['GET', `${WD}/common/v1/acme_pilot/organizations?limit=100&offset=0`],
    get_supervisory_orgs: ['GET', `${WD}/common/v1/acme_pilot/supervisoryOrganizations?limit=100&offset=0`],
    get_supervisory_org_workers: ['GET', `${WD}/common/v1/acme_pilot/supervisoryOrganizations/v-id/workers?limit=100&offset=0`],
    get_job_change_reasons: ['GET', `${WD}/common/v1/acme_pilot/jobChangeReasons?limit=100&offset=0`],
    get_eligible_absence_types: ['GET', `${WD}/absenceManagement/v4/acme_pilot/workers/v-worker-id/eligibleAbsenceTypes?limit=100&offset=0`],
    get_absence_balance: ['GET', `${WD}/absenceManagement/v4/acme_pilot/workers/v-worker-id/absenceBalance`],
    get_time_off_details: ['GET', `${WD}/absenceManagement/v4/acme_pilot/workers/v-worker-id/timeOffDetails?limit=100&offset=0`],
    request_time_off: ['POST', `${WD}/absenceManagement/v4/acme_pilot/workers/v-worker-id/requestTimeOff`, { a: 1 }],
    get_time_clock_events: ['GET', `${WD}/timeTracking/v4/acme_pilot/timeClockEvents?limit=100&offset=0`],
    create_time_clock_event: ['POST', `${WD}/timeTracking/v4/acme_pilot/timeClockEvents`, { a: 1 }],
    update_time_clock_event: ['PUT', `${WD}/timeTracking/v4/acme_pilot/timeClockEvents/v-id`, { a: 1 }],
    delete_time_clock_event: ['DELETE', `${WD}/timeTracking/v4/acme_pilot/timeClockEvents/v-id`],
    get_job_postings: ['GET', `${WD}/recruiting/v4/acme_pilot/jobPostings?limit=100&offset=0`],
    get_job_posting: ['GET', `${WD}/recruiting/v4/acme_pilot/jobPostings/v-id`],
    get_prospects: ['GET', `${WD}/recruiting/v4/acme_pilot/prospects?limit=100&offset=0`],
    get_prospect: ['GET', `${WD}/recruiting/v4/acme_pilot/prospects/v-id`],
    get_feedback_badges: ['GET', `${WD}/performanceEnablement/v5/acme_pilot/feedbackBadges?limit=100&offset=0`],
    get_requested_feedback: ['GET', `${WD}/performanceEnablement/v5/acme_pilot/giveRequestedFeedbackEvents?limit=100&offset=0`],
    give_requested_feedback: ['POST', `${WD}/performanceEnablement/v5/acme_pilot/giveRequestedFeedbackEvents`, { a: 1 }],
    get_mentorships: ['GET', `${WD}/talentManagement/v2/acme_pilot/mentorships?limit=100&offset=0`],
    get_succession_plan_events: ['GET', `${WD}/talentManagement/v2/acme_pilot/successionPlanEvents?limit=100&offset=0`],
    request_one_time_payment: ['POST', `${WD}/compensation/v1/acme_pilot/workers/v-worker-id/oneTimePayments`, { a: 1 }],
    get_compensation_scorecards: ['GET', `${WD}/compensation/v1/acme_pilot/compensationScorecards?limit=100&offset=0`],
    get_pay_groups: ['GET', `${WD}/payroll/v2/acme_pilot/payGroups?limit=100&offset=0`],
    get_payroll_inputs: ['GET', `${WD}/payroll/v2/acme_pilot/payrollInputs?limit=100&offset=0`],
    create_payroll_input: ['POST', `${WD}/payroll/v2/acme_pilot/payrollInputs`, { a: 1 }],
    update_payroll_input: ['PATCH', `${WD}/payroll/v2/acme_pilot/payrollInputs/v-id`, { a: 1 }],
    get_pay_components: ['GET', `${WD}/payroll/v2/acme_pilot/values/payComponents?limit=100&offset=0`],
    rest_get: ['GET', `${WD}/v-service/v-version/acme_pilot/`],
    rest_post: ['POST', `${WD}/v-service/v-version/acme_pilot/`, { a: 1 }],
    rest_put: ['PUT', `${WD}/v-service/v-version/acme_pilot/v-resource`, { a: 1 }],
    rest_patch: ['PATCH', `${WD}/v-service/v-version/acme_pilot/v-resource`, { a: 1 }],
    rest_delete: ['DELETE', `${WD}/v-service/v-version/acme_pilot/v-resource`],
  },
  ukg_pro: {
    get_employee: ['GET', `${UKG}/personnel/v1/employee-details/v-employee-id`],
    employee_changes: ['GET', `${UKG}/personnel/v1/employee-changes?startDate=v-start-date&page=1&per_page=100`],
    search_employees: ['GET', `${UKG}/personnel/v1/employee-details?v-query-params`],
    employment_details: ['GET', `${UKG}/personnel/v1/employment-details/v-employee-id`],
    compensation_details: ['GET', `${UKG}/personnel/v1/compensation-details/v-employee-id`],
    benefit_details: ['GET', `${UKG}/personnel/v1/benefit-details/v-employee-id`],
    org_levels: ['GET', `${UKG}/personnel/v1/org-levels`],
    pay_statements: ['GET', `${UKG}/personnel/v1/pay-statements?employeeId=v-employee-id&page=1&per_page=20`],
    timesheets: ['GET', `${UKG}/time-management/v1/timesheets?startDate=v-start-date&endDate=v-end-date&page=1&per_page=100`],
    time_off_requests: ['GET', `${UKG}/time-management/v1/time-off-requests?startDate=v-start-date&endDate=v-end-date`],
    raw_request: ['GET', `${UKG}/personnel/v1/org-levels`],
  },
  sap_odata: {
    get_metadata: ['GET', `${SAP}/$metadata`],
    get_service_document: ['GET', `${SAP}/`],
    query_entity_set: ['GET', `${SAP}/v-entity-set?$top=100&$skip=0&$inlinecount=allpages&$format=json`],
    query_entity_set_v4: ['GET', `${SAP}/v-entity-set?$top=100&$skip=0&$count=true`],
    get_next_page: ['GET', `${SAP}/Partners?$skiptoken=10`],
    get_entity: ['GET', `${SAP}/v-entity-set(v-key)?$format=json`],
    count_entities: ['GET', `${SAP}/v-entity-set/$count`],
    query_navigation: ['GET', `${SAP}/v-entity-set(v-key)/v-navigation?$top=100&$format=json`],
    create_entity: ['POST', `${SAP}/v-entity-set`, { Name: 'A' }],
    deep_insert: ['POST', `${SAP}/v-entity-set`, { Name: 'A' }],
    update_entity: ['PATCH', `${SAP}/v-entity-set(v-key)`, { Name: 'A' }],
    replace_entity: ['PUT', `${SAP}/v-entity-set(v-key)`, { Name: 'A' }],
    delete_entity: ['DELETE', `${SAP}/v-entity-set(v-key)`],
    call_function_import: ['GET', `${SAP}/v-function-name?$format=json`],
    call_action_import: ['POST', `${SAP}/v-function-name`, {}],
    batch_request: ['POST', `${SAP}/$batch`, 'v-batch-body'],
    raw_request: ['GET', `${SAP}/personnel/v1/org-levels`],
  },
  n8n: {
    list_workflows: ['GET', `${N8N}/workflows?limit=50`],
    get_workflow: ['GET', `${N8N}/workflows/v-workflow-id`],
    activate_workflow: ['POST', `${N8N}/workflows/v-workflow-id/activate`],
    deactivate_workflow: ['POST', `${N8N}/workflows/v-workflow-id/deactivate`],
    get_execution: ['GET', `${N8N}/executions/v-execution-id?includeData=false`],
    list_executions: ['GET', `${N8N}/executions?limit=20`],
    delete_execution: ['DELETE', `${N8N}/executions/v-execution-id`],
    retry_execution: ['POST', `${N8N}/executions/v-execution-id/retry`, {}],
    list_credentials: ['GET', `${N8N}/credentials?limit=50`],
  },
  slack: {
    send_message: ['POST', `${SL}/chat.postMessage`, { channel: 'C0DEFAULT', text: 'v-message', unfurl_links: true }],
    send_block_message: ['POST', `${SL}/chat.postMessage`, { channel: 'C0DEFAULT', text: 'v-fallback-text', blocks: [{ type: 'divider' }] }],
    update_message: ['POST', `${SL}/chat.update`, { channel: 'v-channel', ts: 'v-ts', text: 'v-message' }],
    delete_message: ['POST', `${SL}/chat.delete`, { channel: 'v-channel', ts: 'v-ts' }],
    get_thread: ['GET', `${SL}/conversations.replies?channel=v-channel&ts=v-thread-ts&limit=100`],
    send_dm: ['POST', `${SL}/chat.postMessage`, { channel: 'v-user-id', text: 'v-message' }],
    add_reaction: ['POST', `${SL}/reactions.add`, { channel: 'v-channel', timestamp: 'v-ts', name: 'v-emoji' }],
    list_channels: ['GET', `${SL}/conversations.list?types=public_channel,private_channel&limit=200&exclude_archived=true`],
    get_channel_history: ['GET', `${SL}/conversations.history?channel=v-channel&limit=50`],
    set_channel_topic: ['POST', `${SL}/conversations.setTopic`, { channel: 'v-channel', topic: 'v-topic' }],
    list_users: ['GET', `${SL}/users.list?limit=200`],
    get_user_info: ['GET', `${SL}/users.info?user=v-user-id`],
    lookup_by_email: ['GET', `${SL}/users.lookupByEmail?email=v-email`],
    search_messages: ['GET', `${SL}/search.messages?query=SELECT%20Id%20FROM%20Account&count=20&page=1&sort=score&sort_dir=desc`],
    get_upload_url: ['GET', `${SL}/files.getUploadURLExternal?filename=v-filename&length=10`],
    upload_file_bytes: ['POST', 'https://files.slack.com/upload/v1/FAKEUPLOAD', 'v-file'],
    complete_upload: ['POST', `${SL}/files.completeUploadExternal`, { files: [{ id: 'v-file-id' }], channel_id: 'C0DEFAULT' }],
  },
  twilio: {
    send_sms: ['POST', `${TW}/Messages.json`, 'To=v-to-number&From=%2B15005550006&Body=v-message'],
    get_message: ['GET', `${TW}/Messages/v-message-sid.json`],
    list_messages: ['GET', `${TW}/Messages.json?PageSize=50`],
    make_call: ['POST', `${TW}/Calls.json`, 'To=v-to-number&From=%2B15005550006'],
    get_call: ['GET', `${TW}/Calls/v-call-sid.json`],
    send_verification: ['POST', 'https://verify.twilio.com/v2/Services/v-verify-service-sid/Verifications', 'To=v-to-number&Channel=sms'],
    check_verification: ['POST', 'https://verify.twilio.com/v2/Services/v-verify-service-sid/VerificationCheck', 'To=v-to-number&Code=v-code'],
    lookup_number: ['GET', 'https://lookups.twilio.com/v2/PhoneNumbers/v-phone-number?Fields=line_type_intelligence'],
  },
  sendgrid: {
    send_email: ['POST', 'https://api.sendgrid.com/v3/mail/send', { personalizations: [{ to: [{ email: 'v-to-email' }] }], from: { email: 'noreply@example.com', name: 'Example' }, subject: 'v-subject', content: [{ type: 'text/html', value: 'v-body' }] }],
    send_template_email: ['POST', 'https://api.sendgrid.com/v3/mail/send', { personalizations: [{ to: [{ email: 'v-to-email' }] }], from: { email: 'noreply@example.com', name: 'Example' }, template_id: 'v-template-id' }],
  },
  stripe: {
    create_payment_intent: ['POST', `${ST}/payment_intents`, 'amount=100.5&currency=v-currency&automatic_payment_methods[enabled]=true'],
    get_payment_intent: ['GET', `${ST}/payment_intents/v-payment-intent-id`],
    create_customer: ['POST', `${ST}/customers`, 'email=v-email'],
    get_customer: ['GET', `${ST}/customers/v-customer-id`],
    update_customer: ['POST', `${ST}/customers/v-customer-id`, 'v-update-fields'],
    list_customers: ['GET', `${ST}/customers?limit=25`],
    create_subscription: ['POST', `${ST}/subscriptions`, 'customer=v-customer-id&items[0][price]=v-price-id'],
    cancel_subscription: ['DELETE', `${ST}/subscriptions/v-subscription-id`],
    cancel_subscription_at_period_end: ['POST', `${ST}/subscriptions/v-subscription-id`, 'cancel_at_period_end=true'],
    get_subscription: ['GET', `${ST}/subscriptions/v-subscription-id`],
    create_invoice: ['POST', `${ST}/invoices`, 'customer=v-customer-id&collection_method=charge_automatically&auto_advance=true'],
    list_invoices: ['GET', `${ST}/invoices?limit=25`],
    create_refund: ['POST', `${ST}/refunds`, 'payment_intent=v-payment-intent-id'],
    list_charges: ['GET', `${ST}/charges?limit=25`],
    list_products: ['GET', `${ST}/products?active=true&limit=25`],
    list_prices: ['GET', `${ST}/prices?active=true&limit=25`],
    get_balance: ['GET', `${ST}/balance`],
  },
  mercury: {
    list_accounts: ['GET', `${MC}/accounts`],
    get_account: ['GET', `${MC}/account/v-account-id`],
    get_account_cards: ['GET', `${MC}/account/v-account-id/cards`],
    list_transactions: ['GET', `${MC}/account/v-account-id/transactions?limit=500&offset=0`],
    get_transaction: ['GET', `${MC}/account/v-account-id/transaction/v-transaction-id`],
    create_transaction: ['POST', `${MC}/account/v-account-id/transactions`, { recipientId: 'v-recipient-id', amount: 100.5, paymentMethod: 'v-payment-method', idempotencyKey: 'v-idempotency-key' }],
    request_send_money: ['POST', `${MC}/account/v-account-id/request-send-money`, { recipientId: 'v-recipient-id', amount: 100.5, paymentMethod: 'v-payment-method', idempotencyKey: 'v-idempotency-key' }],
    get_statements: ['GET', `${MC}/account/v-account-id/statements`],
    list_recipients: ['GET', `${MC}/recipients`],
    get_recipient: ['GET', `${MC}/recipient/v-recipient-id`],
    add_recipient: ['POST', `${MC}/recipients`, { name: 'v-name', emails: ['v-email'], defaultPaymentMethod: 'electronic', electronicRoutingInfo: { accountNumber: 'v-account-number', routingNumber: 'v-routing-number', electronicAccountType: 'v-account-type' } }],
    update_recipient: ['POST', `${MC}/recipient/v-recipient-id`, {}],
    get_treasury: ['GET', `${MC}/treasury`],
  },
  openai: {
    chat_completion: ['POST', 'https://api.openai.com/v1/chat/completions', { model: 'gpt-4.1', messages: [{ role: 'system', content: 'You are a helpful assistant.' }, { role: 'user', content: 'v-user-message' }], max_completion_tokens: 4096 }],
    create_embedding: ['POST', 'https://api.openai.com/v1/embeddings', { model: 'text-embedding-3-small', input: 'v-text' }],
  },
  claude: {
    message: ['POST', 'https://api.anthropic.com/v1/messages', { model: 'claude-opus-5-5', max_tokens: 16000, messages: [{ role: 'user', content: 'v-user-message' }], output_config: { effort: 'medium' } }],
    analyze: ['POST', 'https://api.anthropic.com/v1/messages', { model: 'claude-opus-5-5', max_tokens: 16000, system: 'v-instructions', messages: [{ role: 'user', content: 'v-text' }], output_config: { effort: 'medium' } }],
  },
  deepseek: { chat_completion: ['POST', 'https://api.deepseek.com/chat/completions', CHAT('deepseek-chat', 4096, 1)] },
  groq: { chat_completion: ['POST', 'https://api.groq.com/openai/v1/chat/completions', CHAT('llama-3.3-70b-versatile', 1024, 0.7)] },
  mistral: { chat_completion: ['POST', 'https://api.mistral.ai/v1/chat/completions', CHAT('mistral-large-latest', 1024, 0.7)] },
  perplexity: { chat_completion: ['POST', 'https://api.perplexity.ai/chat/completions', CHAT('sonar-pro', 1024, 0.2)] },
  together: { chat_completion: ['POST', 'https://api.together.xyz/v1/chat/completions', CHAT('meta-llama/Llama-3.3-70B-Instruct-Turbo', 1024, 0.7)] },
  ollama: { chat_completion: ['POST', 'https://ollama.example.com/v1/chat/completions', { model: 'llama3.1', messages: [{ role: 'system', content: 'You are a helpful assistant.' }, { role: 'user', content: 'v-user-message' }], stream: false }] },
}

const AUTH: Record<string, (h: Record<string, string>) => void> = {
  basic: (h) => expect(h.authorization).toBe('Basic ***'),
  bearer: (h) => expect(h.authorization).toBe('Bearer ***'),
}
const AUTH_KIND: Record<string, string> = {
  servicenow: 'basic', jira: 'basic', ukg_pro: 'basic', sap_odata: 'basic', twilio: 'basic',
  salesforce: 'bearer', workday: 'bearer', slack: 'bearer', sendgrid: 'bearer', stripe: 'bearer', mercury: 'bearer',
  openai: 'bearer', deepseek: 'bearer', groq: 'bearer', mistral: 'bearer', perplexity: 'bearer', together: 'bearer',
}

const SECRETS = ['sf-fake-token', 'fake-pass', 'fake-jira-token', 'wd-fake-token', 'ds-fake-token', 'fake-n8n-key', 'xoxb-fake', 'fake-auth-token', 'SG.fake', 'sk_test_FAKE', 'secret-token:mercury_fake', 'FAKE-CUSTOMER-KEY']

afterEach(() => { vi.unstubAllGlobals(); clearMintedTokenCache() })

describe('every template of the CRM / ERP / HR / messaging / payments / AI connectors', () => {
  it('covers exactly this family', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...SAAS].sort())
  })
  for (const [connector, templates] of Object.entries(EXPECTED)) {
    it(`${connector}: the table covers every template`, () => {
      expect(Object.keys(templates).sort()).toEqual(getConnectorDefinition(connector)!.referenceTemplates.map((t) => t.key).sort())
    })
    for (const [template, [method, url, body]] of Object.entries(templates)) {
      it(`${connector}.${template}`, async () => {
        const { call, requests } = await run(connector, template)
        expect(call.method).toBe(method)
        expect(call.url).toBe(url)
        expect(call.url).not.toContain('{{')
        expect(JSON.stringify(call.headers)).not.toContain('{{')
        // No input value is duplicated into the query string.
        const tpl = getConnectorDefinition(connector)!.referenceTemplates.find((t) => t.key === template)!
        for (const name of Object.keys(requiredInputs(connector, template))) {
          if (tpl.pathTemplate.includes(`${name}=`)) continue // a provider parameter of the same name
          expect(new URL(call.url).searchParams.has(name)).toBe(false)
        }
        const kind = AUTH_KIND[connector]
        if (kind) AUTH[kind](call.headers)
        if (body !== undefined) {
          if (typeof body === 'string') expect(call.body).toBe(body)
          else expect(JSON.parse(call.body!)).toEqual(body)
        }
        assertNoSecretInUrls(requests, SECRETS)
      })
    }
  }
})

describe('auth headers', () => {
  it('Anthropic: x-api-key + anthropic-version', async () => {
    const { call } = await run('claude', 'message', { credentials: { api_key: 'sk-ant-fake' } })
    expect(call.headers['x-api-key']).toBe('***')
    expect(call.headers['anthropic-version']).toBe('2023-06-01')
    expect(call.headers.authorization).toBeUndefined()
  })
  it('n8n: X-N8N-API-KEY header, never sent to webhook paths', async () => {
    const { call } = await run('n8n', 'list_workflows')
    expect(call.headers['x-n8n-api-key']).toBe('***')
    for (const t of getConnectorDefinition('n8n')!.referenceTemplates) expect(t.pathTemplate).not.toMatch(/\/webhook/)
  })
  it('UKG Pro: Basic + US-Customer-Api-Key from auth_config (not a plaintext static header)', async () => {
    const { call } = await run('ukg_pro', 'org_levels')
    expect(call.headers['us-customer-api-key']).toBe('***')
    const built = getConnectorDefinition('ukg_pro')!.buildIntegrationConfig(CONFIG.ukg_pro, CREDENTIALS.ukg_pro)
    expect(built.headers ?? {}).toEqual({})
    expect(built.auth_config).toMatchObject({ _executor: 'ukg_pro', customer_api_key: 'FAKE-CUSTOMER-KEY' })
  })
  it('UKG Pro: a stored config with the legacy plaintext header is upgraded on read', () => {
    const upgrade = getConnectorDefinition('ukg_pro')!.upgradeIntegrationConfig!
    const stored = { base_url: 'https://service4.ultipro.com', auth_type: 'basic', auth_config: { username: 'u', password: 'p' }, headers: { 'US-Customer-Api-Key': 'FAKE-LEGACY' } }
    const next = upgrade(stored)
    expect(next.headers).toEqual({})
    expect(next.auth_config).toMatchObject({ _executor: 'ukg_pro', customer_api_key: 'FAKE-LEGACY', username: 'u' })
    expect(upgrade(next)).toEqual(next)
  })
  it('Twilio: an API key replaces the Auth Token as Basic credentials', async () => {
    const def = getConnectorDefinition('twilio')!
    const built = def.buildIntegrationConfig({}, { account_sid: 'ACfake', auth_token: 'tok', api_key_sid: 'SKfake', api_key_secret: 'sec' })
    expect(built.auth_config).toEqual({ username: 'SKfake', password: 'sec' })
    const { call } = await run('twilio', 'get_message', { credentials: { api_key_sid: 'SKfake', api_key_secret: 'fake-key-secret' } })
    expect(call.url).toContain('/Accounts/ACfake0000000000000000000000000000/')
  })
  it('Ollama: no auth by default, Bearer when an API key is set', async () => {
    expect((await run('ollama', 'chat_completion')).call.headers.authorization).toBeUndefined()
    expect((await run('ollama', 'chat_completion', { credentials: { api_key: 'fake-ollama-key' } })).call.headers.authorization).toBe('Bearer ***')
  })
  it('Stripe pins Stripe-Version on every call', async () => {
    expect((await run('stripe', 'get_balance')).call.headers['stripe-version']).toBe('2025-09-30.clover')
    expect((await run('stripe', 'get_balance', { config: { stripe_version: '2026-01-28.clover' } })).call.headers['stripe-version']).toBe('2026-01-28.clover')
  })
})

describe('refresh-token mints', () => {
  const cases: Array<[string, string, Record<string, any>, Record<string, any>, string]> = [
    ['salesforce', 'soql_query', {}, { client_id: 'cid', client_secret: 'csec', refresh_token: 'rt-fake' }, 'https://acme.my.salesforce.com/services/oauth2/token'],
    ['servicenow', 'query_table', {}, { auth_type: 'bearer', token: 'old', client_id: 'cid', client_secret: 'csec', refresh_token: 'rt-fake' }, 'https://acme.service-now.com/oauth_token.do'],
    ['workday', 'get_workers', {}, { client_id: 'cid', client_secret: 'csec', refresh_token: 'rt-fake' }, 'https://wd2-impl-services1.workday.com/ccx/oauth2/acme_pilot/token'],
  ]
  for (const [connector, template, config, credentials, tokenUrl] of cases) {
    it(`${connector}: refresh grant at ${tokenUrl}`, async () => {
      const seen: RecordedRequest[] = []
      const { requests, call } = await run(connector, template, {
        config, credentials,
        respond: (req) => {
          seen.push(req)
          if (req.url === tokenUrl) return Response.json({ access_token: 'minted-fake', expires_in: 3600 })
          return Response.json({ ok: true })
        },
      })
      const token = requests.find((r) => r.url === tokenUrl)
      expect(token?.method).toBe('POST')
      expect(token?.body).toContain('grant_type=refresh_token')
      expect(token?.body).toContain('refresh_token=rt-fake')
      expect(call.headers.authorization).toBe('Bearer ***')
      expect(requests.indexOf(token!)).toBeLessThan(requests.indexOf(call))
    })
  }
  it('Salesforce without client credentials keeps the static token (stored connectors unchanged)', async () => {
    const built = getConnectorDefinition('salesforce')!.buildIntegrationConfig(CONFIG.salesforce, { access_token: 'tok' })
    expect(built.auth_config).toEqual({ token: 'tok' })
    const { requests } = await run('salesforce', 'soql_query')
    expect(requests).toHaveLength(1)
  })
})

describe('escaping and encoding', () => {
  it('Slack: quotes, newlines and backslashes stay inside the JSON string', async () => {
    const message = 'He said "hi"\nnext line \\ end'
    const { call } = await run('slack', 'send_message', { inputs: { message, channel: 'C1' } })
    expect(JSON.parse(call.body!)).toEqual({ channel: 'C1', text: message, unfurl_links: true })
  })
  it('Slack: a numeric-looking thread_ts stays a string', async () => {
    const { call } = await run('slack', 'send_message', { inputs: { thread_ts: '1712345678.123456' } })
    expect(JSON.parse(call.body!).thread_ts).toBe('1712345678.123456')
  })
  it('Twilio: E.164 "+" and "&" in the body are form-encoded', async () => {
    const { call } = await run('twilio', 'send_sms', { inputs: { to_number: '+447911123456', message: 'Tom & Jerry = 100%' } })
    expect(call.body).toBe('To=%2B447911123456&From=%2B15005550006&Body=Tom%20%26%20Jerry%20%3D%20100%25')
  })
  it('Stripe: "+" in an email and "&" in a description are encoded, empty optionals dropped', async () => {
    const { call } = await run('stripe', 'create_customer', { inputs: { email: 'a+b@example.com', description: 'R&D', phone: '' } })
    expect(call.body).toBe('email=a%2Bb@example.com&description=R%26D')
  })
  it('Jira: JQL with quotes, & and # is one query value', async () => {
    const { call } = await run('jira', 'search_issues', { inputs: { jql: 'summary ~ "A&B #1"' } })
    expect(new URL(call.url).searchParams.get('jql')).toBe('summary ~ "A&B #1"')
    expect([...new URL(call.url).searchParams.keys()]).toEqual(['jql', 'fields', 'maxResults'])
  })
  it('ServiceNow: "&sysparm_limit=" inside the query cannot add parameters', async () => {
    const { call } = await run('servicenow', 'query_table', { inputs: { query: 'active=true&sysparm_limit=99999' } })
    const params = new URL(call.url).searchParams
    expect(params.get('sysparm_query')).toBe('active=true&sysparm_limit=99999')
    expect(params.getAll('sysparm_limit')).toEqual(['100'])
  })
  it('Salesforce: SOQL with quotes and "+" survives encoding', async () => {
    const { call } = await run('salesforce', 'soql_query', { inputs: { query: "SELECT Id FROM Contact WHERE Phone = '+1 555'" } })
    expect(new URL(call.url).searchParams.get('q')).toBe("SELECT Id FROM Contact WHERE Phone = '+1 555'")
  })
  it('SAP: $filter with quotes and & is one value; key path keeps quotes', async () => {
    const { call } = await run('sap_odata', 'query_entity_set', { inputs: { filter: "Name eq 'A&B'" } })
    expect(new URL(call.url).searchParams.get('$filter')).toBe("Name eq 'A&B'")
    const entity = await run('sap_odata', 'get_entity', { inputs: { key: "'1000001'" } })
    expect(entity.call.url).toBe(`${SAP}/v-entity-set('1000001')?$format=json`)
  })
  it('Path inputs cannot traverse to another resource', async () => {
    await expect(run('stripe', 'get_customer', { inputs: { customer_id: '../balance' } })).rejects.toThrow(/relative path segment/)
  })
  it('Mercury: a crafted note cannot override the amount', async () => {
    const { call } = await run('mercury', 'create_transaction', { inputs: { note: '","amount":99999,"x":"' } })
    const body = JSON.parse(call.body!)
    expect(body.amount).toBe(100.5)
    expect(body.note).toBe('","amount":99999,"x":"')
  })
  it('Mercury: bank details travel in the body, never the URL', async () => {
    const { call } = await run('mercury', 'add_recipient', { inputs: { account_number: '000123456789', routing_number: '021000021' } })
    expect(call.url).not.toContain('000123456789')
    expect(call.url).not.toContain('021000021')
  })
})

describe('typed JSON values and empty optionals', () => {
  it('AI providers send numbers, not strings', async () => {
    for (const connector of ['deepseek', 'groq', 'mistral', 'perplexity', 'together']) {
      const { call } = await run(connector, 'chat_completion', { inputs: { max_tokens: '256', temperature: '0.3' } })
      const body = JSON.parse(call.body!)
      expect(body.max_tokens).toBe(256)
      expect(body.temperature).toBe(0.3)
    }
  })
  it('OpenAI: max_completion_tokens; temperature only when given (reasoning models reject it)', async () => {
    const plain = JSON.parse((await run('openai', 'chat_completion', { inputs: { model: 'gpt-5' } })).call.body!)
    expect(plain).not.toHaveProperty('temperature')
    expect(plain).not.toHaveProperty('max_tokens')
    expect(plain.max_completion_tokens).toBe(4096)
    const warm = JSON.parse((await run('openai', 'chat_completion', { inputs: { temperature: 0.2 } })).call.body!)
    expect(warm.temperature).toBe(0.2)
  })
  it('Claude: integer max_tokens, system only when given, no sampling params', async () => {
    const body = JSON.parse((await run('claude', 'message', { inputs: { system_prompt: 'Be brief', max_tokens: '512' } })).call.body!)
    expect(body).toMatchObject({ max_tokens: 512, system: 'Be brief' })
    expect(body).not.toHaveProperty('temperature')
  })
  it('Jira: labels as an array, description only when given', async () => {
    const { call } = await run('jira', 'create_issue', { inputs: { labels: ['ops', 'urgent'], description: 'Line 1\nLine 2' } })
    expect(JSON.parse(call.body!).fields).toMatchObject({ labels: ['ops', 'urgent'], description: 'Line 1\nLine 2' })
  })
  it('Stripe: empty refund amount is omitted (full refund), never amount=0', async () => {
    expect((await run('stripe', 'create_refund')).call.body).toBe('payment_intent=v-payment-intent-id')
    expect((await run('stripe', 'create_refund', { inputs: { amount: 250, reason: 'requested_by_customer' } })).call.body)
      .toBe('payment_intent=v-payment-intent-id&amount=250&reason=requested_by_customer')
  })
  it('Stripe: no empty customer= on a payment intent', async () => {
    const { call } = await run('stripe', 'create_payment_intent', { inputs: { currency: 'eur' } })
    expect(call.body).not.toContain('customer=')
    expect(call.body).not.toMatch(/=(&|$)/)
  })
  it('SendGrid: optional cc / categories / send_at are typed when given', async () => {
    const { call } = await run('sendgrid', 'send_email', { inputs: { cc: [{ email: 'c@example.com' }], categories: ['x'], send_at: 1767225600, to_name: 'Ada' } })
    const body = JSON.parse(call.body!)
    expect(body.personalizations[0]).toEqual({ to: [{ email: 'v-to-email', name: 'Ada' }], cc: [{ email: 'c@example.com' }] })
    expect(body).toMatchObject({ categories: ['x'], send_at: 1767225600 })
  })
  it('SendGrid EU residency uses the EU host', async () => {
    expect((await run('sendgrid', 'send_email', { config: { region: 'eu' } })).call.url).toBe('https://api.eu.sendgrid.com/v3/mail/send')
  })
  it('Twilio: make_call with inline TwiML omits the empty Url', async () => {
    const { call } = await run('twilio', 'make_call', { inputs: { twiml: '<Response><Say>Hi</Say></Response>' } })
    expect(call.body).toBe('To=v-to-number&From=%2B15005550006&Twiml=%3CResponse%3E%3CSay%3EHi%3C/Say%3E%3C/Response%3E')
  })
})

describe('idempotency', () => {
  it('Stripe POSTs carry an Idempotency-Key (generated, or the caller\'s)', async () => {
    const generated = (await run('stripe', 'create_refund')).call.headers['idempotency-key']
    expect(generated).toMatch(/^[0-9a-f-]{36}$/)
    expect((await run('stripe', 'create_refund', { inputs: { idempotency_key: 'refund-inv-42' } })).call.headers['idempotency-key']).toBe('refund-inv-42')
    expect((await run('stripe', 'get_balance')).call.headers['idempotency-key']).toBeUndefined()
    for (const t of getConnectorDefinition('stripe')!.referenceTemplates.filter((x) => x.method === 'POST')) {
      expect(t.headers?.['Idempotency-Key']).toBe('{{idempotency_key}}')
    }
  })
  it('Stripe: a 5xx on a keyed POST is retried with the same key', async () => {
    let n = 0
    const { requests } = await run('stripe', 'create_refund', {
      respond: () => (++n === 1 ? new Response('{"error":{"message":"boom"}}', { status: 503 }) : Response.json({ id: 're_1' })),
    })
    expect(requests).toHaveLength(2)
    expect(requests[0].headers['idempotency-key']).toBe(requests[1].headers['idempotency-key'])
  })
  it('Mercury sends require an idempotencyKey input', () => {
    for (const key of ['create_transaction', 'request_send_money']) {
      const t = getConnectorDefinition('mercury')!.referenceTemplates.find((x) => x.key === key)!
      expect(t.inputs.find((i) => i.name === 'idempotency_key')?.required).toBe(true)
    }
  })
})

describe('paging', () => {
  it('Salesforce nextRecordsUrl is followed on the instance host only', async () => {
    const { call } = await run('salesforce', 'query_more')
    expect(call.url).toBe('https://acme.my.salesforce.com/services/data/v66.0/query/01gFAKE-2000')
    await expect(run('salesforce', 'query_more', { inputs: { next_link: 'https://evil.example.com/services/data/x' } })).rejects.toThrow(/own host/)
  })
  it('Twilio next_page_uri (relative) replaces the list URL', async () => {
    const next = '/2010-04-01/Accounts/ACfake0000000000000000000000000000/Messages.json?PageSize=50&Page=1&PageToken=PAfake'
    const { call } = await run('twilio', 'list_messages', { inputs: { next_link: next } })
    expect(call.url).toBe(`https://api.twilio.com${next}`)
  })
  it('Jira search pages with nextPageToken', async () => {
    const { call } = await run('jira', 'search_issues', { inputs: { next_page_token: 'tok/+=' } })
    expect(new URL(call.url).searchParams.get('nextPageToken')).toBe('tok/+=')
  })
  it('Slack list methods take a cursor', async () => {
    for (const t of ['list_channels', 'list_users', 'get_channel_history', 'get_thread']) {
      const { call } = await run('slack', t, { inputs: { cursor: 'dXNlcjpVMEc5V0ZYTlo=' } })
      expect(new URL(call.url).searchParams.get('cursor')).toBe('dXNlcjpVMEc5V0ZYTlo=')
    }
  })
  it('Stripe lists take starting_after', async () => {
    for (const t of ['list_customers', 'list_invoices', 'list_charges', 'list_products', 'list_prices']) {
      const { call } = await run('stripe', t, { inputs: { starting_after: 'obj_123' } })
      expect(new URL(call.url).searchParams.get('starting_after')).toBe('obj_123')
    }
  })
  it('n8n lists take a cursor', async () => {
    for (const t of ['list_workflows', 'list_executions', 'list_credentials']) {
      const { call } = await run('n8n', t, { inputs: { cursor: 'c1' } })
      expect(new URL(call.url).searchParams.get('cursor')).toBe('c1')
    }
  })
})

describe('connector settings fill templates', () => {
  it('Twilio sid / from, SendGrid sender, Workday tenant, Slack channel come from the connector', async () => {
    expect((await run('workday', 'get_workers', { inputs: { tenant: 'acme_prod' } })).call.url).toContain('/common/v1/acme_prod/')
  })
  it('a Salesforce API version override is honoured', async () => {
    expect((await run('salesforce', 'get_record', { config: { api_version: 'v62.0' } })).call.url).toContain('/services/data/v62.0/')
    expect((await run('salesforce', 'get_record', { inputs: { api_version: 'v60.0' } })).call.url).toContain('/services/data/v60.0/')
  })
  it('ServiceNow custom domains are kept', async () => {
    expect((await run('servicenow', 'get_record', { config: { instance: 'itsm.example.com' } })).call.url).toMatch(/^https:\/\/itsm\.example\.com\/api\/now\//)
  })
})

describe('SAP OData CSRF', () => {
  it('writes prefetch a token with a GET and send it back with the session cookie', async () => {
    const { requests, call } = await run('sap_odata', 'create_entity')
    expect(requests).toHaveLength(2)
    expect(requests[0].method).toBe('GET')
    expect(requests[0].headers['x-csrf-token']).toBeDefined()
    expect(call.method).toBe('POST')
    expect(call.headers['x-csrf-token']).toBe('***')
    expect(call.headers.cookie).toBe('***')
    expect(call.headers['sap-client']).toBe('100')
  })
  it('reads never prefetch', async () => {
    expect((await run('sap_odata', 'query_entity_set')).requests).toHaveLength(1)
  })
  it('stored configs with the static "x-csrf-token: fetch" header are upgraded on read', () => {
    const upgrade = getConnectorDefinition('sap_odata')!.upgradeIntegrationConfig!
    const next = upgrade({ base_url: SAP, auth_type: 'basic', auth_config: { username: 'u' }, headers: { 'sap-client': '100', 'x-csrf-token': 'fetch' } })
    expect(next.headers).toEqual({ 'sap-client': '100' })
    expect(next.auth_config).toEqual({ username: 'u', _csrf: 'fetch' })
    expect(upgrade(next)).toEqual(next)
  })
  it('raw requests take their method from the input', async () => {
    const { call } = await run('sap_odata', 'raw_request', { inputs: { method: 'PATCH', path: '/Partners(1)', body: { Name: 'x' } } })
    expect(call.method).toBe('PATCH')
    expect(call.url).toBe(`${SAP}/Partners(1)`)
    expect(JSON.parse(call.body!)).toEqual({ Name: 'x' })
  })
})

describe('responses', () => {
  it('Slack ok:false surfaces as an error message', async () => {
    const { result } = await run('slack', 'send_message', { respond: () => Response.json({ ok: false, error: 'channel_not_found' }) })
    expect(result.error_message).toBe('channel_not_found')
  })
  it('Salesforce bulk CSV results are returned as text', async () => {
    const { result } = await run('salesforce', 'bulk_query_results', { respond: () => new Response('"Id"\n"001"\n', { headers: { 'content-type': 'text/csv' } }) })
    expect((result.data as any)._raw).toBe('"Id"\n"001"\n')
  })
})

describe('removed / unsupported operations', () => {
  it('no Slack files.upload, no n8n run-now, no UKG SOAP BI', () => {
    const paths = (k: string) => getConnectorDefinition(k)!.referenceTemplates.map((t) => t.pathTemplate)
    expect(paths('slack')).not.toContain('/files.upload')
    expect(paths('n8n')).not.toContain('/api/v1/executions')
    expect(paths('ukg_pro').some((p) => /BIDataService|authentication/i.test(p))).toBe(false)
    expect(paths('jira').some((p) => /\/rest\/api\/3\/search\?|\/app\//.test(p))).toBe(false)
  })
  it('SAP no longer offers client-certificate auth (it sent no credentials)', () => {
    const authField = getConnectorDefinition('sap_odata')!.credentialFields.find((f) => f.key === 'auth_type')!
    expect(authField.options!.map((o) => o.value)).toEqual(['basic', 'bearer'])
  })
})

// ─── Test-connection probes ───

function stubFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input)
    calls.push({ url, init })
    return handler(url, init)
  }))
  return calls
}

function probe(connector: string, config: Record<string, any> = {}, credentials: Record<string, any> = {}) {
  const def = getConnectorDefinition(connector)!
  const cfg = { ...(CONFIG[connector] ?? {}), ...config }
  const creds = { ...(CREDENTIALS[connector] ?? {}), ...credentials }
  return runConnectorProbe(connector, cfg, creds, def.buildIntegrationConfig(cfg, creds) as any)
}

describe('test-connection probes check credentials, not just reachability', () => {
  const cases: Array<[string, string, Record<string, any>?]> = [
    ['stripe', 'https://api.stripe.com/v1/balance'],
    ['twilio', 'https://api.twilio.com/2010-04-01/Accounts/ACfake0000000000000000000000000000.json'],
    ['mercury', 'https://backend.mercury.com/api/v1/accounts'],
    ['docusign', 'https://demo.docusign.net/restapi/v2.1/accounts/acct-fake-0001'],
    ['ukg_pro', 'https://service4.ultipro.com/personnel/v1/org-levels?per_page=1'],
    ['workday', 'https://wd2-impl-services1.workday.com/ccx/api/common/v1/acme_pilot/workers?limit=1'],
    ['openai', 'https://api.openai.com/v1/models', { api_key: 'sk-fake' }],
    ['claude', 'https://api.anthropic.com/v1/models?limit=1', { api_key: 'sk-ant-fake' }],
    ['groq', 'https://api.groq.com/openai/v1/models', { api_key: 'gsk-fake' }],
    ['deepseek', 'https://api.deepseek.com/models', { api_key: 'sk-fake' }],
    ['mistral', 'https://api.mistral.ai/v1/models', { api_key: 'fake' }],
    ['together', 'https://api.together.xyz/v1/models', { api_key: 'fake' }],
  ]
  for (const [connector, url, creds] of cases) {
    it(`${connector} probes ${url}`, async () => {
      const calls = stubFetch(() => Response.json({ data: [{ id: 'm' }], accounts: [], scopes: ['mail.send'] }))
      const result = await probe(connector, {}, creds ?? {})
      expect(result.ok).toBe(true)
      expect(calls.map((c) => c.url)).toEqual([url])
      const headers = calls[0].init.headers as Record<string, string>
      const auth = headers.Authorization ?? headers['x-api-key']
      expect(auth).toBeTruthy()
    })
  }
  it('a 401 is reported with the provider message', async () => {
    stubFetch(() => Response.json({ error: { message: 'Invalid API Key provided: sk_test_****' } }, { status: 401 }))
    const result = await probe('stripe')
    expect(result).toMatchObject({ ok: false, statusCode: 401 })
    expect(result.message).toContain('Invalid API Key')
  })
  it('SendGrid flags a key without Mail Send', async () => {
    stubFetch(() => Response.json({ scopes: ['user.profile.read'] }))
    expect(await probe('sendgrid')).toMatchObject({ ok: false })
  })
  it('Perplexity validates the key with a 1-token completion', async () => {
    const calls = stubFetch(() => Response.json({ choices: [] }))
    expect((await probe('perplexity', {}, { api_key: 'pplx-fake' })).ok).toBe(true)
    expect(calls[0].url).toBe('https://api.perplexity.ai/chat/completions')
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ model: 'sonar', max_tokens: 1 })
  })
  it('UKG probe sends the customer API key', async () => {
    const calls = stubFetch(() => Response.json([]))
    await probe('ukg_pro')
    expect((calls[0].init.headers as Record<string, string>)['US-Customer-Api-Key']).toBe('FAKE-CUSTOMER-KEY')
  })
  it('Salesforce probe uses the configured (current) API version', async () => {
    const calls = stubFetch(() => Response.json({}))
    await probe('salesforce')
    expect(calls[0].url).toBe('https://acme.my.salesforce.com/services/data/v66.0/limits')
  })
  it('SAP probe never sends the legacy "fetch" marker as a header', async () => {
    const calls = stubFetch(() => new Response('<edmx:Edmx></edmx:Edmx>', { headers: { 'content-type': 'application/xml' } }))
    const def = getConnectorDefinition('sap_odata')!
    const legacy = { base_url: SAP, auth_type: 'basic', auth_config: { username: 'u', password: 'p' }, headers: { 'x-csrf-token': 'fetch' } }
    expect((await runConnectorProbe('sap_odata', CONFIG.sap_odata, CREDENTIALS.sap_odata, legacy)).ok).toBe(true)
    expect(Object.keys(calls[0].init.headers as Record<string, string>).map((k) => k.toLowerCase())).not.toContain('x-csrf-token')
    expect(def).toBeTruthy()
  })
  it('Workday Basic (ISU) explains it only covers RaaS, without calling REST', async () => {
    const calls = stubFetch(() => Response.json({}))
    const result = await probe('workday', {}, { auth_type: 'basic', username: 'isu@acme', password: 'fake-pass' })
    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/RaaS/)
    expect(calls).toHaveLength(0)
  })
})

describe('probes for other families use the runtime auth (requested by the Google/files audit)', () => {
  const FAKE_SA = JSON.stringify({ type: 'service_account', project_id: 'demo-project', client_email: 'bot@demo-project.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n' })
  const runProbe = (key: string, config: Record<string, any>, credentials: Record<string, any>, stored?: Record<string, any>) => {
    const def = getConnectorDefinition(key)!
    return runConnectorProbe(key, config, credentials, (stored ?? def.buildIntegrationConfig(config, credentials)) as any)
  }
  it('Firebase: POST :listCollectionIds with a service-account token', async () => {
    const calls = stubFetch(() => Response.json({ collectionIds: ['users'] }))
    const result = await runProbe('firebase', { project_id: 'demo-project' }, { service_account_json: FAKE_SA })
    expect(result.ok).toBe(true)
    expect(calls[0].url).toBe('https://firestore.googleapis.com/v1/projects/demo-project/databases/(default)/documents:listCollectionIds')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ pageSize: 1 })
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer ya29.fake-google-token')
  })
  it('Google Drive: the probe impersonates the configured user', async () => {
    jwt.calls.length = 0
    stubFetch(() => Response.json({ user: { emailAddress: 'ada@example.com' } }))
    await runProbe('google_drive', {}, { service_account_json: FAKE_SA, impersonate_email: 'ada@example.com' })
    expect(jwt.calls.at(-1)?.subject).toBe('ada@example.com')
  })
  it('Gemini: key in x-goog-api-key, also for stored ?key= configs', async () => {
    const calls = stubFetch(() => Response.json({ models: [] }))
    const legacy = { base_url: 'https://generativelanguage.googleapis.com', auth_type: 'api_key', auth_config: { key_name: 'key', key_value: 'fake-gemini-key', add_to: 'query' } }
    expect((await runProbe('google_gemini', {}, { api_key: 'fake-gemini-key' }, legacy)).ok).toBe(true)
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1')
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('fake-gemini-key')
  })
  it('Box As-User and Dropbox select-user headers reach the probe', async () => {
    const calls = stubFetch(() => Response.json({ login: 'x' }))
    await runProbe('box', {}, { auth_type: 'developer_token', access_token: 'fake-box', as_user_id: '12345' })
    expect((calls[0].init.headers as Record<string, string>)['As-User']).toBe('12345')
    await runProbe('dropbox', {}, { access_token: 'fake-dbx', team_member_id: 'dbmid:FAKE' })
    expect((calls[1].init.headers as Record<string, string>)['Dropbox-API-Select-User']).toBe('dbmid:FAKE')
  })
})

describe('preflight', () => {
  it('Stripe: mode / key mismatch and publishable keys are caught', () => {
    expect(runConnectorPreflight('stripe', { mode: 'live' }, { secret_key: 'sk_test_FAKE' })?.message).toMatch(/test-mode key/)
    expect(runConnectorPreflight('stripe', { mode: 'test' }, { secret_key: 'pk_test_FAKE' })?.message).toMatch(/publishable/)
    expect(runConnectorPreflight('stripe', { mode: 'test' }, { secret_key: 'rk_test_FAKE' })).toBeNull()
    expect(runConnectorPreflight('stripe', { mode: 'live' }, { secret_key: '__SECRET__' })).toBeNull()
  })
  it('Twilio needs the SID plus an Auth Token or a complete API key', () => {
    expect(runConnectorPreflight('twilio', {}, { account_sid: 'ACx' })?.message).toMatch(/Auth Token/)
    expect(runConnectorPreflight('twilio', {}, { account_sid: 'ACx', api_key_sid: 'SKx' })?.message).toMatch(/Auth Token|both/)
    expect(runConnectorPreflight('twilio', {}, { account_sid: 'ACx', api_key_sid: 'SKx', api_key_secret: 's' })).toBeNull()
    expect(runConnectorPreflight('twilio', {}, { account_sid: 'ACx', auth_token: '__SECRET__' })).toBeNull()
  })
  it('partial refresh-token setups are flagged', () => {
    for (const k of ['salesforce', 'servicenow', 'workday', 'docusign']) {
      expect(runConnectorPreflight(k, { tenant: 't', account_id: 'a' }, { client_id: 'cid' })?.message).toMatch(/partially configured/)
    }
  })
  it('DocuSign needs a token (or JWT) and Workday a tenant', () => {
    expect(runConnectorPreflight('docusign', {}, {})?.message).toMatch(/access token/)
    expect(runConnectorPreflight('workday', {}, { auth_type: 'bearer' })?.message).toMatch(/tenant/)
    expect(runConnectorPreflight('workday', { default_tenant: 'legacy' }, { auth_type: 'bearer' })).toBeNull()
  })
  it('a masked service-account JSON is not parsed', () => {
    expect(runConnectorPreflight('google_drive', {}, { service_account_json: '__SECRET__' })).toBeNull()
  })
})
