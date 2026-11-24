# Release notes: USER_NAME and USER_EMAIL expression functions

Workflows can now turn a user id into the person's name or email address,
for example to record who moved a deal:
`{{=USER_NAME(workflow_started_by)}}` gives `Maya Patel`.

## New

- `USER_NAME(user_id)`: the person's display name. Without one, it is the
  local part of their email address.
- `USER_EMAIL(user_id)`: the person's email address.
- Both functions accept a user id or a person value (`{ id, … }`). They
  return an empty string when the person is unknown, so wrap them in
  `COALESCE(USER_NAME(x), "Someone")` to give a fallback.
- **Scope:** only people with a membership in the run's own workspace
  resolve, up to 5,000 per workspace.
- **Loading:** the engine loads the workspace's people once per run, and
  only before a step whose settings call these functions. The list rides
  on the run's variables under a private key that is never saved with the
  run and that templates can't read.
- **Where they work:** in workflows only. In form rules and app
  expressions there is no directory, so both return an empty string.
- Both functions are listed in the function catalogue (expression editor,
  agent reference, docs).

No migration.
