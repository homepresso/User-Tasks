import type { ConnectorDefinition } from '../registry'

export const ukgProConnector: ConnectorDefinition = {
  key: 'ukg_pro',
  name: 'UKG Pro',
  description: 'HR, payroll, time management, compensation, and benefits data from UKG Pro (formerly UltiPro)',
  category: 'productivity',
  icon: 'UserCircle',
  color: '#005151',
  docsUrl: 'https://developer.ukg.com/',
  fields: [
    {
      key: 'service_host',
      label: 'Service Host',
      type: 'text',
      placeholder: 'service4.ultipro.com',
      required: true,
      helpText: 'Your UKG Pro service host (varies by data center, e.g. service4.ultipro.com or service5.ultipro.com)',
    },
    {
      key: 'customer_api_key',
      label: 'Customer API Key',
      type: 'text',
      placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      required: true,
      helpText: 'Your organization\'s Customer API Key (GUID) from UKG Pro',
    },
  ],
  credentialFields: [
    {
      key: 'username',
      label: 'API Username',
      type: 'text',
      required: true,
      helpText: 'Service account username configured for API access',
    },
    {
      key: 'password',
      label: 'API Password',
      type: 'password',
      required: true,
      helpText: 'Service account password',
    },
  ],
  referenceTemplates: [
    // ─── Authentication ───
    {
      key: 'authenticate',
      name: 'Get Session Token',
      description: 'Authenticate and retrieve a session token for subsequent API calls',
      method: 'POST',
      pathTemplate: '/api/authentication',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '',
      inputs: [],
      outputs: [
        { name: 'Token', type: 'string' },
        { name: 'ExpirationDate', type: 'string' },
      ],
    },
    // ─── Employees ───
    {
      key: 'get_employee',
      name: 'Get Employee',
      description: 'Retrieve a single employee record by employee ID or company/employee number',
      method: 'GET',
      pathTemplate: '/personnel/v1/employee-details/{{employee_id}}',
      inputs: [
        { name: 'employee_id', type: 'string', required: true, description: 'Employee ID (GUID) or company-employee number' },
      ],
      outputs: [
        { name: 'employeeId', type: 'string' },
        { name: 'firstName', type: 'string' },
        { name: 'lastName', type: 'string' },
        { name: 'emailAddress', type: 'string' },
      ],
    },
    {
      key: 'employee_changes',
      name: 'Get Employee Changes',
      description: 'Retrieve employee records that have changed since a given date (delta sync)',
      method: 'GET',
      pathTemplate: '/personnel/v1/employee-changes?startDate={{start_date}}&endDate={{end_date}}&page={{page}}&per_page={{per_page}}',
      inputs: [
        { name: 'start_date', type: 'string', required: true, description: 'Start date (YYYY-MM-DD)' },
        { name: 'end_date', type: 'string', required: false, description: 'End date (YYYY-MM-DD, defaults to today)' },
        { name: 'page', type: 'number', required: false, description: 'Page number', defaultValue: '1' },
        { name: 'per_page', type: 'number', required: false, description: 'Results per page', defaultValue: '100' },
      ],
      outputs: [
        { name: 'employees', type: 'array' },
        { name: 'totalCount', type: 'number' },
      ],
    },
    {
      key: 'search_employees',
      name: 'Search Employees',
      description: 'Search for employees by name, email, department, or other criteria',
      method: 'GET',
      pathTemplate: '/personnel/v1/employee-details?{{query_params}}',
      inputs: [
        { name: 'query_params', type: 'string', required: true, description: 'Query string params (e.g. lastName=Smith&status=A for active employees)' },
      ],
      outputs: [
        { name: 'employees', type: 'array' },
        { name: 'totalCount', type: 'number' },
      ],
    },
    // ─── Employment Details ───
    {
      key: 'employment_details',
      name: 'Get Employment Details',
      description: 'Retrieve job, position, department, and supervisor info for an employee',
      method: 'GET',
      pathTemplate: '/personnel/v1/employment-details/{{employee_id}}',
      inputs: [
        { name: 'employee_id', type: 'string', required: true, description: 'Employee ID' },
      ],
      outputs: [
        { name: 'jobTitle', type: 'string' },
        { name: 'department', type: 'string' },
        { name: 'supervisorId', type: 'string' },
        { name: 'hireDate', type: 'string' },
        { name: 'status', type: 'string' },
      ],
    },
    // ─── Compensation ───
    {
      key: 'compensation_details',
      name: 'Get Compensation Details',
      description: 'Retrieve pay rate, salary, and compensation data for an employee',
      method: 'GET',
      pathTemplate: '/personnel/v1/compensation-details/{{employee_id}}',
      inputs: [
        { name: 'employee_id', type: 'string', required: true, description: 'Employee ID' },
      ],
      outputs: [
        { name: 'payRate', type: 'number' },
        { name: 'annualSalary', type: 'number' },
        { name: 'payFrequency', type: 'string' },
        { name: 'effectiveDate', type: 'string' },
      ],
    },
    // ─── Benefits ───
    {
      key: 'benefit_details',
      name: 'Get Benefit Details',
      description: 'Retrieve benefit elections and plan information for an employee',
      method: 'GET',
      pathTemplate: '/personnel/v1/benefit-details/{{employee_id}}',
      inputs: [
        { name: 'employee_id', type: 'string', required: true, description: 'Employee ID' },
      ],
      outputs: [
        { name: 'benefits', type: 'array' },
      ],
    },
    // ─── Org Structure ───
    {
      key: 'org_levels',
      name: 'Get Org Levels',
      description: 'Retrieve organizational hierarchy and level codes',
      method: 'GET',
      pathTemplate: '/personnel/v1/org-levels',
      inputs: [],
      outputs: [
        { name: 'orgLevels', type: 'array' },
      ],
    },
    // ─── Pay Statements ───
    {
      key: 'pay_statements',
      name: 'Get Pay Statements',
      description: 'Retrieve pay statement / pay stub data for an employee',
      method: 'GET',
      pathTemplate: '/personnel/v1/pay-statements?employeeId={{employee_id}}&year={{year}}&page={{page}}&per_page={{per_page}}',
      inputs: [
        { name: 'employee_id', type: 'string', required: true, description: 'Employee ID' },
        { name: 'year', type: 'string', required: false, description: 'Year filter (e.g. 2026)' },
        { name: 'page', type: 'number', required: false, description: 'Page number', defaultValue: '1' },
        { name: 'per_page', type: 'number', required: false, description: 'Results per page', defaultValue: '20' },
      ],
      outputs: [
        { name: 'payStatements', type: 'array' },
        { name: 'totalCount', type: 'number' },
      ],
    },
    // ─── Time Management ───
    {
      key: 'timesheets',
      name: 'Get Timesheets',
      description: 'Retrieve timesheet data for employees within a date range',
      method: 'GET',
      pathTemplate: '/time-management/v1/timesheets?startDate={{start_date}}&endDate={{end_date}}&employeeId={{employee_id}}&page={{page}}&per_page={{per_page}}',
      inputs: [
        { name: 'start_date', type: 'string', required: true, description: 'Start date (YYYY-MM-DD)' },
        { name: 'end_date', type: 'string', required: true, description: 'End date (YYYY-MM-DD)' },
        { name: 'employee_id', type: 'string', required: false, description: 'Filter by employee ID (empty = all employees)' },
        { name: 'page', type: 'number', required: false, description: 'Page number', defaultValue: '1' },
        { name: 'per_page', type: 'number', required: false, description: 'Results per page', defaultValue: '100' },
      ],
      outputs: [
        { name: 'timesheets', type: 'array' },
        { name: 'totalCount', type: 'number' },
      ],
    },
    {
      key: 'time_off_requests',
      name: 'Get Time Off Requests',
      description: 'Retrieve time-off / leave requests for employees',
      method: 'GET',
      pathTemplate: '/time-management/v1/time-off-requests?startDate={{start_date}}&endDate={{end_date}}&employeeId={{employee_id}}&status={{status}}',
      inputs: [
        { name: 'start_date', type: 'string', required: true, description: 'Start date (YYYY-MM-DD)' },
        { name: 'end_date', type: 'string', required: true, description: 'End date (YYYY-MM-DD)' },
        { name: 'employee_id', type: 'string', required: false, description: 'Filter by employee ID' },
        { name: 'status', type: 'string', required: false, description: 'Filter by status (Pending, Approved, Denied)' },
      ],
      outputs: [
        { name: 'requests', type: 'array' },
        { name: 'totalCount', type: 'number' },
      ],
    },
    // ─── BI Reporting ───
    {
      key: 'run_bi_report',
      name: 'Run BI Report',
      description: 'Execute a pre-configured Business Intelligence report and return results. Reports must be configured in UKG Pro first.',
      method: 'POST',
      pathTemplate: '/services/BIDataService',
      headers: { 'Content-Type': 'text/xml' },
      bodyTemplate: '<BIDataService><Report><ReportPath>{{report_path}}</ReportPath></Report></BIDataService>',
      inputs: [
        { name: 'report_path', type: 'string', required: true, description: 'BI report path as configured in UKG Pro (e.g. /content/folder/ReportName)' },
      ],
      outputs: [
        { name: 'data', type: 'array' },
        { name: 'columns', type: 'array' },
      ],
    },
    // ─── Raw Request ───
    {
      key: 'raw_request',
      name: 'Raw API Request',
      description: 'Send a custom request to any UKG Pro API endpoint',
      method: 'GET',
      pathTemplate: '{{path}}',
      headers: { 'Accept': 'application/json' },
      bodyTemplate: '{{body}}',
      inputs: [
        { name: 'path', type: 'string', required: true, description: 'API path (e.g. /personnel/v1/employee-details)' },
        { name: 'method', type: 'string', required: false, description: 'HTTP method (GET, POST, PUT, DELETE)', defaultValue: 'GET' },
        { name: 'body', type: 'string', required: false, description: 'Request body (JSON string for POST/PUT)' },
      ],
      outputs: [
        { name: 'status', type: 'number' },
        { name: 'body', type: 'string' },
      ],
    },
  ],
  buildIntegrationConfig: (config, credentials) => ({
    base_url: `https://${config.service_host || 'service4.ultipro.com'}`,
    auth_type: 'basic',
    auth_config: {
      username: credentials.username,
      password: credentials.password,
      _executor: 'ukg_pro',
      customer_api_key: config.customer_api_key,
      service_host: config.service_host || 'service4.ultipro.com',
    },
    headers: {
      'US-Customer-Api-Key': config.customer_api_key || '',
    },
  }),
}
