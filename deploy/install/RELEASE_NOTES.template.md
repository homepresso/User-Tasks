## UserTasks {{version}}

<!-- Write the highlights here: new features, fixes, anything people must do. -->

### Install

```sh
curl -fsSL https://usertasks.com/install.sh | sh -s -- --version {{version}}
```

On Windows (PowerShell, Docker Desktop):

```powershell
& ([scriptblock]::Create((irm https://usertasks.com/install.ps1))) -Version {{version}}
```

### Upgrade

```sh
usertasks upgrade --to {{version}}
```

It backs up first, verifies this release, applies the migrations, switches and health-checks, and rolls the code back by itself if the new version doesn't come up. Other ways of running UserTasks: [Upgrade to a new release](https://usertasks.com/docs/self-hosting/upgrade).

### Database migrations

{{migrations_count}} new since {{previous}}:

{{migrations}}

Migrations are additive: the previous version keeps working on the newer schema, so rolling the code back doesn't need them undone.

### Verify

- Image: `{{image_ref}}` (multi-arch: linux/amd64, linux/arm64; build provenance and SBOM attached)
- Bundle: `{{bundle}}`, listed with the installers in `SHA256SUMS`
- `SHA256SUMS.sig`: ed25519 signature; signer fingerprint `{{fingerprint}}`
- `SHA256SUMS.sigstore.json`: the same file signed keyless with Sigstore (`cosign verify-blob`)

The installers check the signature and checksums before they run anything from the release.
