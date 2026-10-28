# Package gallery

The [UserTasks gallery](https://usertasks.com/gallery) is where the community uploads and shares
solutions. It lists two kinds of package:

- **Official** — the sources in this folder, built and signed by the maintainers. Contribute one
  with a pull request (see below and [CONTRIBUTING.md](../CONTRIBUTING.md#gallery-packages)).
- **Community** — shared by users at [usertasks.com/gallery/share](https://usertasks.com/gallery/share),
  validated automatically and approved by a moderator before they are listed (see
  [Community gallery](#community-gallery)).

Each official package is a folder in the config-as-code layout; `npm run gallery:build` turns every
folder into a signed `.utpkg` (the same format **Automations → Packages** builds) under
`public/gallery/`.

```
gallery/
  signing.json                     public fingerprint + key of the "UserTasks Gallery" signing key
  packages/<slug>/
    gallery.json                   metadata (lib/gallery/types.ts → GalleryMeta)
    README.md                      readme shown by the install wizard
    assets/                        a config-as-code folder (`usertasks config apply` works on it too)
      workflows/<name>-<id>.json   one envelope per asset: { format_version, asset_type, id, asset }
      integrations/ references/ decision-tables/ data-tables/ email-templates/ agents/ …
      data-rows/<table>-rows-<id>.json   sample rows → packaged as data (mode "rows")
public/gallery/                    built packages + index.json (generated, committed)
lib/gallery/catalog.json           what the /gallery pages render (generated, committed)
```

## Rules for a gallery package

`lib/gallery/validate.ts` enforces them (`__tests__/gallery-packages.test.ts` runs it on every package):

- Real workflows from existing node types: one trigger, every step reachable, every User Task
  outcome and condition branch connected, node settings valid (`lib/workflow-validation.ts`).
  No `placeholder` or `http_request` nodes: calls go through an integration + reference.
- Every id a node points at (reference, decision table, data table, template, sub-workflow, agent)
  is in the package.
- Integrations use placeholder hosts (`https://<system>.example.com/…`) and `__SECRET__` for
  credentials; installs ask for the real base URL and token. References carry a response model
  (`request_config.response_schema`) with a realistic sample.
- People never travel: a User Task has a placeholder `assignee_id` (the wizard asks who receives
  each step; gallery packages make this required), or is routed only by an `assignee_variable`
  (a Person field `{{form.approver}}`, `{{submitted_by}}` on Form submitted runs,
  `{{workflow_started_by}}` for the person who started the run, `{{workflow_owner_id}}` for the
  person who installed the package).
- Forms are checked like the designer checks them: field definitions, lookups (the data table is
  in the package and every search / display / value / fill column exists), outcome buttons that
  match the step's outcomes, redirects to app paths only, valid mini-theme references.
- `gallery.json` has the category, trigger kind (`form`, `api`, `schedule`, `event`), needs,
  setup steps, flow steps, a `sample_input` and what a run with it reaches (`expect`). A
  form-started package starts either from the workflow start form (webhook trigger with
  `start_form: { layout, theme }` on the trigger node) or from a reusable **form page**
  (`entry_form`): its Form submitted trigger, or its Submit button's Start workflow action.
  `sample_input` values may be `"$owner"` (the verifying user, for Person fields).
- `systems` names the third-party systems for the chips (`["Workday"]`, `["SAP S/4HANA"]`).
- **No integrations needed**: a package with no integration, connector, AI agent or MCP server and
  no install-time requirement gets the badge automatically (`isNativeContents`); its install is
  complete as soon as it lands, and `gallery:verify` checks exactly that.

## Commands

```bash
npm run gallery:build -- --validate <slug>      # check one package (no output)
npm run gallery:build                           # build everything (unsigned without a key)
npm run gallery:check                           # CI/test: committed outputs match the sources
npm run gallery:build -- --out /tmp/g <slug>    # build a subset elsewhere …
npm run gallery:verify -- --dir /tmp/g <slug>   # … and verify it against a local stack
npm run gallery:verify                          # install + run every package (local stack only)
```

`gallery:verify` needs a **local** stack (it refuses any other database): it creates a scratch
workspace, installs each package incomplete, completes setup against an in-process mock API that
answers every reference with its response-model sample, starts the entry workflow with
`sample_input` (or submits the entry form, as people do), checks the run reaches `expect` (waiting on a User Task assigned to the
install-time assignee, or completed) and deletes the workspace. Env: `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`.

## Community gallery

On usertasks.com (`DEPLOYMENT_MODE=cloud`, or `GALLERY_COMMUNITY=on` elsewhere) signed-in users
share packages from **/gallery/share**:

1. **Submit** — the `.utpkg` (at most 5 MB) with a title, summary, description, category, tags,
   licence (SPDX id, Apache-2.0 by default), author name and optional link, version notes,
   optional sample input, and up to six screenshots (PNG / JPEG / WebP checked by their bytes,
   SVGs sanitised). Five submissions a day per user, ten per address.
2. **Automatic validation** (`lib/gallery/community.ts`) — the package format (checksums; a
   signature is optional but must verify), no credential material, and this folder's validator on
   its assets: real node types and settings, every path connected, every id inside the package,
   placeholder hosts only, no `http_request` / `placeholder` nodes, custom code, MCP servers or log
   destinations, valid forms and lookups. A failing package is refused with its issues; nothing is
   stored.
3. **Moderation** (Settings → **Gallery review**, instance admins only: `INSTANCE_ADMIN_EMAILS` /
   `instance.admin_emails` with a verified email) — the moderator sees the listing, screenshots,
   validation report and hosts, can run the **headless verification** (the `gallery:verify` engine
   in a scratch workspace; `GALLERY_HEADLESS_VERIFY=native` by default runs packages without
   integrations, `all` adds the mock-API run on a review instance with `ALLOW_PRIVATE_EGRESS=true`),
   then approves (the stored file is re-validated) or rejects with a reason. The submitter is emailed
   either way through the instance's email provider.
4. **Listing** — approved packages appear as **Community** with the author, licence, version
   history and download count; only the original author can publish newer versions. Anyone can
   **Report abuse**; a moderator can unlist a package at once.

`/api/gallery/index` publishes Official + Community entries (`source: official | community`).
Self-hosted instances read it from `GALLERY_INDEX_URL` (default
`https://usertasks.com/api/gallery/index`, `off` for air-gapped installs) for **Browse gallery**,
through their own server.

## Signing (maintainers)

Gallery packages are signed with a dedicated **UserTasks Gallery** ed25519 key, separate from any
instance key. Only its public fingerprint is published (here in `signing.json`, in
`public/gallery/index.json` and on the website).

1. Create the key once, on a trusted machine:

   ```bash
   openssl genpkey -algorithm ed25519 -out usertasks-gallery.pem
   ```

2. Store the PEM in the team password manager / secret store (for example a 1Password item, and a
   `GALLERY_SIGNING_KEY` secret in a protected GitHub Actions environment if releases run in CI).
   Delete the local file afterwards. Never commit it (`*.pem` is git-ignored).
3. Pin its public values (prints and writes only the fingerprint and public key):

   ```bash
   GALLERY_SIGNING_KEY="$(cat usertasks-gallery.pem)" npm run gallery:build -- --pin
   ```

   Commit `gallery/signing.json`. From then on the build refuses to sign with any other key.
4. Release build:

   ```bash
   GALLERY_SIGNING_KEY="$(op read 'op://Release/UserTasks Gallery/private key')" npm run gallery:build -- --require-signature
   git add public/gallery lib/gallery/catalog.json && git commit -m "Gallery: signed build"
   ```

Signatures cover the package checksum only, so signing an existing build does not change its
checksum or version. Without `GALLERY_SIGNING_KEY` the build is unsigned and `index.json` and the
website say so (development preview).

**Rotation:** create a new key, pin it with `--pin`, rebuild with `--require-signature`, and publish
the new fingerprint (the website and docs read it from `index.json`). Instances that trust the old
fingerprint in `PACKAGE_TRUSTED_FINGERPRINTS` should add the new one.

## Releasing a new version of a package

Edit the sources, bump `version` in `gallery.json`, add a `changelog` entry (version, date, notes),
then build. Installing the new file upgrades existing installs in place.
