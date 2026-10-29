/**
 * The CLI commands that are written by hand in packages/cli/src/commands
 * (everything else is generated from the OpenAPI document and documented
 * straight from packages/cli/src/generated/commands.ts). Kept in step with
 * the real program by __tests__/docs-reference.test.ts, which walks the
 * commander tree and checks every command and option appears here.
 */

export interface CliOptionDoc {
  flags: string
  description: string
}

export interface CliCommandDoc {
  /** Command path without the `usertasks` prefix, e.g. `logs tail`. */
  command: string
  /** Positional arguments as shown in usage, e.g. `<dir>`. */
  args?: string
  description: string
  options?: CliOptionDoc[]
  example?: string
}

export interface CliCommandGroup {
  title: string
  commands: CliCommandDoc[]
}

const EVENT_FILTERS: CliOptionDoc[] = [
  { flags: '--category <list>', description: 'Categories, comma-separated: workflow, integration, agent, task, system, audit, security' },
  { flags: '--type <list>', description: 'Event types or globs, comma-separated ("workflow.*", "*.failed")' },
  { flags: '--severity <level>', description: 'Minimum severity: debug, info, warn, error' },
  { flags: '--workflow <id>', description: 'Only events of this workflow' },
  { flags: '--run <id>', description: 'Only events of this workflow run' },
  { flags: '--task <id>', description: 'Only events of this task' },
  { flags: '--trace <id>', description: 'Only events with this trace id' },
]

export const CLI_GLOBAL_OPTIONS: CliOptionDoc[] = [
  { flags: '--profile <name>', description: 'Profile to use (env USERTASKS_PROFILE)' },
  { flags: '--url <url>', description: 'Server URL (env USERTASKS_URL)' },
  { flags: '-o, --output <format>', description: 'table, json or yaml (env USERTASKS_OUTPUT; table on a terminal, json otherwise; text = table)' },
  { flags: '-f, --file <path>', description: 'Request body from a JSON or YAML file, or - for stdin' },
  { flags: '--all', description: 'Fetch every page of a list' },
  { flags: '--limit <n>', description: 'Page size for list commands' },
  { flags: '--offset <n>', description: 'Rows to skip for list commands' },
  { flags: '-y, --yes', description: 'Do not prompt for confirmation (destructive commands prompt on a terminal)' },
  { flags: '--quiet', description: 'Suppress informational messages' },
  { flags: '--debug', description: 'Log HTTP requests to stderr' },
  { flags: '-v, --version', description: 'Print the CLI version' },
  { flags: '-h, --help', description: 'Help for any command or resource' },
]

export const CLI_HANDWRITTEN_COMMANDS: CliCommandGroup[] = [
  {
    title: 'Sign-in and profiles',
    commands: [
      {
        command: 'login',
        description: 'Log in to a UserTasks server (browser login with OAuth and PKCE, or an API key) and save it as a profile.',
        options: [
          { flags: '--api-key [key]', description: 'Store an API key instead: a value, - for stdin, or omit to be prompted' },
          { flags: '--scopes <scopes>', description: 'OAuth scopes to request, comma or space separated (default: every scope except keys:write)' },
          { flags: '--no-browser', description: 'Print the login URL instead of opening a browser' },
        ],
        example: 'usertasks login --url https://tasks.example.com --profile prod',
      },
      { command: 'logout', description: 'Remove the stored credential from a profile; browser logins are revoked on the server.', example: 'usertasks logout --profile prod' },
      { command: 'whoami', description: 'Show the workspace, user, auth kind, permissions, scopes and expiry of the active credential.', example: 'usertasks whoami -o yaml' },
      { command: 'profiles list', description: 'List saved profiles (credentials are never shown).' },
      { command: 'profiles use', args: '<name>', description: 'Make a profile the default.', example: 'usertasks profiles use prod' },
      { command: 'profiles rm', args: '<name>', description: 'Delete a profile and its stored credential.' },
    ],
  },
  {
    title: 'Config as code',
    commands: [
      {
        command: 'config export',
        args: '<dir>',
        description: 'Export workspace configuration into a folder (the GitHub sync layout). Secrets are replaced by "__SECRET__".',
        options: [
          { flags: '--types <list>', description: 'Sections to export: workflows, decision_tables, workflow_activities, data_tables, integrations, agents, reports, retention_policies, roles, mcp_servers, email_templates, connectors, log_destinations, form_themes, forms, workspace_theme' },
          { flags: '--ids <list>', description: 'Only these asset ids (comma-separated; any type) — single-asset export' },
          { flags: '--with-dependencies', description: 'With --ids: also export everything those assets depend on' },
          { flags: '--include-rows', description: 'Also export the rows of the exported data tables (data-rows/ folder)' },
          { flags: '--format <format>', description: 'json (default) or yaml' },
          { flags: '--force', description: 'Write into a non-empty folder, replacing files from an earlier export' },
        ],
        example: 'usertasks config export ./config --format yaml',
      },
      {
        command: 'config diff',
        args: '<path>',
        description: 'Compare a config folder or file with the workspace (a dry-run apply).',
        options: [
          { flags: '--exit-code', description: 'Exit 7 when there are changes or errors' },
          { flags: '--adopt-by-name', description: 'Match unmapped assets to existing ones with the same unique name' },
          { flags: '--source-label <label>', description: 'Label used for id mappings (default "default")' },
        ],
        example: 'usertasks --profile prod config diff ./config --source-label dev --exit-code',
      },
      {
        command: 'config apply',
        args: '<path>',
        description: 'Create or update assets from a config folder or file. Never deletes. ${env:VAR} and ${file:path} placeholders are substituted on your machine before upload.',
        options: [
          { flags: '--dry-run', description: 'Show the plan without changing anything' },
          { flags: '--adopt-by-name', description: 'Match unmapped assets to existing ones with the same unique name' },
          { flags: '--source-label <label>', description: 'Label recorded with the id mappings (default "default"); use one per source workspace' },
          { flags: '--rows-mode <mode>', description: 'Data-table rows (data-rows/): merge (default), replace or skip' },
        ],
        example: 'usertasks --profile prod config apply ./config --source-label dev',
      },
      {
        command: 'config new',
        args: '<type> <name>',
        description: 'Scaffold a new asset file with a generated id. Types: workflow, decision-table, activity, data-table, integration, reference, agent, report, retention-policy, role, mcp-server, email-template, connector, log-destination, form, form-theme.',
        options: [
          { flags: '--dir <dir>', description: 'Config folder (default .)' },
          { flags: '--format <format>', description: 'json or yaml' },
        ],
        example: 'usertasks config new workflow "Invoice approval" --dir ./config',
      },
    ],
  },
  {
    title: 'Background jobs',
    commands: [
      {
        command: 'jobs wait',
        args: '<id>',
        description: 'Wait for a background job (from an async request or the app) to finish and print it; exit code 1 when it failed or was cancelled. Commands with an async variant already wait by default (--no-wait prints the job instead).',
        options: [{ flags: '--timeout <seconds>', description: 'Give up after this many seconds' }],
        example: 'usertasks jobs wait 7b0c…',
      },
      {
        command: 'jobs download',
        args: '<id>',
        description: 'Save the result file of a finished job (an export, a package build).',
        options: [{ flags: '--out <file>', description: 'Where to write it (default: the file name of the result)' }],
        example: 'usertasks jobs download 7b0c… --out workspace.usertasks.json',
      },
    ],
  },
  {
    title: 'Logs and events',
    commands: [
      {
        command: 'logs tail',
        description: 'Stream events live (Ctrl-C to stop). Reconnects automatically without gaps; text on a terminal, NDJSON with -o json or when piped.',
        options: [
          ...EVENT_FILTERS,
          { flags: '--since <when>', description: 'Start from an ISO time or a duration back (30s, 15m, 1h); default: from now' },
          { flags: '--after <id>', description: 'Start after this event id' },
        ],
        example: 'usertasks logs tail --category workflow,integration --severity warn',
      },
      {
        command: 'logs export',
        description: 'Write past events as NDJSON (one event per line) to stdout.',
        options: [
          ...EVENT_FILTERS,
          { flags: '--since <when>', description: 'From an ISO time or a duration back (30s, 15m, 1h, 2d)' },
          { flags: '--until <when>', description: 'Up to an ISO time or a duration back' },
          { flags: '--after <id>', description: 'Only events after this id (instead of --since)' },
        ],
        example: 'usertasks logs export --since 24h --category audit,security > audit.ndjson',
      },
    ],
  },
  {
    title: 'Workflows',
    commands: [
      {
        command: 'workflows run',
        args: '<id>',
        description: 'Run a workflow with its input parameters. Values from -f and --input are coerced by input type; missing required inputs are asked for on a terminal (without one, they are listed and the command exits 2). Queued in the background unless --wait.',
        options: [
          { flags: '--input <key=value>', description: 'Input value, coerced by the input type (repeatable; wins over -f)' },
          { flags: '--wait', description: 'Run now and wait: print the run status and step outputs (exit 1 if the run failed)' },
          { flags: '--priority <n>', description: 'Queue priority 0-100 for background runs (default 50)' },
          { flags: '--task <task-id>', description: 'Associate the run with a task' },
        ],
        example: 'usertasks workflows run <id> --input customer=Acme --input amount=120 --wait',
      },
    ],
  },
  {
    title: 'Tasks',
    commands: [
      {
        command: 'tasks complete',
        args: '<id>',
        description: 'Complete a task with an outcome and field values. A workflow waiting on the task resumes.',
        options: [
          { flags: '--outcome <value>', description: 'Outcome, e.g. Approved or Rejected (default completed)' },
          { flags: '--notes <text>', description: 'Outcome notes' },
          { flags: '--set <field=value>', description: 'Task field value (repeatable): field=value, field:=<json>, field=@file' },
          { flags: '--attach <field=path>', description: 'Upload a file into an Attachments field (repeatable; the field collects them). Also on `forms submit` and `workflows start`' },
          { flags: '--on-behalf', description: 'Act for the assignee of a workflow task (you are their manager, or hold tasks.complete_any)' },
          { flags: '--note <text>', description: 'Why you are acting on behalf (required with --on-behalf; the assignee sees it)' },
        ],
        example: 'usertasks tasks complete <task-id> --outcome Approved --set cost_centre=OPS --set amount:=1200',
      },
      {
        command: 'tasks team',
        args: '',
        description: 'The manager view: open tasks of your reports, with open / overdue / SLA-breached counts per person.',
        options: [
          { flags: '--indirect', description: 'Include reports of reports (up to 10 levels)' },
          { flags: '--overdue', description: 'Only overdue tasks' },
          { flags: '--sla-breached', description: 'Only tasks whose run SLA is breached or whose escalation fired' },
          { flags: '--assignee <id>', description: 'One report only' },
        ],
        example: 'usertasks tasks team --indirect --overdue',
      },
    ],
  },
  {
    title: 'Files',
    commands: [
      {
        command: 'files upload',
        args: '<path>',
        description: 'Upload a file for an Attachments field (a task, a reusable form submission or a workflow start form) and print the file object; its id goes in the field\'s value. Large files go straight to storage when the server can sign uploads.',
        options: [
          { flags: '--field <key>', description: 'The Attachments field (or start-form input) key' },
          { flags: '--task <id>', description: 'For this open task' },
          { flags: '--form <id>', description: 'For a submission of this reusable form' },
          { flags: '--workflow <id>', description: 'For this workflow\'s start form' },
        ],
        example: 'usertasks files upload ./taxi.pdf --field receipts --task <task-id>',
      },
    ],
  },
  {
    title: 'Utilities',
    commands: [
      {
        command: 'api',
        args: '<method> <path>',
        description: 'Make an authenticated request to any /api/v1 path and print the raw JSON response.',
        options: [
          { flags: '-q, --query <key=value>', description: 'Query parameter (repeatable)' },
          { flags: '--set <assignment>', description: 'Body field (repeatable): key=value, key:=<json>, key=@file (text), key:=@file (JSON/YAML)' },
        ],
        example: 'usertasks api GET /workflows -q limit=5',
      },
      { command: 'completion', args: '<shell>', description: 'Print a shell completion script for bash, zsh or fish.', example: 'usertasks completion zsh > "${fpath[1]}/_usertasks"' },
    ],
  },
  {
    title: 'Packages',
    commands: [
      {
        command: 'packages assets', args: '[search]',
        description: 'Search every asset a package can contain — workflows, custom steps, data tables, integrations (and their references), connectors, decision tables, email templates, agents, reports, roles, MCP servers, retention policies, log destinations — server-side and cursor-paged, with the total and per-type counts. Types you may not view are not searched. GET /packages/assets.',
        options: [
          { flags: '--search <text>', description: 'Substring of the name or description (same as the argument)' },
          { flags: '--type <types>', description: 'Only these types, comma-separated (workflow, data_table, decision_table, …)' },
          { flags: '--tag <tag>', description: 'Tag (workflows, custom steps, integrations, agents) or report category' },
          { flags: '--owner <user>', description: 'Created by: user id or "me"' },
          { flags: '--updated-since <when>', description: 'YYYY-MM-DD, timestamp, or relative (24h, 7d, 4w)' },
          { flags: '--sort <order>', description: 'name (A–Z, default) or updated (newest first)' },
          { flags: '--package <package>', description: 'Mark which assets are already in this package (root / added / dependency / left out)' },
          { flags: '--after <cursor>', description: 'Next page: the previous next_cursor (or the global --all for every page; --limit sets the page size, 1-100)' },
        ],
        example: 'usertasks packages assets invoice --type workflow,decision_table --updated-since 30d --package invoice-approval',
      },
      {
        command: 'packages create', args: '[name]',
        description: 'Create a package from root artifacts; everything they use is included automatically. Roots are <type>:<id>, a workflow id, <type>:<name> or a workflow name, or found with --search (on a terminal you choose from the matches; without one a single or exact-name match is used, otherwise it exits 2 listing the candidates). -f / --set still send a full body.',
        options: [
          { flags: '--from <ref>', description: 'Root artifact (repeatable)' },
          { flags: '--search <text>', description: 'Find the root(s) by search' },
          { flags: '--type <types>', description: 'With --search: only these types (comma-separated)' },
          { flags: '--description <text>', description: 'Description' },
          { flags: '--readme <file>', description: 'Markdown readme shown before install (- for stdin)' },
          { flags: '--slug <slug>', description: 'Slug (default: from the name)' },
          { flags: '--author <author>', description: 'Author (default: the workspace name)' },
          { flags: '--rows <table-id>', description: 'Package this data table with its rows (repeatable)' },
          { flags: '--set <assignment>', description: 'Set a body field (repeatable): key=value, key:=<json>, key=@file' },
        ],
        example: 'usertasks packages create "Invoice approval" --from "Invoice approval" --readme README.md',
      },
      {
        command: 'packages add', args: '<package> [refs...]',
        description: 'Add artifacts and, by default, everything they use. Refs as for create (<type>:<id>, ids or names), or --search to choose from matches (already-included assets are marked).',
        options: [
          { flags: '--search <text>', description: 'Find what to add by search (asks which on a terminal)' },
          { flags: '--type <types>', description: 'With --search: only these types (comma-separated)' },
          { flags: '--without-dependencies', description: 'Leave out the dependencies only these artifacts pull in (they must already exist where the package is installed)' },
          { flags: '--rows <table-id>', description: 'Package this data table with its rows (repeatable)' },
        ],
        example: 'usertasks packages add invoice-approval --search vendor --type data_table,decision_table',
      },
      {
        command: 'packages show', args: '<package>',
        description: 'A package at a glance: metadata, every item with why it is included (root, added, used by …), data mode and row count per table, what is left out, what an install will ask for, and recent versions.',
        example: 'usertasks packages show invoice-approval',
      },
      {
        command: 'packages set-data', args: '<package> <table> <mode>',
        description: 'Package a data table as `schema` only or `rows` (schema + rows, at most 10,000). <table> is the table id or its name in the package.',
        example: 'usertasks packages set-data invoice-approval "Vendors" rows',
      },
      { command: 'packages remove', args: '<package> <refs...>', description: 'Leave artifacts (<type>:<id>) out of a package.', example: 'usertasks packages remove invoice-approval email_template:…' },
      {
        command: 'packages build', args: '<package>',
        description: 'Build, sign and publish a new version and save the .utpkg file (POST /packages/{id}/versions).',
        options: [
          { flags: '--release <version>', description: 'Exact semantic version, e.g. 1.2.0 (default: bump the latest)' },
          { flags: '--bump <kind>', description: 'major, minor or patch (default patch)' },
          { flags: '--notes <text>', description: 'Release notes' },
          { flags: '--out <file>', description: 'Where to save the file (default <slug>-<version>.utpkg)' },
          { flags: '-O <file>', description: 'Alias of --out' },
        ],
        example: 'usertasks packages build invoice-approval --bump minor --out invoice-approval.utpkg',
      },
      {
        command: 'packages download', args: '<package> [version]',
        description: 'Download a built version (default latest) as a .utpkg file.',
        options: [{ flags: '--out <file>', description: 'Where to save the file' }],
        example: 'usertasks packages download invoice-approval 1.1.0',
      },
      { command: 'packages inspect', args: '<file>', description: 'Verify a .utpkg offline (checksum, every file hash, signature) and show its contents, data and requirements. Exits 6 when the file was modified.', example: 'usertasks packages inspect invoice-approval-1.1.0.utpkg' },
      {
        command: 'packages install', args: '<file>',
        description: 'Install a package, or upgrade it in place when it is installed already: shows the plan, prompts for missing requirement values on a terminal (secrets without echo), then applies. Without a terminal, missing required values exit 6 unless --keep-incomplete.',
        options: [
          { flags: '--dry-run', description: 'Show the plan (diff) only' },
          { flags: '--set <assignment>', description: 'Requirement value: <requirement id>.<field key>=value (repeatable; ${env:VAR} and ${file:path} are substituted locally). Use -f values.yaml for many' },
          { flags: '--keep-incomplete', description: 'Install even if required values are missing; affected items stay disabled until `packages complete`' },
          { flags: '--adopt-by-name', description: 'First install: adopt existing assets with the same unique name' },
          { flags: '--data <table=mode>', description: 'Rows of a packaged data table: <table id>=merge|replace|skip (repeatable; default merge)' },
          { flags: '--allow-downgrade', description: 'Install an older version over a newer one' },
          { flags: '--source-label <label>', description: 'Where the file came from, shown in the library (default the file name)' },
          { flags: '--keep-local-changes', description: 'Upgrade: keep assets changed in this workspace since the last install' },
        ],
        example: "usertasks packages install invoice-approval-1.1.0.utpkg -f values.yaml --set 'connector:connectors:<id>.credentials.password=${env:DB_PASSWORD}' --yes",
      },
      {
        command: 'packages upgrade', args: '<file>',
        description: 'Upgrade an installed package in place: diff first, local requirement values kept, assets removed in the new version flagged (never deleted).',
        options: [
          { flags: '--dry-run', description: 'Show the plan (diff) only' },
          { flags: '--set <assignment>', description: 'Requirement value: <requirement id>.<field key>=value (repeatable; ${env:VAR} and ${file:path} are substituted locally). Use -f values.yaml for many' },
          { flags: '--keep-incomplete', description: 'Install even if required values are missing; affected items stay disabled until `packages complete`' },
          { flags: '--adopt-by-name', description: 'First install: adopt existing assets with the same unique name' },
          { flags: '--data <table=mode>', description: 'Rows of a packaged data table: <table id>=merge|replace|skip (repeatable; default merge)' },
          { flags: '--allow-downgrade', description: 'Install an older version over a newer one' },
          { flags: '--source-label <label>', description: 'Where the file came from, shown in the library (default the file name)' },
          { flags: '--keep-local-changes', description: 'Upgrade: keep assets changed in this workspace since the last install' },
        ],
        example: 'usertasks packages upgrade invoice-approval-1.2.0.utpkg --dry-run',
      },
      {
        command: 'packages complete', args: '<install>',
        description: 'Complete setup of an incomplete install (install id or package slug): supply the missing values; the items they unblock are enabled and the package workflows activated. Exits 7 while values are still missing.',
        options: [
          { flags: '--set <assignment>', description: 'Requirement value: <requirement id>.<field key>=value (repeatable)' },
          { flags: '--dry-run', description: 'Show what is still missing' },
        ],
        example: "usertasks packages complete invoice-approval --set 'integration_auth:integrations:<id>.config.auth_config.token=${env:ERP_TOKEN}'",
      },
      {
        command: 'packages uninstall', args: '<install>',
        description: "Uninstall a package and its artifacts: lists every artifact and what happens to it, then asks. Assets changed locally since install, and data tables that hold rows, are kept unless forced; unfinished runs of the package's workflows block it unless --cancel-runs.",
        options: [
          { flags: '--force', description: 'Also remove assets changed in this workspace since install' },
          { flags: '--delete-data', description: 'Also delete data tables that hold rows (the rows are lost)' },
          { flags: '--cancel-runs', description: "Cancel unfinished runs of the package's workflows first" },
          { flags: '--dry-run', description: 'List only (exits 7 when something blocks it)' },
        ],
        example: 'usertasks packages uninstall invoice-approval --delete-data --dry-run',
      },
      { command: 'packages installs', description: 'The package library: installed packages with version, status (complete / incomplete), source and signer.', example: 'usertasks packages installs' },
      {
        command: 'packages history', args: '[package]',
        description: 'Package history, newest first: installs, upgrades, reinstalls, downgrades, reconfigures (complete setup) and uninstalls, failed attempts included — when, who, channel, version from → to and items. One event with its applied plan: `usertasks package-events get <id>`.',
        options: [
          { flags: '--action <actions>', description: 'install, upgrade, reinstall, downgrade, reconfigure, uninstall (comma-separated)' },
          { flags: '--status <statuses>', description: 'succeeded, partial, failed' },
          { flags: '--channel <channels>', description: 'ui, cli, api, mcp' },
          { flags: '--user <user>', description: 'User id or email' },
          { flags: '--since <date>', description: 'From this date (YYYY-MM-DD) or timestamp' },
          { flags: '--until <date>', description: 'Up to and including this date' },
          { flags: '--limit <n>', description: 'How many (default 50, 0 = all)' },
        ],
        example: 'usertasks packages history invoice-approval --status failed',
      },
    ],
  },
]

export const CLI_EXIT_CODES: Array<[number, string]> = [
  [0, 'OK'],
  [1, 'Error'],
  [2, 'Usage error'],
  [3, 'Unauthenticated (log in again, or check USERTASKS_API_KEY)'],
  [4, 'Forbidden (missing permission or OAuth scope)'],
  [5, 'Not found'],
  [6, 'Validation error or conflict'],
  [7, 'Config changes found (diff --exit-code) or apply errors'],
  [8, 'Rate limited'],
  [10, 'Network or server error'],
]
