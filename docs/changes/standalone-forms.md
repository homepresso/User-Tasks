# Release notes: Standalone and embeddable form links, and a form sign-in page

Form links now open the form on its own page, without the app around it,
so they can be shared and embedded in websites. Forms that need sign-in
get a sign-in page of their own, designed in **Settings → Forms**. Nothing
is migrated (no database change): the sign-in page is stored with the
workspace's settings.

## What's new

- **Form links render on their own.** `/f/<id>`, the friendly link
  `/form/<system name>` and the public link `/p/<token>` show only the form,
  with its theme (header, colours, page background). There is no sidebar,
  top bar or workspace navigation, even for signed-in members. `/f/<id>` and
  `/form/<system name>` use the same rendering. **Close form** on the
  submitted page ends on a neutral "closed" page, as there is no app to go
  back to.
- **In the app nothing changes.** The Forms menu, Home favourites, search,
  **Open** in the Forms library and the Run dialog link open the form inside
  the app at the new address **`/fill/<id>`**. On a workspace address these
  used to open `/form/<system name>`; that link is now the one to share.
- **Embed in a website.** The form's **QR code** dialog has a new **Embed
  in a website** section:
  - **Copy embed code** copies an `<iframe>` for the chosen link with
    `?embed=1`: the form alone, on a transparent page with no outer
    padding.
  - An optional **resize script** for the host page. The embedded form
    posts `{ type: "usertasks:resize", height, path }` to its parent when
    its height changes. The script only trusts messages from the form's
    origin and its own frame, and sizes the iframe to fit.
  - Any form link opened in a frame uses the embedded look, even without
    `?embed=1`.
- **Form sign-in page.** When a form link needs sign-in, visitors who
  aren't signed in now go to **`/form-login`** on the same address, not the
  app's generic `/login`:
  - It offers the workspace's sign-in methods: password and the configured
    single sign-on buttons. It uses the same server actions as `/login`, so
    there is no new authentication logic. (There is no magic-link sign-in in
    the app, so there's none here either.)
  - After signing in the visitor goes straight back to the form.
  - On a workspace address with shared sessions, single sign-on starts on
    the main address, where the SSO callbacks are, and comes back through
    the `/ws/` hop.
- **Settings → Forms → Form sign-in page** (changing it needs **Edit
  settings**):
  - **Ten designs** in a thumbnail picker: Centered card, Split screen,
    Minimal, Gradient, Brand rail, Glass, Top banner, Dark elegant, Soft
    shapes and Compact. They are made with CSS only: no external images,
    fonts or hosts.
  - **Logo upload:** PNG, SVG, JPEG or WebP, up to 2 MB. SVGs are sanitised.
  - **Text:** heading, welcome message, button label, footer text and an
    optional support link (`https://` or `mailto:`).
  - **Accent colour:** follows the workspace theme until set.
  - A live **desktop / mobile preview** and **Reset to defaults**.
- **API, MCP and CLI:**
  - REST: `GET|PATCH /api/v1/workspace/form-sign-in-page`.
  - MCP: `form_sign_in_page_get` (`tasks.view_own`) and
    `form_sign_in_page_update` (`settings.edit`).
  - CLI: `usertasks form-sign-in-page get|update`.

## Security

- **Framing.** Only the form link pages can be framed by other sites:
  `/f/*`, `/form/*`, `/p/*` and `/form-login`. They send
  `frame-ancestors *` and no `X-Frame-Options`. Every other route keeps
  `frame-ancestors 'none'` and `X-Frame-Options: DENY`.
- **No session in a third-party frame.** In a frame from another origin
  (Fetch Metadata `Sec-Fetch-Dest: iframe` without
  `Sec-Fetch-Site: same-origin`), the form pages treat the visitor as signed
  out. They don't read the session or switch the visitor's workspace. A
  website can't use the frame to get a member to submit a form as
  themselves (clickjacking). Browsers already withhold the SameSite=Lax
  session cookies from cross-site frames. The server-side check also covers
  other workspace addresses, which are same-site but a different origin.
- **Why no per-workspace "allowed embed domains" list.** The proxy that
  sets the headers has no database access, so it can't read a
  per-workspace list. A frame from another origin never carries a session,
  so a list would add no protection for forms that need sign-in. Public
  forms are meant to be embedded. If one is needed later, it can be added as
  an extra check with no change to this behaviour.
- **Limitation: forms that need sign-in can't be filled in inside another
  website.** Third-party cookie blocking makes that impossible anyway. The
  frame shows **Open the form in a new tab** instead. Use a public link to
  collect answers on your page.
- **Open redirects.** `/form-login?redirect=` only accepts a form link path
  on the same host (`/f/<id>` or `/form/<name>`, with its query). Absolute,
  protocol-relative, backslashed and dot-segment paths, control characters
  and any other app path are ignored. The sign-in actions sanitise it again.
- **What the sign-in page shows.** Only the sign-in settings, the
  workspace's name and slug, and the theme's primary colour. They are read
  on the server; no other settings are exposed. For an `/f/<id>` link on the
  main address the page uses the form's workspace, so anyone with the link
  can see that workspace's sign-in branding.

## Before deploying

Nothing to apply: no migration and no new environment variable.
