# Choosing file storage

The storage provider holds uploaded and generated files: data-table files,
workflow documents and exports, workspace logos, theme fonts and icons, in
three buckets (`task-files`, `logos`, `brand-fonts`). The browser never
talks to the store. Uploads go through the app, which enforces size and
type limits.

| Option | `STORAGE_PROVIDER` | On-prem | AWS | Azure | Google Cloud | Switch |
|---|---|---|---|---|---|---|
| Supabase Storage | `supabase` (default) | — | — | — | — | data |
| Local disk, NFS or SMB | `local` | yes | compatible: EFS | compatible: Azure Files | compatible: Filestore | data |
| S3 and S3-compatible: MinIO, Ceph RGW, SeaweedFS, Garage, StorageGRID, R2 | `s3` | yes | native: S3 with the task role / IRSA | — | — | data |
| Azure Blob Storage | `azure_blob` | — | — | native: managed identity, user-delegation SAS | — | data |
| Google Cloud Storage | `gcs` | — | — | — | native: workload identity, V4 signed URLs | data |

## When to pick which

- **Supabase Storage** when you're on Supabase and have no residency or
  retention requirement for files.
- **Your cloud's object store** (S3, Blob, GCS) when files must sit in
  your account, region or retention policy. It's the most common hybrid
  first step.
- **MinIO or another S3-compatible store** on premises, and anywhere you
  want one storage API across environments.
- **Local disk / NFS** for a single server, or a shared volume
  (`ReadWriteMany`) for several instances.

## Rules

- **SDKs:** `s3`, `azure_blob` and `gcs` need their optional SDK, included in the Docker image by default ([Optional drivers](../optional-drivers.md)).
- **Create the buckets first.** The app doesn't create them at runtime
  (`usertasks-admin storage init` does, for the configured provider).
- **References instead of URLs:** with any other storage provider, logos, theme assets and
  icons are stored as `storage://` references, and file values gain a
  `ref`. The app resolves them and serves files from `/files`. Old Supabase
  public URLs keep working through `/files` after the switch.
- **Public files:** by default the app serves them. With
  `STORAGE_PUBLIC_BASE_URL` browsers fetch them from the bucket or a CDN,
  which saves egress through the app (useful in [multi-cloud](../topologies/multi-cloud.md)).
- **No downtime:** the switch copies objects, checking SHA-256, rewrites
  the stored URLs and verifies. Re-run it to pick up files uploaded during
  the copy.
- Store credentials (`secret_access_key`, connection strings, key JSON) as
  `--secret` values or `secret://` references.

```bash
usertasks-admin switch storage --to s3 --set endpoint=http://minio:9000 --set force_path_style=true \
  --set access_key_id=usertasks --secret secret_access_key=… --dry-run
```

Reference: [Storage](../infrastructure.md#storage) and
[Switching storage](../switching-providers.md#storage).
