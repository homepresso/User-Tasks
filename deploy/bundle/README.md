# UserTasks air-gapped bundle

Everything to install UserTasks on a network with no internet access. The
full guide is `docs/setup-air-gapped.md` in this bundle (and on the docs
site the app serves at `/docs`).

| Path | Contents |
|---|---|
| `images/` | OCI images (`docker save`, gzip): the app (`app`) and its dependencies; `images/images.txt` lists them |
| `charts/` | The Helm chart (`helm install usertasks charts/usertasks-<version>.tgz …`) |
| `compose/` | Docker Compose files: the standalone stack and the on-premises profile (isolated network, OpenBao KMS) |
| `npm/` | `@usertasks/sdk` and `@usertasks/cli` (dependencies included: `npm install -g ./npm/usertasks-cli-<version>.tgz`) |
| `docs/` | The documentation (Markdown) |
| `sbom/` | SPDX SBOMs of the images (syft) |
| `manifest.json` | Version, platform, image ids, the signer fingerprint |
| `SHA256SUMS`, `SHA256SUMS.sig`, `signing-key.pub.pem` | Checksums of every file, their ed25519 signature, the public key |

```sh
./bundle.sh verify --fingerprint <published fingerprint>   # checksums + signature
./bundle.sh load                                           # docker load every image
./bundle.sh load --registry registry.corp.example/usertasks --push   # for Kubernetes
./bundle.sh up && ./bundle.sh smoke                        # on-premises Compose profile + checks
```

Requirements on the offline host: a POSIX shell, `sha256sum`, OpenSSL 3,
Docker with the compose plugin; Helm and kubectl for Kubernetes; Node.js 20+
only for the CLI.
