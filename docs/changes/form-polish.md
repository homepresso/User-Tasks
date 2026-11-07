# Release notes: Form loading polish, the UserTasks sign-in look and a workspace-theme option

Form pages now show a polished loading state, and the form sign-in page
gets a refreshed default design in the UserTasks colours plus an option to
use the workspace theme. No database change.

## Form loading

- **A skeleton of the form card while it loads.** `/f/<id>`,
  `/form/<system name>`, `/p/<token>` and the in-app `/fill/<id>` show the
  shape of the form (header, fields, button bar, with a shimmer) and a
  small "Loading form…" spinner pill, instead of a line of text. It fades in
  only after a short delay, so quick loads don't flash, and takes the
  workspace theme where there is one (UserTasks colours otherwise).
- **A smooth hand-off.** When the form is ready it runs its own load
  animation (Subtle / Expressive). A form set to **None** fades in briefly
  from the loading state instead. Nothing moves under the system's
  **reduce motion** setting.
- **Public links** (`/p/<token>`) check the link first, so an unavailable
  link is still a real 404, then stream the form in behind the skeleton.
- **Embedded forms** (`?embed=1` or framed) show a compact spinner on the
  transparent page; the frame's height is posted to the host page again as
  soon as the form is in.
- **Busy buttons.** The button whose action is running always shows a
  spinner (also on forms with animations off), and the sign-in button shows
  one while signing in. New reusable `components/ui/spinner.tsx`
  (`role="status"` with screen-reader text, or decorative inside a busy
  button).

## The form sign-in page

- **Design 1 is now "UserTasks"** — the default, in the look of the app's
  own sign-in page: a brand panel with the UserTasks logo and a Fraunces
  headline beside a clean form, on the UserTasks warm neutrals, with a chip
  naming the workspace. It stacks on phones. Uploading a logo replaces the
  UserTasks logo. Stored values are unchanged (design 1 is still design 1).
- **UserTasks colours by default.** With no accent colour set, buttons and
  coloured panels use the UserTasks ink (they used to follow the workspace
  theme's primary colour — that's what the new option below is for).
- **Use the workspace theme** (new, off by default): the page takes the
  workspace theme's colours, surfaces, text, corners, fonts, light / dark
  mode and background. The design, logo and wording still apply; the accent
  colour is not used (its field is disabled in Settings with a hint). The
  settings preview shows it live. The theme is turned into design tokens on
  the server — nothing else of the workspace reaches the page.
- **All ten designs refreshed**: surfaces and text follow the design tokens
  (so the workspace theme, dark mode included, carries through), 44px inputs
  and buttons with the theme's corners and a soft focus ring, "or continue
  with" between password and single sign-on, a short rise-in of the card.

## API, MCP and CLI

`use_workspace_theme` (boolean) on `GET` / `PATCH
/api/v1/workspace/form-sign-in-page`, MCP `form_sign_in_page_get` /
`form_sign_in_page_update`, and `usertasks form-sign-in-page update`. Design 1 is listed as "UserTasks".
