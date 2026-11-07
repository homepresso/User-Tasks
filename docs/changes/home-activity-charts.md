# Release notes: My activity charts on Home

Home now has a **My activity** section below the cards. Its charts cover only your own work in the current workspace, in your theme's colours.

## What's new

- **A period for the whole section**: 7, 30 (the default) or 90 days. Home remembers your choice in this browser.
- **Tasks completed**: a column per day, or per week for 90 days, plus your busiest day or week.
- **My decisions**: your approval rate as the headline ("53% approved"), and a bar split into Approved, Rejected, Sent back and your workflows' own outcome labels. Approval rate = approved ÷ all decisions. Plain completions such as Done or Submitted aren't decisions, so they don't count towards the rate. The **(i)** next to the title lists which labels count as which.
- **Time to complete**: the median and p90 time from a task being assigned to you to you completing it, with a trend line for each. **Time to pick up** (assigned to accepted or claimed) is shown for tasks that had to be accepted or claimed.
- **On time**: the share of your tasks completed by their due date, or by their process's SLA when a task has no due date.
- **Processes I work in most**: the five workflows most of your completed tasks came from.
- **My submissions**: the forms you submitted, grouped by the status of the process each one started, with the median time from submitting to that process completing.

Every chart has a tooltip, an explanation of how it's measured, a **Table** view and a screen-reader summary. Each one has an empty state and a loading skeleton. Days follow your browser's time zone. Numbers use your browser's locale.

## Colours

The series colours come from your workspace theme: its brand colour, chart colours and success, warning and danger colours. Home checks at runtime that neighbouring series can be told apart, including with colour-vision deficiency. It falls back to a tested palette when a custom theme's colours are too close.

## API, MCP and CLI

- REST: `GET /api/v1/home/stats?period=7d|30d|90d&timezone=Pacific/Auckland`.
- MCP: `home_stats`.
- CLI: `usertasks home stats --period 30d`.

Each returns the same aggregates as the charts, for the calling person only, so it needs a credential bound to a user.

## Upgrading

Apply migration `20261220000000_home_activity_stats.sql`. It adds the `home_task_stats` and `home_submission_stats` reads, the outcome mapping function, and an index on `task_responses (tenant_id, user_id)`. It is additive and safe to re-run.
