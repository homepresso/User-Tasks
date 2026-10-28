# Policy attestation

Monthly read-and-understood campaigns with reminders, escalation and an attestation register.

## What's inside

- **Monthly policy attestation** workflow (schedule, 1st of the month at 08:00 UTC)
- **Attest policy** workflow (one run per employee: attest, question, exemption)
- **Policies** data table with seven sample policies and **Attestations** data table (the audit trail)
- **HR system** REST integration with *List active employees*
- Two email templates: campaign summary and attestation receipt

## After installing

1. Complete setup: the HR system's base URL and token, the default attestation recipient and the compliance officer.
2. Replace the sample policies with yours and set their next due dates.
3. Try it: **Automations → Workflows → Monthly policy attestation → Run** with `as_of` set to a date on or after a policy's next due date.

Export the Attestations table (Data → Attestations) as evidence for audits.

## New in 1.1.0

- **Attest to policies** has Attest / I have a question buttons and a header.
- **Answer policy question** has Answered / Exempt buttons, a grid and a **Policies** lookup that fills the policy owner and document link.
