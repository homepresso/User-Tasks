# Probation review

A daily scheduler that starts a manager review for every probation ending soon, and records the outcome.

## What's inside

- **Probation review scheduler** workflow (daily at 08:00 UTC)
- **Probation review** sub-workflow, one run per employee
- **Probation outcome** decision table (recommendation × rating → action, status, extension)
- **HR system** integration with *List probations ending soon* and *Update probation*
- Two email templates: outcome for HR and probation passed for the employee

## After installing

1. Complete setup: the HR system base URL and API token, and the default reviewing manager.
2. Set hr_email and lookahead_days on the scheduler workflow's variables.
3. The schedule activates with the workflow. To try it now, open **Probation review scheduler** and click **Run**.

## New in 1.1.0

- **Review probation** has a Submit review button, a header and a grid.
