# Audit evidence collection

Monthly evidence for SOC 2 / ISO 27001 controls: pulled from systems where possible, requested from owners where not.

## What's inside

- **Scheduled evidence collection** workflow (schedule, 2nd of the month at 06:00 UTC)
- **Provide audit evidence** workflow (one run per manual control: submit or not applicable)
- **Controls** data table with eight sample controls and **Evidence log** data table
- **Evidence API** REST integration with *Get control evidence*
- One email template: the monthly summary

## After installing

1. Complete setup: the Evidence API base URL and token, the default control owner and the compliance lead.
2. Replace the sample controls with yours.
3. Try it: **Automations → Workflows → Scheduled evidence collection → Run** with `as_of` set to a date, then open **Data → Evidence log**.
