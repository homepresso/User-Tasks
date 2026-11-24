# Release notes: one sign-in page for forms and apps, friendly app links

The branded form sign-in page is now the workspace's **sign-in page for forms
and apps**. Admins design it once (Settings → Sign-in page, also under
Settings → Forms) and both form links and apps use it.

## New

- **Apps use the workspace sign-in page.** Someone who isn't signed in and
  opens an app (`/apps/<slug>[/<page>]`, `/app/<slug>`, `/embed/apps/<slug>`)
  sees the branded page at `/sign-in` and comes straight back to the app.
  After signing in, the app's usual checks apply: someone outside the
  audience sees **This app isn't available**, which now offers the sign-in
  page's support link; the audience sees the published version.
- **Use this page for: Form links / Apps.** Both are on by default. Turn one
  off to send those visitors to the standard UserTasks sign-in instead.
- **Per-app choice.** App settings → **Share & sign-in → Sign-in page**:
  follow the workspace setting (the default), always use the workspace
  page, or always use the standard sign-in. Like the audience it takes
  effect at once and isn't part of the draft (`sign_in_page` on the app in
  REST, MCP and the CLI: `workspace`, `standard` or `null`).
- **Friendly app links: `/app/<slug>[/<page>]`.** These work like
  `/form/<name>`. On a workspace address
  (`https://acme.usertasks.com/app/crm`) they resolve in that workspace only.
  On the main address they resolve in the person's current workspace. A
  workspace without its own address shares
  `https://<main address>/app/<slug>?org=<workspace>`: `org` names the
  workspace for the sign-in page and opens it after sign-in (for members
  only). `?embed=1` opens the full-screen view. Reserved and invalid slugs
  return 404. App settings → **Share & sign-in** shows the friendly,
  full-screen and in-app links, each with Copy.
- **App colour accent** (optional, off by default): **Use each app's colour
  as the accent** tints an app's sign-in page with that app's colour.
- The default welcome message reads "This app is for members of the
  workspace…" on an app's sign-in page.

## Compatibility

- **Storage:** the settings moved to `tenants.settings.sign_in`. A workspace
  that saved the form sign-in page before this release keeps it at
  `tenants.settings.forms.sign_in`, which is read as the fallback. The next
  save writes the new key; the old copy is left unused. **No migration.**
  If you roll back, the older release reads the old copy, so it shows the
  design as it was before the first save under this release.
- **Defaults:** `use_for_forms` and `use_for_apps` default to **on**.
  Form links behave exactly as before. Apps used to send signed-out visitors
  to the plain `/login`; they now get the workspace's branded page, which
  until someone customises it is the UserTasks design. On the main address
  with no workspace named (no `?org=`), apps still go to `/login` as before.
- **`/form-login` keeps working.** Form links still redirect there, so
  existing links and iframes are unchanged and it stays frameable. `/sign-in`
  renders the same page and is not frameable: embedded apps sign in at the
  top level or in a new tab.
- **API / MCP / CLI:** new `GET`/`PATCH /api/v1/workspace/sign-in-page`, MCP
  `sign_in_page_get` / `sign_in_page_update`, and
  `usertasks sign-in-page get|update`. The old names
  (`/workspace/form-sign-in-page`, `form_sign_in_page_*`,
  `usertasks form-sign-in-page`) are aliases for the same settings. New
  fields: `use_for_forms`, `use_for_apps`, `use_app_color`.

## Security

- The return path is still relative and limited to form links (`/f/…`,
  `/form/…`) and app paths (`/apps/…`, `/app/…`, `/embed/apps/…`, using app
  slug characters only, with an optional query). Anything absolute,
  protocol-relative, backslashed, containing `://` or control characters, or
  pointing at any other page is ignored. The host never changes, so a
  workspace address never sends someone to another workspace's address.
- The sign-in page never shows an app's name and redirects whether or not
  the app exists.
- A signed-in `?org=` hint switches workspace only for active members, using
  the same `switch_tenant` RPC (which checks membership).
