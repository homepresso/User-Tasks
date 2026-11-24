# Air-gapped installs

For a network with no internet access at all: build a signed **bundle** on a
connected machine, carry it across, verify it, load it and install with
Docker Compose or Kubernetes. Nothing in UserTasks calls out at runtime (no
SaaS, CDN or telemetry; the app's own fonts and scripts are in the image, the
docs site is served by the app at `/docs`), and the release gate proves the
whole path on a host that can't reach the internet. The one optional
download is Google Fonts chosen in a theme or form — turn it off and
pre-seed the fonts you want ([Google Fonts](#google-fonts)).

## What's in the bundle

| Path | Contents |
|---|---|
| `images/` | OCI images saved with `docker save` for one platform (gzip): the app (web, worker, migrations and `usertasks-admin` share one image) and its dependencies — PostgreSQL 16, MinIO, Valkey, Mailpit, OpenBao, Node.js (smoke test); optionally PgBouncer, Keycloak, local-kms. `images/images.txt` lists them |
| `charts/usertasks-<version>.tgz` | The [Helm chart](setup-kubernetes.md) |
| `compose/` | `docker-compose.yml` and the on-premises profile (`deploy/compose/onprem.yml`: an isolated network; `kms.yml`: OpenBao Transit), Keycloak realm, smoke test, env template |
| `npm/` | `@user-tasks/sdk` and `@user-tasks/cli`; the CLI tarball carries its dependencies, so `npm install -g` needs no registry |
| `docs/` | This documentation (Markdown) |
| `sbom/` | An SPDX SBOM per image (syft) |
| `manifest.json` | Version, platform, git commit, image ids, signer fingerprint |
| `SHA256SUMS`, `SHA256SUMS.sig`, `signing-key.pub.pem` | Checksums of every file, an ed25519 signature over them, the public key |
| `bundle.sh` | Verify, load, run and smoke-test it with only a shell, `sha256sum`, OpenSSL 3 and Docker |

The signature uses the same key type and fingerprint format as
[package signing](changes/packages.md): ed25519, fingerprint = the first 16
bytes of SHA-256 over the public key (DER), as `aa:bb:…`.

Official UserTasks bundles are signed with the **UserTasks Release** key:

| | |
|---|---|
| Fingerprint | `27:ca:1b:9e:57:19:b9:5b:ba:94:95:97:c5:f4:6c:bf` |
| Public key (SPKI, base64) | `MCowBQYDK2VwAyEAQ4OS8ZHckZhX8gsyyP67TxZlpVhKW+QvhSEDROj7Ha8=` |

`bundle verify` must report this fingerprint for a bundle you downloaded from usertasks.com or the GitHub releases.

## 1. Build it (connected machine)

```bash
docker build --build-arg TYPECHECK=true -t usertasks:0.1.0 .
npm ci
npm run bundle -- create --image usertasks:0.1.0 --signing-key ~/keys/usertasks-bundle.pem
#   dist/bundle/usertasks-bundle-0.1.0-linux-amd64.tar (+ .sha256)
#   signer fingerprint: 3f:9a:…
```

| Option | Default | |
|---|---|---|
| `--image` | `usertasks:local` | The app image to ship. The manifest lists the [optional drivers](optional-drivers.md) it has, and `create` warns about missing ones: they can't be added offline |
| `--build`, `--build-arg NAME=true\|false` | | Build `--image` from this checkout for `--platform` first, with the Dockerfile's `INCLUDE_OPTIONAL_DB_DRIVERS`, `INCLUDE_STORAGE_SDKS`, `INCLUDE_PROVIDER_SDKS` and `INCLUDE_OCR` |
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

## OCR language data

OCR of scanned PDFs (the document actions) is optional. If you build the
image with `INCLUDE_OCR=true`, tesseract.js would download its language data
from the internet on first use, which an air-gapped host can't do. Provide it
locally instead: on the connected machine download one
`<lang>.traineddata.gz` per language from the tesseract.js language data
(for example
`https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz`),
carry the files across with the bundle, put them in a folder the app can
read (a volume in Compose or Kubernetes) or on an internal web server, and
set `DOCUMENT_OCR_LANG_PATH` to that folder or URL. Alternatively set
`DOCUMENT_OCR_PROVIDER=none` to turn OCR off. See
[Optional drivers](optional-drivers.md#ocr-tesseractjs).

## Google Fonts

Themes and forms can use any Google Fonts family. Browsers never contact
Google: the app serves each font from its own `/fonts/g/…` route, downloading
it from `fonts.googleapis.com` / `fonts.gstatic.com` the first time it is
needed and keeping it in the storage provider (bucket `task-files`, prefix
`google-fonts/`). On an isolated network turn the download off and bring the
fonts you want with you:

1. Set `FONTS_REMOTE=off` in the app environment (the instance setting
   `instance.fonts_remote` = `false` does the same; the environment wins).
   The pickers then list only fonts already stored, and a page
   that names any other Google font draws it in a similar system font
   (sans serif, serif, handwriting or monospace by the family's category).
2. On a connected machine with a checkout: `npm run admin -- fonts seed
   "Open Sans" Lato "Playfair Display" --dir fonts-bundle` (`--featured` adds
   the featured families). This writes each family's stylesheet and all its
   font files (every weight, italics and script subset) into the folder.
3. Carry the folder across and, where `usertasks-admin` runs with the app's
   environment, `usertasks-admin fonts import fonts-bundle`. `usertasks-admin
   fonts status` lists what is stored.

Google Fonts are open source (SIL Open Font License, Apache License 2.0 or
the Ubuntu Font Licence); the stylesheets the app serves say so.

## Media steps

FFmpeg for the media steps (Media Utilities, Redact Video, frame-sampled
Analyze Video, splitting long audio) is installed into the image when it is
built (`INCLUDE_MEDIA_TOOLS=true`, the default), so the bundle's app image
already carries it; build on the connected machine. The AI media providers
themselves (OpenAI, Gemini, Azure AI, AWS, Deepgram, AssemblyAI, ElevenLabs,
Stability AI) are internet services: on an isolated network only steps that
need no provider work (Media Utilities, Redact Image / Video with custom
boxes), unless you point an integration's base URL at a reachable endpoint
(for example an Azure private endpoint).

## The CLI

```bash
npm install -g --offline ./npm/user-tasks-cli-0.1.0.tgz
usertasks login --url https://tasks.corp.example
```

## Enterprise edition

<a id="sharepoint-edition"></a>
The paid extensions (SharePoint Server, the Infrastructure add-on) ship in one
image, [UserTasks Enterprise](self-hosting.md#editions), downloaded with any
licence for an extension it contains; each extension is then unlocked on the
offline host by its own licence, with no new bundle. (Bundles of the older
SharePoint edition, `usertasks-edition-sharepoint-…`, install the same way.)
For an offline host, make a signed offline bundle on any connected machine
with Docker (Linux, macOS or Windows; it does not need UserTasks installed):

```bash
curl -fsSL https://usertasks.com/install.sh | sh -s -- --bundle-download --licence usertasks.licence
# → usertasks-edition-enterprise-0.4.0-ent.2-linux-amd64.tar (+ .sha256)
#   --platform linux/arm64 for an Arm host, --version <x.y.z> for an older release, --out <file>
```

```powershell
& ([scriptblock]::Create((irm https://usertasks.com/install.ps1))) -BundleDownload -Licence .\usertasks.licence
```

The same licence check as an online install (an expired licence is refused).
The bundle holds:

| | |
|---|---|
| `release/` | the UserTasks release as published: `SHA256SUMS` and its signature (the release key), `usertasks-<version>.tar.gz`, `install.sh`, `install.ps1` |
| `edition.json`, `edition.json.sig` | the edition manifest (image digests, every extension in the build and its version), signed by the release key |
| `images.tar` | the UserTasks Enterprise image and the images of the bundled services (PostgreSQL, MinIO, Valkey, Mailpit), gzip-compressed (`docker load` reads it as it is) |
| `bundle.json`, `SHA256SUMS.bundle` | what it is, and checksums of every file |

On the offline host (Docker installed), with the bundle and your licence:

```bash
sha256sum usertasks-edition-enterprise-0.4.0-ent.2-linux-amd64.tar   # compare with the .sha256 from the connected machine
tar -xOf usertasks-edition-enterprise-0.4.0-ent.2-linux-amd64.tar usertasks-edition-enterprise-0.4.0-ent.2-linux-amd64/release/install.sh > install.sh
sh install.sh --bundle usertasks-edition-enterprise-0.4.0-ent.2-linux-amd64.tar --licence usertasks.licence
```

`install.sh --bundle` checks the bundle's checksums, verifies the UserTasks
release against the release key built into `install.sh` (it prints the key's
fingerprint: compare it with the signer fingerprint in the release notes) and
hands over to that release's `usertasks install --bundle`, which verifies
`edition.json`, loads the images and checks the Enterprise image against the
signed digests before anything starts. Nothing is downloaded. Windows:
`install.ps1 -Bundle <file> -Licence <file>`.

### Bundles in parts

A prebuilt bundle you are given (rather than make yourself) can be over 2 GB,
so it comes in numbered parts of at most 1.9 GB each, which also fit on a
FAT32 USB stick:

| | |
|---|---|
| `<name>.tar.part-001`, `-002`, … | consecutive pieces of the bundle |
| `<name>.tar.parts.json` | the size and SHA-256 of the whole bundle and of every part, in order |
| `<name>.tar.parts.json.sig` | the signature of that list, made with the UserTasks release key |
| `<name>.tar.sha256` | the checksum of the whole bundle (for joining by hand) |

Carry all of them over in one folder, with the current installer
(`install.sh` or `install.ps1` from usertasks.com; the copy inside the bundle
can't be reached until the parts are joined). Then point the installer at
the folder (or at the `.parts.json` file):

```bash
sh install.sh --bundle ./usertasks-edition-enterprise-0.4.0-ent.2-linux-amd64/ --licence usertasks.licence
usertasks upgrade --bundle ./usertasks-edition-enterprise-0.4.0-ent.2-linux-amd64/   # upgrades
```

```powershell
& .\install.ps1 -Bundle .\usertasks-edition-enterprise-0.4.0-ent.2-linux-amd64\ -Licence .\usertasks.licence
```

Before it unpacks anything, the installer checks the list's signature
against its built-in release key, then the size and checksum of every part,
joins them in the install folder and checks the whole bundle. Then it carries
on as above. If something is wrong, it tells you which part: *part 3 of 4 is
missing* (copy it next to the `.parts.json`) or *part 2 of 4 is damaged
(checksum mismatch)* (copy or download it again). The joined copy is deleted
once it has been unpacked.

On a connected machine, `--bundle-download --from <address of the
.parts.json>` (PowerShell: `-BundleDownload -From <address>`) downloads the
list, its signature and every part into `--out <folder>` (default: the
current folder) and checks them. It needs no Docker and no licence. Run it
again after a broken connection: parts that are already complete are kept,
and a part that was cut off continues where it stopped.

An installer from before parts support can still use the bundle once you
join it by hand. The result is the original bundle, byte for byte:

```bash
cat usertasks-edition-enterprise-0.4.0-ent.2-linux-amd64.tar.part-* > usertasks-edition-enterprise-0.4.0-ent.2-linux-amd64.tar
sha256sum usertasks-edition-enterprise-0.4.0-ent.2-linux-amd64.tar   # compare with the .sha256
```

```powershell
cmd /c copy /b "usertasks-edition-enterprise-0.4.0-ent.2-linux-amd64.tar.part-001+usertasks-edition-enterprise-0.4.0-ent.2-linux-amd64.tar.part-002" usertasks-edition-enterprise-0.4.0-ent.2-linux-amd64.tar
(Get-FileHash usertasks-edition-enterprise-0.4.0-ent.2-linux-amd64.tar).Hash   # compare with the .sha256
```

**Upgrades**: make a newer bundle the same way, carry it over, and run
`usertasks upgrade --bundle <file or folder>` (backup, migrations, health
check and rollback as usual). The licence is checked when the
bundle is made, so a bundle made with a lapsed licence can't be made at all;
the offline host itself never contacts usertasks.com.

## Licences for paid extensions

Paid extensions in the Enterprise image stay locked until a licence
enables them (installing another licence later unlocks another extension: no
new bundle). Licences are verified offline. Get one bound to this install
with `usertasks-admin licence request`: carry the request file to a connected
machine, upload it in the licensing portal, then run `usertasks-admin licence
install <file>`. See [Licences for paid extensions](licensing.md).

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
