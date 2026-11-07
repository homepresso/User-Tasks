# Release notes: flexible task queue rules

Each person's rules for which new tasks are queued (they accept or decline
them) and which go straight to their list are now much more expressive, and
can be edited from the task lists.

## New

- **Queue rules button** (sliders icon, next to Refresh) on **My tasks**
  (`/tasks`) and Home's **My tasks**: a dialog (bottom sheet on phones) with
  a live summary, the rules editor (the same component as Settings →
  Preferences) and **Test a task** — sample attributes in, *Queue* or *Add*
  out, with the rule that decided. The preview runs on the server
  (`tasks.queueRulesPreview`) with the person's real manager chain, reports
  and the sample assigner's teams / units / projects. Saving
  (`saveMyQueueRules`, own row only, validated server-side) refreshes the
  lists.
- **Rules version 2** (`users.preferences.queue_rules`, `version: 2`): each
  rule has an id, optional name, on / off, match **all** or **any**, up to
  20 conditions and *queue* / *add*; up to 50 rules, first enabled match
  wins; duplicate and reorder in the editor. Optional `working_hours`
  (days, start, end, time zone).
- **Conditions** (field / operator / value):
  - who it's from: assigned by people; relationship (self, my manager,
    manager chain, direct report, anyone I manage, no person); assigner's
    team, org unit (units above included) or project (direct or via a team);
  - where it came from: source tags (workflow, manual, form, API, MCP,
    agent, ingest, redirect, escalation, reassign, invite, AAD group, team
    pool); workflow; form; how it reached me (directly, team, AAD group,
    collaborative); assigned through team;
  - what it is: priority (at least / at most / is / in), due (within / later
    than N, overdue, set, not set), title or title + description (keywords,
    safe regex), has attachments, is a subtask, tags (any / all / none);
  - when it arrives: day of week, inside / outside working hours (the
    person's `users.timezone`, else the rules' time zone, else UTC).
- Every path that lands a task now passes what it knows (source tags, form,
  team, due date, title, description, tags, subtask): the workflow engine
  (User Task and AAD group *everyone* members), task creation, redirect /
  escalate / invite, manager reassignment, scheduled escalations, MCP and
  agent tools. Org data loads once per batch
  (`decideAcceptanceForAssignees`) and only when someone's enabled rules
  use org conditions.

## Compatibility

- Version 1 rules (`{ default, rules: [{ when, then }] }`) are migrated on
  read with identical behaviour and accepted on save (stored as version 2).
  Without saved rules, `queue_bypass_priority` (default High) still applies
  as before. The User Task node's `queue_behaviour` override still wins.
- A condition about something the landing path doesn't know never matches
  (either operator); org conditions without org data don't match.
- Queue rules aren't exposed in the public API / MCP / CLI (they weren't
  before), so there is nothing to keep in parity.
