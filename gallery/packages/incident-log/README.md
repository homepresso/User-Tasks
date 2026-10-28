# Workplace incident log

An incident reporting form and register, built only from UserTasks features: a reusable **form page** (grid layout, banner header, a safety-orange mini theme) with a **lookup** into the **Incident sites** table, the **Form submitted** trigger, the **Incident severity** decision table, **set_sla**, the **Incidents** register with a **retention policy** applied per row, email templates and investigation tasks with **Close / Escalate** buttons.

## After installing

1. Share **Forms → Report a workplace incident** (`/f/<id>`), e.g. as a QR code at each site.
2. Replace the sample rows in **Incident sites** (site code, name, site manager and their email).
3. Check **Incident severity** against your policy. The default rules:

| Rule | Severity | Respond within | Investigation |
|---|---|---|---|
| Serious injury / hospital | Critical | 24 h | yes (possibly notifiable) |
| Lost time | High | 48 h | yes |
| Medical treatment | High | 72 h | yes |
| Environmental | High | 72 h | yes (possibly notifiable) |
| Vehicle | Medium | 96 h | yes |
| First aid only | Medium | 120 h | no |
| Near miss | Low | 168 h | no |
| Everything else | Low | 120 h | no |

## How it works

- The workflow reads the site, rates the incident, starts the **Incident response** SLA (warning at 75%), inserts the register row with the **Incident records: 7 years** policy (review, not purge) and emails the site manager.
- Investigations go to the installer (health and safety lead), due by the SLA with a reminder 4 hours before and escalation to their manager after a day. **Close** stores the root cause and actions; **Escalate** emails the site manager and creates a senior review task.
