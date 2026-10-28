# Air-gapped installs

For a network with no internet access at all: build a signed **bundle** on a
connected machine, carry it across, verify it, load it and install with
Docker Compose or Kubernetes. Nothing in UserTasks calls out at runtime (no
SaaS, CDN or telemetry; fonts and scripts are in the image, the docs site
is served by the app at `/docs`), and the release gate proves the whole path
on a host that can't reach the internet.

## What's in the bundle

| Path | Contents |
|---|---|
| `images/` | OCI images saved with `docker save` for one platform (gzip): the app (web, worker, migrations and `usertasks-admin` share one image) and its dependencies — PostgreSQL 16, MinIO, Valkey, Mailpit, OpenBao, Node.js (smoke test); optionally PgBouncer, Keycloak, local-kms. `images/images.txt` lists them |
| `charts/usertasks-<version>.tgz` | The [Helm chart](setup-kubernetes.md) |
| `compose/` | `docker-compose.yml` and the on-premises profile (`deploy/compose/onprem.yml`: an isolated network; `kms.yml`: OpenBao Transit), Keycloak realm, smoke test, env template |
| `npm/` | `@usertasks/sdk` and `@usertasks/cli`; the CLI tarball carries its dependencies, so `npm install -g` needs no registry |
| `docs/` | This documentation (Markdown) |
| `sbom/` | An SPDX SBOM per image (syft) |
| `manifest.json` | Version, platform, git commit, image ids, signer fingerprint |
| `SHA256SUMS`, `SHA256SUMS.sig`, `signing-key.pub.pem` | Checksums of every file, an ed25519 signature over them, the public key |
| `bundle.sh` | Verify, load, run and smoke-test it with only a shell, `sha256sum`, OpenSSL 3 and Docker |

The signature uses the same key type and fingerprint format as
[package signing](changes/packages.md): ed25519, fingerprint = the first 16
bytes of SHA-256 over the public key (DER), as `aa:bb:…`.

## 1. Build it (connected machine)

```bash
docker build -t usertasks:0.1.0 .
npm ci
npm run bundle -- create --image usertasks:0.1.0 --signing-key ~/keys/usertasks-bundle.pem
#   dist/bundle/usertasks-bundle-0.1.0-linux-amd64.tar (+ .sha256)
#   signer fingerprint: 3f:9a:…
```

| Option | Default | |
|---|---|---|
| `--image` | `usertasks:local` | The app image to ship. The manifest lists the [optional drivers](optional-drivers.md) it has, and `create` warns about missing ones: they can't be added offline |
| `--build`, `--build-arg NAME=true\|false` | | Build `--image` from this checkout for `--platform` first, with the Dockerfile's `INCLUDE_OPTIONAL_DB_DRIVERS`, `INCLUDE_STORAGE_SDKS` and `INCLUDE_PROVIDER_SDKS` |
| `--platform` | the Docker host's (`linux/amd64`, `linux/arm64`) | Dependencies are pulled for it; build the app image for it too (`docker buildx build --platform linux/amd64 --load …`) |
| `--deps` | `postgres,minio,valkey,mailpit,openbao,smoke` | Add `pgbouncer`, `keycloak`, `local-kms`, `localstack` (the emulated `aws` profile, whose files are in `compose/` too); `none` ships the app image only |
| `--signing-key` | `BUNDLE_SIGNING_KEY` (PEM), else a new key next to the bundle | An ed25519 private key (`openssl genpkey -algorithm ed25519 -out key.pem`). Keep it private and reuse it, so the fingerprint stays the same |
| `--no-sbom` | | Skip the SBOMs (syft runs in Docker) |
| `--out` | `dist/bundle` | |

Publish the fingerprint where the offline side can check it (a release
page, a ticket, a phone call).

## 2. Verify it (offline host)

```bash
tar -xf usertasks-bundle-0.1.0-linux-amd64.tar && cd usertasks-bundle-0.1.0-linux-amd64
./bundle.sh verify --fingerprint 3f:9a:…
```

It checks every file against `SHA256SUMS`, that no file was added, that
`SHA256SUMS.sig` is a valid signature by `signing-key.pub.pem`, and that
the key is the one you expect. With Node.js: `npm run bundle -- verify <tar or dir> --fingerprint …`.

## 3. Load the images

```bash
./bundle.sh load                                                    # into this host's Docker
./bundle.sh load --registry registry.corp.example/usertasks --push  # and into your registry
```

`--registry` tags every image under the prefix (its own registry host
dropped: `quay.io/keycloak/keycloak:26.0` → `registry.corp.example/usertasks/keycloak/keycloak:26.0`),
which is what the Helm chart's `global.imageRegistry` expects.

## 4a. Run it with Docker Compose

```bash
./bundle.sh up       # writes compose/.env with fresh secrets, starts the on-premises profile
./bundle.sh smoke    # sign-in, a task, /files, SSE, email, scheduler tick, KMS, no internet
./bundle.sh admin bootstrap --email admin@corp.example --org "Corp"   # BOOTSTRAP_PASSWORD in the environment
```

`up` starts PostgreSQL, MinIO, Valkey, Mailpit, OpenBao (Transit) and the
app, worker and migrations on a Docker network with no route out, then
creates the first data key (`usertasks-admin kms rotate`). Nothing is
published on the host: put your reverse proxy on that network, or adapt
`compose/.env` and the files (an SMTP relay instead of Mailpit, your own
PostgreSQL, a real Vault) as in [On-premises setup](setup-on-prem.md).
OpenBao runs as a dev server here (in memory): use your Vault or OpenBao
cluster for anything you keep.

## 4b. Run it on Kubernetes

```bash
./bundle.sh load --registry registry.corp.example/usertasks --push
helm install usertasks charts/usertasks-0.1.0.tgz -n usertasks --create-namespace \
  -f my-values.yaml --set global.imageRegistry=registry.corp.example/usertasks \
  --set image.repository=usertasks --set image.tag=0.1.0 --wait --wait-for-jobs
```

Start `my-values.yaml` from the chart's `examples/onprem.yaml` (your
services, Vault, a private CA, the egress allowlist NetworkPolicy) or
`examples/eval.yaml` (everything bundled). See
[Kubernetes setup](setup-kubernetes.md).

## The CLI

```bash
npm install -g --offline ./npm/usertasks-cli-0.1.0.tgz
usertasks login --url https://tasks.corp.example
```

## Updates

Build a new bundle with the same signing key, verify it, `load`, then
`docker compose … up -d` (the migrate container runs on every `up`) or
`helm upgrade` (migrations run as a hook or a Job for the revision).

## Release gate

`npm run bundle:e2e -- dist/bundle/<bundle>.tar --fingerprint <fp>` runs
the bundle on an offline host: a Docker-in-Docker container on an internal
Docker network, whose daemon starts with no images and can't pull. It
checks that the host really is offline, then `bundle.sh verify` (and that a
changed file fails it), `load`, `up` and `smoke` (which includes "the app
can't reach the internet" and an active KMS data key from OpenBao), and
installs the CLI from `npm/` in a container with no network.
