# Event registration

Event sign-ups with a capacity check and waitlist, built only from UserTasks features: a reusable **form page** (three-column grid, centred header, a pink mini theme) with a **lookup** into **Events** that fills the date, time and venue, a **success screen** with the reference, the **Form submitted** trigger, the **Registrations** table, a capacity count (data table *list* with a count output), confirmation / waitlist emails and an organiser task with **Confirm / Decline** buttons.

## After installing

1. Share **Forms → Event registration** (`/f/<id>`).
2. Replace the sample rows in **Events**; only `Open` events appear on the form.
3. Special requests go to the installer (the organiser).

## How it works

- Reference: `REG-` + the first 8 characters of the form submission id, shown on the success screen and used in the emails and the table.
- **Count confirmed places** lists the event's `Confirmed` registrations; when the count has reached **Capacity** the attendee is `Waitlisted` (position = waitlisted so far + 1), otherwise `Confirmed`.
- A confirmed attendee with a special request creates **Organiser reviews the request**; the reply is stored (`Confirmed` / `Declined`) and emailed.
- To promote someone from the waitlist, change their row to `Confirmed` and email them (or add a Data table event workflow on Registrations).
