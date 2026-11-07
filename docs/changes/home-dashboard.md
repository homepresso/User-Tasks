# Release notes: Home

After signing in, you now land on **Home** (`/home`), the first item in the side menu. It brings together what you have to do, what you've asked for, and where each request is. `/tasks` is unchanged, and the old `/dashboard` link now opens Home.

## What's new

- **Three cards.**
  - **My tasks**: outstanding tasks, plus how many you completed in the last 30 days, how many are overdue or past SLA, and how many are in your queue.
  - **My submissions in progress**: forms you submitted whose process is still running or waiting.
  - **Following**: active processes you follow, and how many were updated today.

  Click a card to open its list.
- **Favourite forms.** Star a form in the Forms list, the Forms menu or on the form's page, and it appears on Home with **Open**. Favourites you can no longer open are hidden.
- **One list, four tabs.** Home remembers the tab you last used, and each tab has search, paging and a phone layout.
  - **My tasks** shows the process and stage of each task.
  - **Task queue** has **Accept** for tasks sent to you, and **Claim** for unassigned tasks of your teams.
  - **Following** lists the processes you follow.
  - **My submissions** shows each form you sent, with the process it started, its status, the current stage, the people involved and the last update.
- **View flow.** Anyone who submitted a form can now see where their request is, even without permission to view workflows. The diagram highlights finished steps and the current one, with step names, assignees and dates. It never shows step settings, outputs, variables or anyone else's values.
- **View stage.** Click the stage name in a list to see who has the step and since when.
- **Follow / Unfollow** on the run view, on submissions and in Following. Processes you start are followed for you automatically, including the ones your form submissions start. You can turn this off with **Auto-follow processes I start**.
- **API, MCP and CLI.** Everything on Home is also available outside the app:
  - REST: `GET /home/metrics`, `/home/tasks`, `/home/queue`, `/home/submissions`, `/home/following`, `/home/runs/{id}/progress`, `/home/favorite-forms` and `/home/preferences`; `PUT` and `DELETE` to follow, unfollow, star and unstar; `POST /tasks/{id}/claim`.
  - MCP: the `home_*` tools and `tasks_claim`.
  - CLI: `usertasks home …` and `usertasks tasks claim`.

## Upgrading

Migration `20261217000000_home_dashboard` is additive. It adds:

- the `run_followers` and `form_favorites` tables, each with RLS;
- three columns on `workflow_runs`: `started_by`, `started_via` and `form_submission_id`, filled in for existing runs from their stored variables;
- `tasks.workflow_run_id`;
- the Home read functions;
- the auto-follow trigger.

People already follow the in-progress runs they started; finished runs are not followed. The app works before the migration is applied: until then, the new run and task columns are skipped.
