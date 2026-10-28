# Release notes: storage provider

Uploaded files can now live outside Supabase Storage: on local disk (or an
NFS / SMB volume), in S3 or any S3-compatible store (MinIO, Ceph RGW, …), in
Azure Blob Storage or in Google Cloud Storage. Nothing changes unless you opt
in: the default stays Supabase Storage, with the same public URLs.

## Added

- **`STORAGE_PROVIDER=local|s3|azure_blob|gcs`** with options as environment
  variables or encrypted `storage.<option>` instance settings: bucket
  mapping (`STORAGE_BUCKET_MAP`, `STORAGE_BUCKET`, `STORAGE_BUCKET_PREFIX`),
  an optional direct / CDN base URL (`STORAGE_PUBLIC_BASE_URL`), and per
  provider credentials — including managed identity / workload identity for
  Azure (Entra ID) and Google Cloud (Application Default Credentials). See
  [Infrastructure and providers](infrastructure.md#storage).
- **`GET /files/<bucket>/<key>`** serves stored files through the provider,
  with public caching, ETags, a sandboxing CSP and attachment downloads for
  anything that isn't an image, font, PDF, text, audio or video.
- **`storage://bucket/key` references.** With a non-default provider, the
  database stores references for logos, theme assets and icons; data-table
  and workflow file values keep a usable `url` and gain `ref`.
- **Migration building blocks** (`lib/storage/migrate.ts`): checksum-verified
  object copy between any two providers, and a dry-run-first rewrite of
  stored URLs to references.

## Changed

- Every server-side storage call (uploads, workflow-generated files, theme
  fonts, data-table file clean-up) goes through the storage provider.
- Theme, logo and font validation accepts `storage://` references and the
  app's `/files` URLs as well as Supabase public URLs of this project.
- Workflows that read the app's own files read them through the provider
  (no HTTP round trip) when the provider isn't Supabase.
- The org switcher no longer crashes when one of your memberships points at
  a workspace you can't read: such memberships are skipped, and the switcher
  shows "Unavailable workspace" if it is the active one.

## Upgrade

No migration. To switch: create the buckets, copy the objects and rewrite
stored URLs (see the infrastructure page), set `STORAGE_PROVIDER` and its
options, restart.
