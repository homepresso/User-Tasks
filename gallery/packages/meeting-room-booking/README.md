# Meeting room booking

Room requests with automatic approval rules, built only from UserTasks features: a **themed start form** (grid layout, indigo mini theme) on the workflow trigger, the **Rooms** data table, a **decision table** for approvals, an approval **task form** with **Approve** / **Reject** buttons and confirmation **email templates**.

## After installing

1. Edit **Rooms** with your rooms (seats, floor, equipment). If you add or rename rooms, update the **Room** options on the workflow's inputs.
2. Set the default of **Facilities approver (user id)** on the workflow's inputs to the person who approves bookings. Empty means the organiser reviews it themselves, which is handy for a demo.
3. Tune **Room booking approval**: the first matching rule wins.

## How it works

| Rule | Needs approval |
|---|---|
| More attendees than seats | yes, within 4 hours |
| Large room (12+ seats) | yes |
| Longer than 4 hours | yes |
| Catering requested | yes |
| External guests / anything else | no, confirmed automatically |

Each request is logged in **Room bookings** (`pending approval`, `confirmed` or `declined`). Facilities choose the setup (boardroom, U-shape, classroom…), tick catering ordered and write a note that goes into the email.
