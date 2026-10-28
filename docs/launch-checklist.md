# Public launch checklist

The source repository stays private until launch, when the code moves to a
public repository (its URL may differ from today's). Until then no repository
URL is published anywhere: the site hides every repository link and the npm
packages carry no repository metadata. At launch, work through this list.

## Repository

The public repository starts from a fresh history: one commit made by
`scripts/public-export.sh`, never the private repository's history (it holds
the hosted project's identifiers and old local tool config).

1. Keep a denylist of private strings **outside** the repository, one per
   line, at `~/.config/usertasks/public-denylist` (or pass `--denylist`):
   the hosted Supabase project ref, personal email addresses, hosted
   deployment hostnames and anything else that must never be published. The
   export fails if any of them appears.
2. Dry run, then the real export (both need gitleaks, or Docker):

   ```bash
   scripts/public-export.sh --ref main --out ../usertasks-public \
     --author "UserTasks <maintainer@example.com>"
   ```

   It archives `--ref`, drops the paths in `.public-exclude`, scans with
   gitleaks (`.gitleaks.toml`, default rules plus a small fixture allowlist)
   and the denylist, stops on any finding, then creates one commit
   "UserTasks <version> — initial public release". It never pushes.
3. Once the GitHub URL is known, run the URL switch (below) at `main` and
   commit it before exporting, or in the export (`--amend` the single commit).
4. Push: `git -C ../usertasks-public remote add origin git@github.com:<owner>/<repo>.git && git -C ../usertasks-public push -u origin main`.

- [ ] Enable **private vulnerability reporting** (Settings → Code security).
      `SECURITY.md` points there after the URL switch.
- [ ] Add the `NPM_TOKEN` repository secret (npm automation token with
      publish rights on the `@usertasks` scope) for
      `.github/workflows/release.yml`. PR CI (`ci.yml`) needs no secrets;
      `release.yml` runs only on `sdk-v*` / `cli-v*` tags or by hand, never
      on forks, and `release-gates.yml` only on `v*` tags or by hand.
- [ ] Optional: protect `main` (require the CI `check` job) and enable
      Dependabot alerts (`.github/dependabot.yml` already configures update PRs).

## Repository URL switch

One command updates every place that names the repository:

```bash
node scripts/set-repository-url.mjs https://github.com/<owner>/<repo>   # --dry-run to preview
```

It sets `repository` / `homepage` / `bugs` in `packages/sdk` and
`packages/cli` `package.json`, the README clone URL and badges (CI, npm,
licence), `SECURITY.md` reporting instructions and the issue template's
security link, then prints the hosted deployment's
`NEXT_PUBLIC_REPOSITORY_URL` value. It is idempotent: run it again to change
the URL. The sections below are what it covers, for checking by hand.

## Website and docs

- [ ] Set `NEXT_PUBLIC_REPOSITORY_URL` to the public repository URL (for
      example `https://github.com/<org>/<repo>`, no trailing slash) in the
      cloud deployment's build environment and rebuild. It is inlined at
      build time. Once set, the landing page shows its GitHub links again,
      the "source release coming at launch" note disappears, and the home
      page's JSON-LD gains `sameAs` and a `SoftwareSourceCode` node with
      `codeRepository`.
- [ ] Check `/`, `/docs`, `/docs/cli`, `/docs/sdk` and `/open-source` show the
      repository link where expected.

## npm packages

- [ ] Add `repository` (`{ "type": "git", "url": "git+<repo>.git",
      "directory": "packages/<name>" }`), `homepage`
      (`<repo>/tree/main/packages/<name>#readme`) and `bugs`
      (`{ "url": "<repo>/issues" }`) to both `packages/sdk/package.json` and
      `packages/cli/package.json`. npm provenance (`--provenance` in the
      release workflow) requires `repository.url` to match the repository the
      workflow runs in, so publishing fails until this is done.
- [ ] Optionally link "UserTasks" in the first paragraph of
      `packages/sdk/README.md` and `packages/cli/README.md` to the repository
      (these READMEs are also rendered at `/docs/sdk` and `/docs/cli`).
- [ ] Create or claim the `@usertasks` npm organization, then publish the SDK
      before the CLI (tag `sdk-v<version>`, then `cli-v<version>`).

## README

- [ ] Replace `git clone <this repo>` in `README.md` with the public clone URL
      and add any badges (CI status, npm versions, licence) that point at the
      public repository.
