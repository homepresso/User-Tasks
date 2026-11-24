# Offline bundles in parts

A prebuilt offline (air-gapped) bundle of the SharePoint edition was 2.2 GB,
which is more than GitHub accepts for one release file (2 GiB). Prebuilt
bundles are now smaller, and when they are still too big they are split into
signed parts. The installers can read the parts.

## What changes for people

- `install.sh --bundle`, `install.ps1 -Bundle` and `usertasks upgrade
  --bundle` accept the bundle's `.tar` as before, and also its parts: the
  folder holding them, the `.parts.json` list, or one of the parts.
- Before anything is unpacked, the installer checks the list's signature
  against its built-in release key, then the size and SHA-256 of every part,
  then the joined bundle. Errors name the part: "part 3 of 4 (…) is missing:
  copy it next to … (or download it again)", "part 2 of 4 (…) is damaged
  (checksum mismatch): download it again".
- `install.sh --bundle-download --from <address of a .parts.json>` and
  `install.ps1 -BundleDownload -From <address>` download a prebuilt bundle's
  parts, checking each one. They need no Docker and no licence. Run the
  command again after a broken connection: complete parts are kept and a
  part that was cut off continues where it stopped.
- `images.tar` inside a bundle is now gzip-compressed. It keeps its name
  because `docker load` reads gzip by content, so installers already
  released keep working with new bundles.
- Installers from before parts support can still use the bundle once the
  parts are joined by hand (`cat <name>.tar.part-* > <name>.tar`). The
  result is the original file, byte for byte, matching `<name>.tar.sha256`.

## Format

| File | |
|---|---|
| `<name>.tar.part-001` … `-NNN` | consecutive byte ranges of `<name>.tar`, at most 1945 MiB (1.9 GiB) each |
| `<name>.tar.parts.json` | `{ format: 1, kind: "usertasks.bundle-parts", name, size, sha256, part_size, parts: [{ name, size, sha256 }] }` |
| `<name>.tar.parts.json.sig` | ed25519 signature of the exact bytes of the list, made with the release key (the same scheme as `SHA256SUMS.sig` and `edition.json.sig`) |

Part names must be exactly `<name>.part-001`, `-002`, … in order, and the part
sizes must add up to `size`. The installer rejects anything else, even when
the list is signed.

## Where

- `deploy/install/install.sh`, `install.ps1`, `usertasks`, `usertasks.ps1`
  (the same functions in each, kept in step).
- Tests: `__tests__/install-bundle-parts.test.ts` (join, verify, resume,
  damaged, missing and wrongly signed parts, for both sh scripts).
- The edition build (private repository) makes the parts and signs the list.
- The core air-gapped bundle (`npm run bundle`) is not affected. It is
  built on the operator's own machine and never uploaded as a release
  file, and its images are already gzip-compressed one by one.
