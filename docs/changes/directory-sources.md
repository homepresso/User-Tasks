# Directory sources from extensions

Extensions can now bring people and groups into UserTasks — for example the
site groups of a connected SharePoint site collection — through directory
sync, without writing core tables.

## What changes for admins

- **Settings → SSO & Directory → Directory sources from extensions** lists
  each source with its state, how many people have an account, how many are
  pending their first sign-in, its groups, "Sync now" and the people it lists.
- **Pending people.** Someone a source lists who has no account here gets no
  account, no membership, no licence seat and no e-mail. At their first
  single sign-on (or LDAP bind) with a verified address the source lists,
  UserTasks creates the account if needed — even when the identity provider
  has no `jit` — adds them to the workspace with the provisioning role and
  to the source's groups.
- **Read-only teams.** A source's groups are teams marked with where they
  come from (e.g. "SharePoint · Finance"). Their name, description and
  members come from the source: renaming, deleting and member changes are
  refused (409 `source_managed`). Lead, colour, kind, parent and org unit stay
  editable. They work wherever teams do: assignment, pickers, visibility,
  notifications.
- **Removals.** At the next sync, people the source no longer lists leave
  its teams; people who joined the workspace through the source lose that
  membership (and are pending again). Members from before are never removed.

## API, MCP, CLI

| | REST (`/api/v1`) | MCP | CLI |
|---|---|---|---|
| List sources | `GET /directory-sync/sources` | `directory_sources_list` (settings.view) | `usertasks directory-sync sources` |
| People of a source | `GET /directory-sync/sources/{source}/entries?status=pending\|linked\|inactive` | `directory_source_entries` (settings.view) | `usertasks directory-sync entries <source>` |
| Sync now | `POST /directory-sync/sources/{source}/sync` | `directory_source_sync` (settings.edit) | `usertasks directory-sync source-sync <source>` |

`GET /directory-sync/runs?provider=` also accepts a source id
(`ext.<extension>.<key>`).

## For extension authors

`contributes.directorySources` in the manifest, `directorySources` in the
server module and `ctx.directory` (requestSync, status, lookupUsers,
lookupGroups). See /docs/developers/extensions/contribution-points.

## Database

Migration `20270113100000_directory_sources.sql` (additive, idempotent):
`directory_sources`, `directory_entries` (service role only),
`teams.source` / `source_label`, and extension source ids in the
`directory_links` / `directory_sync_runs` provider checks. Until it is
applied, sources cannot sync; nothing else changes (teams read without the
new columns).
