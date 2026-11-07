# Event registration with session choices

Group registration for events with limited-seat sessions, built only from UserTasks features and official form controls:

- **Event registration with sessions** form page in four **steps** with a progress bar and a review step: a **lookup** into **Events** (fills the date and venue), a **Table** control for the attendees (name, email, dietary needs, accessibility needs), first and second choice session **lookups** into the **Sessions** table (filtered to the chosen event), a **Slider** (sessions they plan to attend), a **Rating** (interest in networking) and **Rich text** (questions for the speakers).
- **Event registration** workflow (Form submitted): `COUNT` on the attendee table, data table *get* for the event and both sessions, a **Seat allocation decision table** (first choice, second choice or waitlist), the **Registrations** table, seats taken updated on **Sessions** and **Events**, a **loop** that records each attendee in **Attendees** and sends them a confirmation email, and a summary email to the contact. Waitlisted groups get an organiser task with an **SLA**, reminder and escalation (**Info card**, **Progress** bar) to offer another session or keep them waiting.
- **Organiser dashboard** form page: a **Progress** bar of the chosen event's seats filled, **Chart** controls (seats taken vs capacity per session, registrations by status), **Saved report** controls (attendees by session, attendees by dietary need, from workflow variables), and a button that runs the **Attendee list** workflow.

The form controls install with the package (Extensibility → Form controls). No integrations or API keys.

## After installing

1. Replace the sample rows in **Events** and **Sessions**. The session lookups store the **Session** column, so keep it unique (the samples add the event name).
2. Open **Forms → Event registration with sessions** and share its page link (`/f/<id>`), or submit it from your site with `POST /api/v1/forms/{id}/submit`.
3. Open **Forms → Organiser dashboard**, pick an event and press **Email me the attendee list**.
4. Waitlisted groups go to the person who installed the package. Change the **Offer an alternative session** step's assignee if someone else organises.
5. Optional: apply the **Registrations: 12 months after the event** retention policy.

## How seats are given out

The workflow works out the spare seats *after* this group: event capacity minus seats taken minus attendees, and the same for each chosen session (a session from another event counts as full). The **Seat allocation** decision table then waitlists the group if the event is full, otherwise books the first choice if it fits, else the second, else waitlists them. Booking adds the attendees to the seats taken on the session and the event.
