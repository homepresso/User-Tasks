# syntax=docker/dockerfile:1
# Self-hosted UserTasks image (Next.js standalone output).
# The database is an external Supabase project; see docs/self-hosting.md.
#
# The Supabase URL/keys and SSO flags are runtime config (the server hands
# them to the browser), so one image works against any Supabase project:
# supply them, and every secret, at runtime. Only DEPLOYMENT_MODE and the
# public app URL are build args, because statically rendered routes (robots,
# sitemap, marketing pages, Open Graph URLs) are generated during the build.

FROM node:22-alpine AS deps
WORKDIR /app
# npm workspaces: every package manifest must be present for `npm ci` to
# match the lockfile (the app itself never imports from packages/*).
COPY package.json package-lock.json ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/cli/package.json packages/cli/
COPY packages/pg-query/package.json packages/pg-query/
COPY packages/admin/package.json packages/admin/
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_APP_URL
ARG DEPLOYMENT_MODE=self_hosted
# Largest upload body the app's proxy buffers (form attachments sent through
# the app; next.config.ts proxyClientMaxBodySize, fixed at build time).
ARG FORM_UPLOAD_MAX_BODY_MB=50
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    DEPLOYMENT_MODE=$DEPLOYMENT_MODE \
    FORM_UPLOAD_MAX_BODY_MB=$FORM_UPLOAD_MAX_BODY_MB \
    NEXT_OUTPUT_STANDALONE=true \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Type check, off by default: it adds several minutes and up to 4 GB of
# memory, and CI type-checks every commit already (npm run typecheck). Release
# images build with --build-arg TYPECHECK=true (.github/workflows/release-gates.yml,
# npm run bundle). It runs before the optional packages below are removed
# (see there); tsc needs more than Node's default heap for this codebase.
ARG TYPECHECK=false
RUN if [ "$TYPECHECK" = "true" ]; then \
      npx next typegen && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit -p .; \
    fi
# Optional packages: see docs/optional-drivers.md (and lib/optional-drivers,
# whose test checks these lists). They are chosen in this stage, before
# `next build`: a missing one is replaced by a stub in the bundle, so adding
# it later needs a rebuild, not an extra layer on top of this image. The type
# check (TYPECHECK=true) runs first, with every package still installed (so
# their real types are checked: a removed package would fail it with "Cannot
# find module"), then the packages left out are removed and `next build`
# skips its own duplicate type check (NEXT_BUILD_TYPECHECK=false).
# Snowflake, Oracle and MongoDB drivers are optionalDependencies and are left
# out of the image unless INCLUDE_OPTIONAL_DB_DRIVERS=true. (`npm ci
# --omit=optional` is not used: it would also drop the native binaries Next.js,
# Tailwind and lightningcss install as optional dependencies.) The standalone
# output only copies what the server imports, so removing the three packages
# here keeps them, and their dependency trees, out of the final image.
# The storage SDKs (S3, Azure Blob, Google Cloud Storage; also optional) stay
# in by default so STORAGE_PROVIDER can be switched without a rebuild; build
# with INCLUDE_STORAGE_SDKS=false to drop them when only supabase/local is used.
ARG INCLUDE_OPTIONAL_DB_DRIVERS=false
ARG INCLUDE_STORAGE_SDKS=true
# Email, secret-store and KMS SDKs (nodemailer, SES, Azure Communication Services,
# Key Vault secrets, Secret Manager, Secrets Manager, AWS KMS) and the AWS auth
# helpers (RDS IAM signer, credential chain): same (Key Vault keys
# stays: the SQL Server driver needs it too),
# INCLUDE_PROVIDER_SDKS=false drops them.
ARG INCLUDE_PROVIDER_SDKS=true
# OCR for scanned PDFs (tesseract.js, WebAssembly, about 45 MB) is left out
# unless INCLUDE_OCR=true; a cloud OCR provider needs no package.
ARG INCLUDE_OCR=false
RUN if [ "$INCLUDE_OPTIONAL_DB_DRIVERS" != "true" ]; then \
      rm -rf node_modules/snowflake-sdk node_modules/oracledb node_modules/mongodb; \
    fi \
 && if [ "$INCLUDE_STORAGE_SDKS" != "true" ]; then \
      rm -rf node_modules/@aws-sdk/client-s3 node_modules/@aws-sdk/s3-request-presigner node_modules/@azure/storage-blob node_modules/@google-cloud/storage; \
    fi \
 && if [ "$INCLUDE_PROVIDER_SDKS" != "true" ]; then \
      rm -rf node_modules/nodemailer node_modules/@aws-sdk/client-sesv2 node_modules/@azure/communication-email node_modules/@azure/keyvault-secrets node_modules/@google-cloud/secret-manager node_modules/@aws-sdk/client-secrets-manager node_modules/@aws-sdk/client-kms node_modules/@aws-sdk/rds-signer node_modules/@aws-sdk/credential-providers; \
    fi \
 && if [ "$INCLUDE_OCR" != "true" ]; then \
      rm -rf node_modules/tesseract.js node_modules/tesseract.js-core; \
    fi
# Static pages are rendered by NEXT_BUILD_CPUS worker processes (Next's
# default is one per CPU less one, each a Node process of up to ~0.9 GB):
# two keeps that phase small at no measurable cost in time (724 pages in
# ~6 s). The compile before it (Turbopack) is the peak: about 10 GB, see
# docs/deployment-profiles.md#memory.
ARG NEXT_BUILD_CPUS=2
# Extensions compiled in (lib/extensions/build/codegen.ts): a comma list of
# installed packages or in-repo paths. Empty (the public image) = none. An
# Enterprise image is built FROM a context that also installs the private
# extension packages and sets this.
ARG USERTASKS_EXTENSIONS=
RUN USERTASKS_EXTENSIONS=$USERTASKS_EXTENSIONS NEXT_BUILD_TYPECHECK=false NEXT_BUILD_CPUS=$NEXT_BUILD_CPUS npm run build \
 && node scripts/build-worker.mjs .next/standalone/worker.cjs \
 && node packages/admin/scripts/build.mjs .next/standalone/admin.cjs

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001 -G nodejs
# Build info for GET /api/version (and /api/config/public): pass
# --build-arg GIT_COMMIT=$(git rev-parse HEAD) --build-arg BUILD_TIME=$(date -u +%FT%TZ).
# Declared in this last stage so a new commit doesn't invalidate the build cache.
ARG GIT_COMMIT=
ARG BUILD_TIME=
ENV GIT_COMMIT=$GIT_COMMIT \
    BUILD_TIME=$BUILD_TIME
# FFmpeg / ffprobe for the media steps that process files locally (Media
# Utilities, Redact Video, frame-sampled Analyze Video, splitting long audio
# for transcription, non-PNG/JPEG images) — Alpine's package (LGPL/GPL
# binaries, about 100 MB with codecs and a font for burned-in subtitles).
# INCLUDE_MEDIA_TOOLS=false leaves them out: those operations then fail with
# a clear message; provider-side media steps keep working.
ARG INCLUDE_MEDIA_TOOLS=true
RUN if [ "$INCLUDE_MEDIA_TOOLS" = "true" ]; then apk add --no-cache ffmpeg font-dejavu; fi
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Database migrations for `node admin.cjs db migrate` (usertasks-admin; any
# PostgreSQL — see docs/infrastructure.md#database).
COPY --from=builder --chown=nextjs:nodejs /app/supabase/migrations ./supabase/migrations
# Amazon RDS CA bundle: server verification for DATABASE_AUTH=aws (RDS IAM
# auth; DATABASE_SSL_CA_FILE overrides it). Refresh deploy/aws/rds-global-bundle.pem
# from https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem.
COPY --from=builder --chown=nextjs:nodejs /app/deploy/aws/rds-global-bundle.pem ./certs/rds-global-bundle.pem
USER nextjs
EXPOSE 3000
# Web server. The scheduler worker (SCHEDULER_PROVIDER=worker) runs inside it,
# or in its own container from this image: `node worker.cjs` (see
# docs/infrastructure.md#scheduler).
CMD ["node", "server.js"]
