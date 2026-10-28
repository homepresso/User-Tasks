# @usertasks/cli

`usertasks` is the command-line interface for UserTasks,
the open-source headless workflow engine. It talks only to the public REST API (`/api/v1`), so
the server enforces the same permissions as for any other API client.

```bash
npm install -g @usertasks/cli    # Node.js 20+
usertasks login --url https://tasks.example.com
usertasks whoami
usertasks workflows list
```

## Logging in

| Command | What it does |
|---|---|
| `usertasks login [--url] [--profile] [--scopes] [--no-browser]` | Signs in through the browser (OAuth authorization code with PKCE and a loopback redirect). Tokens refresh automatically. |
| `usertasks login --api-key [key\|-]` | Stores an API key instead. Pass the key as a value, `-` to read it from stdin, or nothing to be prompted. |
| `usertasks logout` | Revokes the OAuth tokens and forgets the credential. |
| `usertasks profiles list\|use\|rm` | Manages the saved profiles. |
| `usertasks whoami` | Shows the workspace, user, auth kind, permissions, scopes and expiry. |

Profiles are stored in `$XDG_CONFIG_HOME/usertasks/config.json` (`~/.config/...`, or
`%APPDATA%\usertasks` on Windows). The folder is created with mode 0700 and the file with mode
0600.

Browser logins request every scope except `keys:write`. If the CLI needs to create API keys,
add it with `--scopes …,keys:write`. Keys created this way must expire within 90 days.

**CI:** set `USERTASKS_URL` and `USERTASKS_API_KEY`. No login step or profile is needed, and
`USERTASKS_API_KEY` always overrides a stored credential.

## Commands

The resource commands are generated from the server's OpenAPI document. Run
`usertasks <resource> --help` to list a resource's commands, and `usertasks <resource> <verb>
--help` to see a command's fields and the permission it needs.

```
workflows  runs  queue  events  tasks  agents  decision-tables  reports  retention
integrations  references  objects  connectors  email-templates  activities  tables  rows
roles  users  teams  invitations  audit-log  api-keys  webhooks  github-sync
config  api  completion
```

```bash
usertasks workflows list --all -o yaml
usertasks email-templates create --set name=Welcome --set subject=Hi --set html_body=@welcome.html
usertasks roles create -f role.yaml
usertasks users add-role <user-id> <role-id>
usertasks tasks complete <task-id> --outcome approved --set amount:=1200
usertasks api GET /workflows -q limit=5        # any endpoint, raw JSON
```

Task descriptions can be HTML. `tasks` commands print them as plain text: they send
`strip_html=true` and convert any HTML left in the output. Pass `--html` to see the stored HTML
(`usertasks tasks get <task-id> --html`). `usertasks api` returns the raw response.

### Editing a workflow

`workflows definition` prints the draft in exactly the shape `workflows create` and
`workflows update` accept. Edit it and send it back: the draft is saved (runs keep using the
published version) until you publish.

```bash
usertasks workflows definition <id> -o json > wf.json
# edit wf.json: add a node to "nodes" and an edge to "edges", change variables, ...
usertasks workflows update <id> -f wf.json        # saves the draft; changed: false if nothing differs
usertasks workflows publish <id> --set notes="Add review step"
usertasks workflows versions <id>
usertasks workflows start --set workflow_id=<id>  # runs the published version
```

`workflows get <id> --include-definition true -o json` output is accepted by `update` too.
The same round trip works for every resource: `<resource> get <id> -o json > x.json`, edit,
`<resource> update <id> -f x.json`. Read-only fields are ignored and `__SECRET__` keeps a stored
credential.

There are two ways to give a command a request body:

- `-f <file|->` reads the body from a JSON or YAML file, or from stdin with `-`.
- `--set` sets one field:
  - `key=value` sets a string;
  - `key:=<json>` sets a JSON value;
  - `key=@file` reads a file into the field as text;
  - `key:=@file` reads a JSON or YAML file and parses it.

## Config as code

`config export`, `config diff` and `config apply` use the same folder layout as GitHub Sync:

```bash
usertasks --profile dev config export ./config --format yaml
usertasks --profile prod config diff ./config --source-label dev --exit-code
usertasks --profile prod config apply ./config --source-label dev
```

- Exported secrets are always replaced by `__SECRET__`. Put `${env:VAR}` or `${file:path}` in
  their place. The CLI substitutes them on your machine before upload.
- Apply never deletes. Running the same apply again reports everything as unchanged.
- Asset identities are tracked per `--source-label`, so use one label for each source
  workspace. `--adopt-by-name` links unmapped assets to existing assets that have the same
  unique name.
- `config new <type> <name>` creates a new asset file with a generated id.

## Output and exit codes

- `-o, --output table|json|yaml`: the default is `table` on a terminal and `json` otherwise.
  You can also set it with `USERTASKS_OUTPUT`.
- `--all` fetches every page of a list. `--limit` and `--offset` fetch one page.
- `--yes` skips confirmation prompts. `--quiet` hides informational messages. `--debug` logs
  HTTP requests.

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | error |
| 2 | usage error |
| 3 | unauthenticated |
| 4 | forbidden |
| 5 | not found |
| 6 | validation error or conflict |
| 7 | config changes (`diff --exit-code`) or apply errors |
| 8 | rate limited |
| 10 | network or server error |

## Shell completion

```bash
usertasks completion bash > /etc/bash_completion.d/usertasks
usertasks completion zsh > "${fpath[1]}/_usertasks"
usertasks completion fish > ~/.config/fish/completions/usertasks.fish
```

## License

Apache-2.0
