# Contract renewal reminders

A daily check of your contract register with 60 / 30 / 7 day reminders and a renewal decision for the owner.

## What's inside

- **Daily contract renewal check** workflow (schedule, every day at 07:00 UTC)
- **Contract renewal decision** workflow (started per contract 30 days before the notice deadline)
- **Contracts** data table with eight sample contracts
- Two email templates: notice reminder and decision recorded

## How the deadline is worked out

Notice deadline = end date − notice period (days). Days left = notice deadline − today. Reminders go out when days left is exactly 60, 30 or 7, so each owner gets each reminder once. The renewal decision starts once per contract (its row is marked "Decision requested").

## After installing

1. Pick the default contract owner and complete setup.
2. Replace the sample rows with your contracts.
3. Try it: **Automations → Workflows → Daily contract renewal check → Run** with `as_of` set to a date, and check the run log.

## New in 1.1.0

- **Decide on renewal** has Renew / Renegotiate / Terminate buttons, a header and a grid.
