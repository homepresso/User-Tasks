# Car-pool & fleet booking

Pool car bookings, built only from UserTasks features: a **themed start form** (grid layout and mini theme on the Webhook trigger), the **Vehicles** and **Bookings** data tables, a clash check with data table filters, the **Booking approval** decision table, an **Approve / Reject** task form and confirmation emails.

## After installing

1. Replace the sample rows in **Vehicles** (registration, vehicle, seats, electric, range, pick-up location, status, fuel or charge card).
2. Update the **Vehicle** options on the workflow's `rego` input to your registrations.
3. Approvals go to the installer (the fleet coordinator); change the **Approve the booking** assignee if needed.

## How it works

| Check | Result |
|---|---|
| Vehicle status is not `Available` | declined, driver emailed |
| A `Confirmed` booking of the same car overlaps the times | declined as a clash |
| More people than seats / 300 km or more / more than 3 days / weekend | coordinator approval |
| Anything else | confirmed straight away |

Times are compared as ISO date-times (`2026-11-13T07:30`), which is what the start form sends. Confirmed bookings block the vehicle for others; rejected and clashing requests are kept for reporting.
