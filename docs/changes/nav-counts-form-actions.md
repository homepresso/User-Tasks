# Release notes: Menu counts, favourite and Save draft icons on forms

## What's new

- **Counts in the side menu.** **My Tasks**, **Task Queue** and **Task Tracker** now show how many items are waiting, for example **My Tasks 4**.
  - **My Tasks** matches the Home **My tasks** card: your open tasks that aren't waiting for you to accept them.
  - **Task Queue** matches the card's *in your queue*: tasks waiting for you to accept them, plus unassigned tasks of your teams.
  - **Task Tracker** counts the open tasks you assigned to someone else. These are the tasks its default view, **Assigned by me**, lists, without the completed and cancelled ones.

  There is no badge at 0, and large numbers show as **99+**. With the menu collapsed, a dot on the icon shows that something is waiting. On a phone, the counts are in the menu drawer and on the **Tasks** tab. Screen readers hear "My Tasks, 4 pending". The counts refresh when you come back to the tab, every minute, and as soon as you complete, claim or accept a task.
- **Favourite and Save draft icons on forms.** Forms now have two icons at the top right, on their own page (`/f/<id>`) and in the **Run** dialog of a workflow that starts from them:
  - **♡ Favourite** adds the form to your favourites or removes it.
  - **💾 Save draft** keeps your answers so far. Next time you open the form, it asks **Resume your draft from <date>?**, with **Resume** and **Start fresh**.

  Your draft is deleted when you submit the form. Files are kept as references to your uploads, never copied. Your drafts are also listed under **Drafts** on Home.
- **Designer setting.** **Buttons & header → Form icons** has **Show favourite button** and **Show save-draft button**. Both are on by default, for existing forms too. The setting is stored in the form's layout (`layout.form_actions`), so it goes with versions, export, packages and the API.

## Upgrading

Migration `20261218000000_nav_counts_form_drafts` is additive and idempotent. It adds:

- `nav_task_counts(tenant, user)`: the menu counts in one read;
- an index for the Task Tracker count;
- the `form_drafts` table, with RLS: a person can only read and write their own drafts, in workspaces they belong to.

Until the migration is applied, the menu shows no counts and **Save draft** reports an error. Everything else works as before.
