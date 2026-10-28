# Release notes: migrating live workflow instances

Runs that are waiting (on a User Task, a timed delay or an external event) or
paused can now be moved to another version of their workflow. Before this
release they always finished on the version they started with.

## New

- **Migrate live instances.** Pick the target version and, for each node the
  instances are at, the node where they continue (the node with the same id
  is pre-selected). The old run is closed with the new status `migrated`, its
  open task is cancelled and its queued resumes are dropped. A new run starts
  on the target version at the chosen node with the same variables (defaults
  for new variables), task and trace id. A User Task there creates a fresh
  task. Each instance is handled on its own; instances that changed meanwhile
  are reported as conflicts and left alone.
- **UI:** a *N live instances on older versions* badge in the workflow
  designer opens **Live instances** (current node, version, waiting time,
  assignee; counts per version, also in **Version history**). **Migrate to
  version…** opens a wizard: target version, target node per current node
  with a graph preview, dry-run review, typed confirmation above 10
  instances, results with links to the new runs. **Move to version…** on the
  run page and in the workflow queue moves one run. Run pages show
  **Migrated to →** / **Migrated from ←** banners.
- **REST:** `GET /api/v1/workflows/{id}/instances` (`status`, `version_id`)
  and `POST /api/v1/workflows/{id}/instances/migrate` (`to_version_id`,
  `run_ids` | `from_version_id` | `all_active`, `node_map`,
  `default_target_node_id`, `dry_run`; up to 500 instances per request).
- **MCP:** `workflows_instances_list`, `workflows_instances_migrate`
  (`dry_run` supported).
- **CLI:** `usertasks workflows instances <id>` and
  `usertasks workflows migrate-instances <id> --to <version> [--run … | --from <version> | --all] [--map src=dst] [--target <node>] [--dry-run]`,
  which plans first, prints the plan as a table and asks before migrating.
- **Events:** `workflow.run.migrated` for both runs (attributes
  `migrated_to_run_id` / `migrated_from_run_id`, `direction` `out` / `in`).
- **Permission:** `workflows.manage_runs` (“Migrate live runs”). Owner,
  Admin and Manager have it; custom roles opt in. The OAuth `workflows:write`
  scope includes it.

## Changed

- New run status `migrated` (terminal). Status filters, badges and reports
  know it.
- `GET /workflows/{id}/versions` returns `active_instances` per version;
  `GET /workflows/runs` returns `version_id`, `migrated_from_run_id` and
  `migrated_to_run_id` and filters by `version_id` (MCP `workflows_runs_list`
  too).
- The run page's process view and the queue's **Go To Activity** dialog now
  draw the version the run executes. They used to draw the current draft.

## Upgrade

Apply `20261103000000_workflow_instance_migration.sql` before deploying the
app version that has this feature (see docs/migrations.md). API keys created
before this release do not have `workflows.manage_runs`; add it to keys that
should migrate instances.
