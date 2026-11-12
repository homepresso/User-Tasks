import type { DocPageDef } from '../types'
import { DOCKER_BUILD_MEMORY_GB } from '../../docker-build-memory'

/**
 * The self-hosting guide: a beginner's quick start (npm run setup:local), how to choose, install, set up (the first-run
 * /setup screen and its setup code), invite people, use the CLI, give the
 * install a friendly address (DNS, HTTPS, APP_URL / APP_BASE_DOMAIN), move from
 * a local Supabase to Supabase Cloud, update,
 * back up and troubleshoot a self-hosted install. Plain-language pages that
 * sit in front of the reference pages in content/operations.ts
 * (docs/self-hosting.md and the setup-*.md guides).
 */
export const SELF_HOSTING_GUIDE_PAGES: DocPageDef[] = [
  {
    slug: 'self-hosting/quick-start',
    title: 'Quick start on your computer (beginner)',
    description: 'Never used a terminal much? Install Git, Node.js and Docker Desktop, copy UserTasks, run npm run setup:local and npm run dev, and create your admin account with the setup code. Windows, macOS and Linux.',
    body: `
This page gets UserTasks running on your own computer, step by step, even if you've hardly used a terminal before. It takes about half an hour, most of it waiting for downloads. Nothing is put on the internet: UserTasks runs only on your computer.

You'll type a few commands into a **terminal**, a window where you type instructions instead of clicking. Each code box below holds one command: copy it, paste it into the terminal and press Enter.

## 1. Install three things

Download and install each one, accepting the default options:

| Program | Why you need it | Download |
|---|---|---|
| **Git** | Copies UserTasks to your computer | [git-scm.com](https://git-scm.com/downloads) |
| **Node.js**, the LTS version | Runs UserTasks (version 20 or later) | [nodejs.org](https://nodejs.org/) |
| **Docker Desktop** | Runs the database, sign-in and file storage in the background | [docker.com](https://www.docker.com/products/docker-desktop/) |

- Restart your computer if Docker asks.
- **Windows:** if Docker Desktop asks to turn on **WSL 2** (the Windows Subsystem for Linux, which Docker needs), say yes and let it restart.
- Open Docker Desktop.

**What you'll see:** after a minute, Docker Desktop says **Engine running**. Leave it open whenever you use UserTasks.

## 2. Open a terminal

- **Windows:** open the Start menu, type *PowerShell* and open **Windows PowerShell**.
- **macOS:** press ⌘ Space, type *Terminal* and press Enter.
- **Linux:** open **Terminal** from your apps (often Ctrl+Alt+T).

Check that Node.js is installed:

\`\`\`bash
node --version
\`\`\`

**What you'll see:** \`v22.…\` or \`v24.…\` (any version from 20 up is fine). If it says "not recognized" or "command not found", close the terminal and open a new one: installers only reach windows opened after them. Still not found? Restart the computer.

## 3. Copy UserTasks to your computer

This makes a folder called \`usertasks\` inside the folder the terminal is in (your home folder):

\`\`\`bash
git clone <repository-url> usertasks
\`\`\`

Then go into it (\`cd\` means "change folder"):

\`\`\`bash
cd usertasks
\`\`\`

**What you'll see:** "Cloning into 'usertasks'…", then the prompt comes back. After \`cd usertasks\` the prompt ends in \`usertasks\`. Run every command from now on in this folder.

## 4. Set everything up

\`\`\`bash
npm run setup:local
\`\`\`

It takes a few minutes the first time (it downloads the database images), and seconds after that. It:

1. checks Node.js and that Docker is running, and tells you what to install if not
2. installs UserTasks' packages (\`npm install\`)
3. starts the local Supabase in Docker: the database, sign-in and file storage
4. builds the database (a new database gets every migration; an existing one only the new ones, so your data is kept)
5. writes your settings file, \`.env.local\`, with the database address and keys and fresh secrets (\`ENCRYPTION_KEY\`, \`CRON_SECRET\`); it never prints them
6. sets up background jobs (schedules and queued runs) in the local database

**What you'll see:** \`[1/7]\` to \`[7/7]\`, then **All set.** If it stops, it says what to fix. Fix it and run the same command again: it's safe to repeat. It never overwrites values already in \`.env.local\`, and never wipes the database unless you ask with \`--reset\` (it asks you to type *yes* first).

| Option | What it does |
|---|---|
| \`npm run setup:local -- --start\` | Runs \`npm run dev\` straight after |
| \`npm run setup:local -- --force\` | Points an existing \`.env.local\` at the local Supabase (URL and keys only; secrets are kept) |
| \`npm run setup:local -- --reset\` | Deletes everything in the local database and rebuilds it (asks first) |

## 5. Start it

\`\`\`bash
npm run dev
\`\`\`

**What you'll see:** after a few seconds, **Ready**, then a line like this:

\`\`\`text
UserTasks setup code: ABCD-EFGH-JKLM (open /setup to create the admin account)
\`\`\`

Keep this window open: closing it stops UserTasks.

## 6. Create your admin account

Open **http://localhost:3000** in your browser ("localhost" means "this computer"). A new install shows **Create your admin account**. Fill in:

- your organisation's name
- your name, email and a password
- the setup code from step 5

**What you'll see:** you're signed in, and the getting-started checklist opens.

## 7. You're in

- Follow the [getting-started guide](/docs/quickstart/cloud#the-getting-started-guide).
- Install a ready-made solution from the [Gallery](/gallery).
- [Invite people](/docs/self-hosting/invite-people) from **Settings → Members & invites**. Sending invitation emails needs an email provider, such as a Resend key or SMTP: see [Environment variables](/docs/self-hosting/environment).
- Optional: drive UserTasks from the terminal with the [CLI](/docs/self-hosting/cli). The CLI only talks to a running server (this one, at http://localhost:3000); it doesn't install anything.
- Ready for your team? [Move from your local Supabase to Supabase Cloud](/docs/self-hosting/local-to-supabase-cloud), then [give it a friendly address](/docs/self-hosting/friendly-address).

## 8. Stopping and starting again

To stop: click the terminal running UserTasks and press **Ctrl+C**. Then stop the database:

\`\`\`bash
npx supabase stop
\`\`\`

To start again: open Docker Desktop, open a terminal, \`cd usertasks\`, then start the database:

\`\`\`bash
npx supabase start
\`\`\`

and UserTasks:

\`\`\`bash
npm run dev
\`\`\`

Your data is kept between restarts.

## If something goes wrong

| You see | Do this |
|---|---|
| "Docker isn't installed" or "Docker is installed but not running" | Open Docker Desktop, wait for **Engine running**, then run the command again |
| "Port 3000 is already in use" | Another program, often a second \`npm run dev\`, is using it. Close that terminal or restart your computer. See [Port 3000 is already in use](/docs/self-hosting/troubleshooting#port-3000-is-already-in-use) |
| "Could not read package.json" | You're in the wrong folder: \`cd usertasks\`, then try again |
| Lost the setup code | \`npm run setup-code\` prints a new one |
| The local Supabase won't start | Check Docker Desktop is running and has enough memory (Settings → Resources). See [The local Supabase won't start](/docs/self-hosting/troubleshooting#the-local-supabase-wont-start) |

More fixes: [Troubleshooting](/docs/self-hosting/troubleshooting).

## Next

[Choose how to run it](/docs/self-hosting/choose) for a team: Docker Compose, Kubernetes or an air-gapped bundle.
`,
  },
  {
    slug: 'self-hosting/choose',
    title: 'Choose how to run it',
    description: 'The ways to run UserTasks yourself — a laptop trial, Docker Compose, Kubernetes with Helm, an air-gapped bundle, or your own PostgreSQL without Supabase — and when to pick each.',
    body: `
Self-hosted UserTasks is the same app as the cloud edition at usertasks.com: you run it, and the data stays on your servers. Just want to try it on your own computer? Follow the [Quick start on your computer](/docs/self-hosting/quick-start). There are five ways to run it. Every one of them ends the same way: open the app in a browser, [create your admin account](/docs/self-hosting/admin-account) at \`/setup\`, and [invite your team](/docs/self-hosting/invite-people).

| Option | Pick it when | Install guide |
|---|---|---|
| **Laptop trial** | You want to try UserTasks on your own machine in a few minutes. Everything runs in Docker; nothing to sign up for. | [Laptop trial](/docs/self-hosting/install#laptop-trial) |
| **Docker Compose** | You're running it for a team on one server or VM. Use it with a Supabase project (the default) or with everything in containers. | [Docker Compose](/docs/self-hosting/install#docker-compose) |
| **Kubernetes (Helm)** | You already run Kubernetes and want several replicas, rolling updates, and your cluster's secrets, ingress and network policies. | [Kubernetes (Helm)](/docs/self-hosting/install#kubernetes-helm) |
| **Air-gapped bundle** | The servers have no internet access at all. One signed file carries the images, the Helm chart, the Compose files, the CLI and these docs. | [Air-gapped bundle](/docs/self-hosting/install#air-gapped-bundle) |
| **Your own PostgreSQL, without Supabase** | Your organisation already runs PostgreSQL (on your servers, or RDS, Cloud SQL, Azure Flexible Server) and you don't want to add Supabase. | [Your own PostgreSQL](/docs/self-hosting/install#your-own-postgresql-without-supabase) |

You can also run the app straight from a source checkout (\`npm run dev\` or \`npm start\`) against a Supabase project: see [From source with Supabase](/docs/self-hosting/install#from-source-with-supabase).

## Supabase or not?

By default UserTasks uses [Supabase](https://supabase.com) for the database, sign-in, file storage, live updates and scheduled jobs. Supabase can be hosted on supabase.com or run by you. It's the least to look after, and it's our recommended way to start.

Without Supabase you run these instead:

- PostgreSQL 15 or later
- the built-in sign-in (email and password, plus SSO if you want it)
- an S3-compatible store such as MinIO, or a local folder, for files
- the worker for background jobs
- an SMTP server for email

The laptop trial and the standalone Docker Compose profile set all of that up for you.

You don't have to decide forever. Each area (database, sign-in, files, email and so on) can move later, one at a time, with \`usertasks-admin switch\`. See [Choose your topology](/docs/topologies) and [Switching providers](/docs/self-hosting/switching-providers).

## Next

Check the [requirements](/docs/self-hosting/requirements), then follow [Install step by step](/docs/self-hosting/install).
`,
  },
  {
    slug: 'self-hosting/requirements',
    title: 'Requirements',
    description: 'What you need before you install: Node.js 22 LTS (20.9 or later works) for source installs, Docker with Compose v2 and about ${DOCKER_BUILD_MEMORY_GB} GB of memory for building the image, Kubernetes 1.27+ and Helm 3, PostgreSQL 15+, and the ports and app address UserTasks uses.',
    body: `
What you need depends on [how you run it](/docs/self-hosting/choose). Nothing in UserTasks needs outbound internet at runtime; it only calls out to services you configure (integrations, an email provider, an AI provider).

## Software

| You're running | You need |
|---|---|
| Laptop trial | Docker (Docker Desktop, or Docker Engine with the Compose plugin), git, and Node.js 22 LTS (20.9 or later works) to run the \`npm run stack\` helper. About 2 GB of memory for Docker when it uses the published image; about ${DOCKER_BUILD_MEMORY_GB} GB when it has to build the image itself ([below](#memory-for-the-docker-build)) |
| From source (\`npm run dev\`, \`npm start\`) | Node.js 22 LTS, which the Docker image also uses, and npm. Node.js 20.9 or later still works (npm prints an \`EBADENGINE\` warning for one package, and Node.js 20 is past its end of life). Plus a database: a Supabase project, a local Supabase (Docker and the Supabase CLI, \`npx supabase\`), or PostgreSQL 15+ |
| Docker Compose | Docker Engine with Compose v2.20 or later (the \`docker compose\` command) |
| Kubernetes | Kubernetes 1.27 or later and Helm 3 |
| Air-gapped bundle | On the offline host: a shell, \`sha256sum\`, OpenSSL 3 and Docker with the Compose plugin. No Node.js. For Kubernetes, also \`helm\` and a container registry the cluster can pull from |
| The CLI | Node.js 20 or later (22 LTS recommended) on the machine where you run \`usertasks\` |

**Database:** PostgreSQL 15 or later with the \`pg_trgm\` extension. Supabase includes it.

## Memory for the Docker build

The laptop trial (\`npm run stack -- up\`) and \`docker compose up\` use the published image for this version (\`ghcr.io/homepresso/usertasks\`) when one is available: it's a download, nothing is compiled, and this section doesn't apply. When there's no published image to pull (none has been published for this version yet, or there's no network), they build the image locally instead. \`npm run stack -- up --build\`, \`docker compose up --build\` and \`docker build\` always build locally.

Building compiles UserTasks inside Docker. That needs about **${DOCKER_BUILD_MEMORY_GB} GB of memory for Docker**, and the first build takes 10 to 20 minutes. Below that, the build stops with \`Killed\` or \`cannot allocate memory\`.

- **Docker Desktop (macOS, Windows):** Settings → Resources → Memory → ${DOCKER_BUILD_MEMORY_GB} GB or more → Apply & restart. On Windows with WSL 2, the limit is \`memory=\` in \`%UserProfile%\\.wslconfig\`.
- Other containers running at the same time (a local Supabase, for example) use some of that memory too.
- \`npm run stack -- up\` checks Docker's memory before it builds (never before a download) and stops with these steps when there isn't enough (\`--skip-memory-check\` builds anyway).
- Running the finished stack needs far less, about 2 GB.
- On a laptop with little memory, run [from source](/docs/self-hosting/quick-start) instead (\`npm run setup:local\`): nothing is compiled inside Docker.

## Ports

| Port | What uses it | Change it with |
|---|---|---|
| 3000 | The app: web pages, the API and \`/docs\` | \`PORT\` for \`npm run dev\` / \`npm start\`, \`APP_PORT\` for Docker Compose, \`service.port\` in the Helm chart (default 80 inside the cluster) |
| 8025 | Mailpit, the test inbox in the laptop trial and the standalone profile (on 127.0.0.1 only) | \`MAILPIT_PORT\` |
| 9001 | MinIO console in the laptop trial and the standalone profile (on 127.0.0.1 only) | \`MINIO_CONSOLE_PORT\` |
| 54321–54324 | A local Supabase started with \`npx supabase start\` (API, database, Studio, mail) | \`supabase/config.toml\` |
| a random port on 127.0.0.1 | The CLI's browser login, on the machine running the CLI | nothing to open: it's local |

In the standalone profile, PostgreSQL, MinIO's API and Valkey stay inside the Docker network: they aren't published on the host.

## The app's address

\`APP_URL\` (or \`NEXT_PUBLIC_APP_URL\`; \`APP_URL\` wins when both are set) is the address people type in, for example \`https://tasks.example.com\` or \`http://localhost:3000\`. Get it exactly right:

- Include the scheme and the port if there is one, and leave off the trailing slash.
- It's used for links in emails and for sign-in and SSO redirects.
- An \`https://\` address makes the sign-in cookies **Secure**, so browsers only send them over HTTPS. An \`http://\` address doesn't.
- Some pages are built ahead of time, so set it when you build (for Docker, it's a build argument) as well as when you run. After changing it, rebuild.

In production, serve the app over HTTPS behind a reverse proxy (nginx, Caddy, Traefik, a cloud load balancer or a Kubernetes ingress). The proxy must pass the original \`Host\` header through. [Give your install a friendly address](/docs/self-hosting/friendly-address) walks through DNS, HTTPS and \`APP_URL\` step by step. The [file upload limits](/docs/self-hosting#file-uploads-and-request-size-limits) list the body size each proxy needs.

## Next

[Install step by step](/docs/self-hosting/install).
`,
  },
  {
    slug: 'self-hosting/install',
    title: 'Install step by step',
    description: 'Install UserTasks on your laptop, with Docker Compose (Supabase or standalone), on Kubernetes with the Helm chart, from the air-gapped bundle, on your own PostgreSQL, or from source.',
    body: `
Pick the section for [how you're running it](/docs/self-hosting/choose) and check the [requirements](/docs/self-hosting/requirements) first. Each section ends with the app running. Then open it in a browser and [create your admin account](/docs/self-hosting/admin-account).

The commands use \`<repository-url>\` for the UserTasks Git repository and \`admin@example.com\` / \`Acme Inc\` as examples.

## Laptop trial

Everything runs in Docker on your machine: PostgreSQL, MinIO for files, Valkey, Mailpit for email, the worker and the app. No Supabase account is needed.

\`\`\`bash
git clone <repository-url> usertasks && cd usertasks
npm install
npm run stack -- up
\`\`\`

\`npm run stack -- up\` does four things:

1. Writes \`.env\` from \`deploy/compose/standalone.env.example\`, with fresh secrets.
2. Gets the app image: it uses the published image for this version (\`ghcr.io/homepresso/usertasks:<version>\`) when available, otherwise it builds the image locally, which needs about ${DOCKER_BUILD_MEMORY_GB} GB of memory for Docker and 10 to 20 minutes the first time ([Requirements](/docs/self-hosting/requirements#memory-for-the-docker-build)).
3. Starts the containers and waits until they're healthy. Migrations run on every start.
4. Prints the address.

Then:

1. Open http://localhost:3000. You're sent to \`/setup\`.
2. Get the setup code from the app's log:

   \`\`\`bash
   docker compose logs app | grep "setup code"
   \`\`\`

3. [Create your admin account](/docs/self-hosting/admin-account).

Emails (invitations, password resets) land in Mailpit at http://localhost:8025.

| To | Run |
|---|---|
| Use another port, the first time (3000 is taken) | \`npm run stack -- up --port 3001\` |
| Stop it and keep the data | \`npm run stack -- down\` |
| Stop it and delete the data | \`npm run stack -- down --volumes\` |
| Create the admin account from the command line instead of \`/setup\` | \`npm run stack -- up --email admin@example.com --org "Acme Inc"\` (prints a generated password once) |
| Build the image from your copy of the code instead of downloading it (after changing the code, say) | \`npm run stack -- up --build\` |
| Run a particular image (your registry's copy, or one you built) | \`USERTASKS_IMAGE=registry.example.com/usertasks:0.1.0 npm run stack -- up\` |

The published image is built without a fixed app address and in self-hosted mode; the server reads \`APP_URL\` when it starts. If you need the few pages generated at build time (robots.txt, the sitemap) to carry your own address, build locally with \`--build\`.

## Docker Compose

\`docker-compose.yml\` has two profiles. The profile decides which containers start. \`.env\` decides which services the app uses. The app's Compose service is called \`app\`. See [Deployment profiles](/docs/self-hosting/deployment-profiles) for every option.

### With a Supabase project (default)

Only the app runs in Docker. The database, sign-in, files and live updates are in your Supabase project, hosted or self-hosted.

1. Apply the database migrations to your project:

   \`\`\`bash
   git clone <repository-url> usertasks && cd usertasks
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push --linked
   \`\`\`

2. Copy \`.env.example\` to \`.env\` and fill it in. You need at least:
   - \`NEXT_PUBLIC_SUPABASE_URL\` and \`NEXT_PUBLIC_SUPABASE_ANON_KEY\`
   - \`SUPABASE_SERVICE_ROLE_KEY\`
   - \`NEXT_PUBLIC_APP_URL\`, the address people will open
   - \`CRON_SECRET\` and \`ENCRYPTION_KEY\` (\`openssl rand -hex 32\` makes a good value)

   Every variable is described in [Environment variables](/docs/self-hosting/environment).

3. Build and start the app, then read the setup code from its log:

   \`\`\`bash
   docker compose up -d --build
   docker compose logs app | grep "setup code"
   \`\`\`

4. Turn on background work (schedules, the run queue, reminders) by adding the two Vault secrets in [Scheduled jobs](/docs/self-hosting#3-scheduled-jobs-pg_cron--vault).

### Everything in containers (standalone)

No Supabase. PostgreSQL 16, MinIO, Valkey, Mailpit, the worker and the app all run in Docker. It's the laptop trial, set up for a server:

\`\`\`bash
git clone <repository-url> usertasks && cd usertasks
cp deploy/compose/standalone.env.example .env
docker compose --profile standalone up -d --build --wait
docker compose logs app | grep "setup code"
\`\`\`

Before the \`up\`, edit \`.env\`: replace every \`<generate>\` with a secret (\`openssl rand -hex 32\`) and set \`APP_URL\` and \`NEXT_PUBLIC_APP_URL\` to the address people will open. Building the image needs about ${DOCKER_BUILD_MEMORY_GB} GB of memory for Docker ([Requirements](/docs/self-hosting/requirements#memory-for-the-docker-build)).

If Node.js is on the server, \`npm install && npm run stack -- init\` writes \`.env\` with the secrets filled in. Edit the addresses, then run \`npm run stack -- up\`.

Before real people use it:

- Point \`SMTP_HOST\` at your mail relay; Mailpit only catches mail.
- Put an HTTPS reverse proxy in front of port 3000: see [Give your install a friendly address](/docs/self-hosting/friendly-address).

[On-premises setup](/docs/self-hosting/on-premises) covers a private CA, Keycloak and PgBouncer.

## Kubernetes (Helm)

The chart in \`deploy/helm/usertasks\` deploys the web app (two replicas by default), the worker, and database migrations on every install and upgrade. [Kubernetes setup](/docs/self-hosting/kubernetes) explains every value.

1. Build the image and push it to a registry your cluster can pull from:

   \`\`\`bash
   docker build -t registry.example.com/usertasks:0.1.0 .
   docker push registry.example.com/usertasks:0.1.0
   \`\`\`

2. Start your values file from an example in \`deploy/helm/usertasks/examples/\`:
   - \`eval.yaml\` bundles PostgreSQL, MinIO, Valkey and Mailpit, for a first look.
   - \`onprem.yaml\`, \`eks.yaml\`, \`aks.yaml\` and \`gke.yaml\` use your own services.

   Set \`appUrl\`, \`image.repository\` and \`image.tag\`.

3. Create the Secret with your keys (add \`DATABASE_URL\` and the other passwords for your services as more \`--from-literal\` values), then install:

   \`\`\`bash
   kubectl create namespace usertasks
   kubectl -n usertasks create secret generic usertasks-env \\
     --from-literal=ENCRYPTION_KEY=$(openssl rand -hex 32) \\
     --from-literal=CRON_SECRET=$(openssl rand -hex 32)
   helm install usertasks deploy/helm/usertasks -n usertasks -f my-values.yaml --wait --wait-for-jobs --timeout 15m
   \`\`\`

4. Open \`appUrl\` through your Ingress or Gateway. Without one:

   \`\`\`bash
   kubectl -n usertasks port-forward svc/usertasks 3000:80
   \`\`\`

The chart names the app's Deployment after the release. With the release called \`usertasks\`, it's \`deploy/usertasks\`. With any other release name, it's \`deploy/<release>-usertasks\`. [Create your admin account](/docs/self-hosting/admin-account#kubernetes) shows how to get the setup code when there are several replicas.

## Air-gapped bundle

For a network with no internet access. On a connected machine, build a signed bundle. Carry it across, verify it, and run it with Docker Compose or Kubernetes. [Air-gapped installs](/docs/self-hosting/air-gapped) has every option.

On the connected machine:

\`\`\`bash
docker build --build-arg TYPECHECK=true -t usertasks:0.1.0 .
npm ci
npm run bundle -- create --image usertasks:0.1.0 --signing-key ~/keys/usertasks-bundle.pem
\`\`\`

On the offline host (the last command prints a setup code for /setup):

\`\`\`bash
tar -xf usertasks-bundle-0.1.0-linux-amd64.tar && cd usertasks-bundle-0.1.0-linux-amd64
./bundle.sh verify --fingerprint <the signer fingerprint>
./bundle.sh load
./bundle.sh up
./bundle.sh admin setup-code
\`\`\`

\`./bundle.sh up\` starts the on-premises profile on a Docker network with no route out. It doesn't publish anything on the host: put your reverse proxy on that network to reach the app.

For Kubernetes, push the images to your registry with \`./bundle.sh load --registry registry.corp.example/usertasks --push\`, then \`helm install\` the chart from \`charts/\`.

The CLI and SDK are in \`npm/\`, ready for offline install (see [Use the CLI with your server](/docs/self-hosting/cli)).

## Your own PostgreSQL, without Supabase

Use PostgreSQL 15 or later, with the \`pg_trgm\` extension. The easiest way is the [standalone profile](#everything-in-containers-standalone): point \`DATABASE_URL\`, \`MIGRATION_DATABASE_URL\`, \`REALTIME_DATABASE_URL\` and \`SCHEDULER_DATABASE_URL\` in \`.env\` at your server. The bundled \`postgres\` container then simply sits unused. On Kubernetes, use the chart's \`onprem.yaml\` example.

To run the app straight from a source checkout instead, set the providers in \`.env.local\`:

\`\`\`bash
DEPLOYMENT_MODE=self_hosted
APP_URL=https://tasks.example.com
NEXT_PUBLIC_APP_URL=https://tasks.example.com
ENCRYPTION_KEY=<openssl rand -hex 32>
CRON_SECRET=<openssl rand -hex 32>
DB_PROVIDER=postgres
DATABASE_URL=postgresql://usertasks:<password>@db.example.com:5432/usertasks
AUTH_PROVIDER=builtin
REALTIME_PROVIDER=sse
STORAGE_PROVIDER=local
STORAGE_LOCAL_ROOT=/var/lib/usertasks/storage
SCHEDULER_PROVIDER=worker
CACHE_PROVIDER=postgres
EMAIL_PROVIDER=smtp
SMTP_HOST=mail.example.com
SMTP_PORT=587
EMAIL_FROM="UserTasks <tasks@example.com>"
\`\`\`

Then apply the migrations, create the storage buckets, build and start. \`db migrate\` and \`storage init\` don't read \`.env.local\`, so they need \`DATABASE_URL\` (and the storage variables) set in the shell. The first line does that in bash or zsh; in PowerShell, set them with \`$env:DATABASE_URL='postgresql://…'\` instead.

\`\`\`bash
set -a; . ./.env.local; set +a
npm ci
npm run admin -- db migrate
npm run admin -- storage init
npm run build
npm start
\`\`\`

The setup code is printed in the terminal running \`npm start\`. If you put PgBouncer in transaction mode in front of the database, keep migrations, live updates and the worker on a direct connection: see [Database](/docs/services/database).

## From source with Supabase

The quickest way to work on UserTasks itself, with a local Supabase in Docker. New to the terminal? [Quick start on your computer](/docs/self-hosting/quick-start) walks through it step by step.

\`\`\`bash
git clone <repository-url> usertasks && cd usertasks
npm run setup:local
npm run dev
\`\`\`

For a production build, run \`npm run build && npm start\` instead of \`npm run dev\`.

\`npm run setup:local\` works the same in PowerShell, cmd, bash and zsh, and is safe to run again. It checks Node.js and Docker, runs \`npm install\` if needed, starts the local Supabase (\`supabase/config.toml\` is in the repository, so there's no \`supabase init\`), applies any migrations the database doesn't have yet (data is kept; only \`--reset\` wipes it, after asking), writes \`.env.local\` from \`.env.example\` with the local URL and keys and fresh \`ENCRYPTION_KEY\` and \`CRON_SECRET\` values (never overwriting values already there), and stores the cron secret and \`http://host.docker.internal:3000\` in the local Vault so schedules and queued runs work.

The setup code is printed in the terminal running \`npm run dev\`.

### By hand

\`\`\`bash
npm install
npx supabase start
npx supabase status -o env
cp .env.example .env.local
\`\`\`

\`npx supabase start\` applies \`supabase/migrations\` to a new local database, and \`npx supabase status -o env\` prints API_URL, ANON_KEY and SERVICE_ROLE_KEY. In Windows cmd, the last line is \`copy .env.example .env.local\`. In \`.env.local\`, set \`NEXT_PUBLIC_SUPABASE_URL\` (API_URL), \`NEXT_PUBLIC_SUPABASE_ANON_KEY\` (ANON_KEY) and \`SUPABASE_SERVICE_ROLE_KEY\` (SERVICE_ROLE_KEY), then \`ENCRYPTION_KEY\` (\`openssl rand -base64 32\`) and \`CRON_SECRET\` (\`openssl rand -hex 32\`). Run \`npm run dev\`. [Quickstart: self-host](/docs/quickstart/self-host) covers the background-job secrets.

## Next

Open the app and [create your admin account](/docs/self-hosting/admin-account). When it runs on a server, [give it a friendly address](/docs/self-hosting/friendly-address) such as \`https://tasks.yourcompany.com\`. Started from source with a local Supabase? [Move to Supabase Cloud](/docs/self-hosting/local-to-supabase-cloud).
`,
  },
  {
    slug: 'self-hosting/admin-account',
    title: 'Create your admin account',
    description: 'The first-run /setup screen on a self-hosted install: create the first workspace and owner with the setup code from the server log, usertasks-admin setup-code or USERTASKS_SETUP_CODE — or bootstrap from the command line.',
    body: `
A new self-hosted install has no workspaces and no users, and there's no public sign-up page. You create the first workspace and its owner (you) on the **Create your admin account** screen at \`/setup\`.

## When /setup appears

- Only on a self-hosted install (\`DEPLOYMENT_MODE=self_hosted\`, the default) that has no workspaces and no users yet.
- While setup is needed, \`/\`, \`/login\` and the app's pages all redirect to \`/setup\`. Just open the app's address.
- Once the admin account exists, \`/setup\` is gone: it redirects to \`/login\`.
- The cloud edition has no \`/setup\` page.

## Fill in the form

| Field | What to enter |
|---|---|
| Organisation name | Your company or team, for example \`Acme Inc\`. The URL slug (\`acme-inc\`) is made from it and shown underneath; you can edit it. People type the slug in the **Organisation** field on the login page. |
| Your name | Shown on tasks, comments and the audit log |
| Email | Your sign-in email |
| Password and confirm | At least 8 characters and at most 72 bytes |
| Setup code | The code from the server's log (below) |

When you submit, UserTasks:

1. creates the workspace and your owner account, exactly as \`npm run bootstrap\` does
2. signs you in
3. takes you to \`/onboarding\` to finish setting up

## The setup code

The setup code stops a stranger from claiming a fresh install that's reachable from the internet before you get to it. The server prints it to its log when it starts, and again whenever someone opens \`/setup\` while setup is needed:

\`\`\`text
UserTasks setup code: ABCD-EFGH-JKLM (open /setup to create the admin account)
\`\`\`

### Where to find it

| You run UserTasks with | Look here |
|---|---|
| \`npm run dev\` or \`npm start\` | The terminal running it |
| Docker Compose (laptop trial, \`supabase\` or \`standalone\` profile) | \`docker compose logs app \\| grep "setup code"\` |
| Air-gapped bundle | \`./bundle.sh admin setup-code\` prints a fresh code |
| Kubernetes (Helm) | The app pods' logs: see [Kubernetes](#kubernetes) |

### Make a new code

You can make a new code at any time with \`usertasks-admin setup-code\`. Making a new code stops the old one working.

| Install | Command |
|---|---|
| Source checkout | \`npm run setup-code\` (same as \`npm run admin -- setup-code\`) |
| Docker Compose | \`docker compose exec app node admin.cjs setup-code\` |
| Air-gapped bundle | \`./bundle.sh admin setup-code\` |
| Kubernetes | \`kubectl -n usertasks exec deploy/usertasks -- node admin.cjs setup-code\` |

\`usertasks-admin setup-code status\` tells you whether setup is still needed and when the current code was made.

### Choose the code yourself

Set the \`USERTASKS_SETUP_CODE\` environment variable to pick the code up front. This is handy for Docker and Helm installs, where reading logs is a chore.

- Use at least 8 characters.
- Case doesn't matter, and neither do dashes or spaces: \`abcd-efgh-jklm\` and \`ABCDEFGHJKLM\` are the same code.
- While it's set, the log says the code comes from that variable instead of printing it.
- Docker Compose: put it in \`.env\`. Kubernetes: put it in the Secret the chart reads (for example \`--from-literal=USERTASKS_SETUP_CODE=…\`).

### How it's protected

- Only a hash of the code is stored, never the code itself.
- If the server restarts while setup is still needed, it prints a new code.
- Exception: if another replica made a code in the last minute, the log points you to that replica's log or to \`usertasks-admin setup-code\` instead.
- Wrong codes are rate-limited per IP address.
- The code stops working as soon as setup is complete.

### Kubernetes

The app runs two replicas by default, and only one of them prints the code. \`kubectl logs deploy/usertasks\` shows a single pod, so read all the app pods at once:

\`\`\`bash
kubectl -n usertasks logs -l app.kubernetes.io/instance=usertasks,app.kubernetes.io/component=app --tail=-1 | grep "setup code"
\`\`\`

Replace \`usertasks\` with your release name, and \`deploy/usertasks\` with \`deploy/<release>-usertasks\` if the release isn't called \`usertasks\`. Simpler options: run \`setup-code\` with \`kubectl exec\` (above) or set \`USERTASKS_SETUP_CODE\` in the Secret before you install.

## Or use the command line

The command-line bootstrap still works. It's useful for scripted installs, and it skips \`/setup\` entirely. Run it from the UserTasks folder (the one with \`package.json\`):

\`\`\`bash
npm run bootstrap -- --email admin@example.com --password 'a-strong-password' --org "Acme Inc" [--name "Ada Lovelace"]
\`\`\`

In the Docker image, the password can come from \`BOOTSTRAP_PASSWORD\` instead of the command line:

\`\`\`bash
docker compose exec -e BOOTSTRAP_PASSWORD='a-strong-password' app node admin.cjs bootstrap --email admin@example.com --org "Acme Inc"
\`\`\`

The same command is \`usertasks-admin bootstrap\`:

- It prints the organisation slug.
- \`--if-missing\` does nothing if the account already exists.
- \`--api-key <name>\` also creates an API key with every permission and prints it once.

\`npm run bootstrap\`, \`usertasks-admin bootstrap\` and \`usertasks-admin setup-code\` read \`.env.local\`, then \`.env\`, from the current folder by themselves. Variables already set in your shell win. Other commands, such as \`usertasks-admin db migrate\`, don't read these files: set \`DATABASE_URL\` for them yourself. If the provider variables are missing, the command says which ones (see [Troubleshooting](/docs/self-hosting/troubleshooting#missing-environment-variables)).

### On Windows

\`npm run bootstrap\` and \`npm run setup-code\` work the same in PowerShell and cmd. Two things trip people up:

1. **Run them from the UserTasks folder.** \`cd\` into the folder that has \`package.json\`, then check you're in the right place. In PowerShell, \`Test-Path package.json\` should print \`True\`:

   \`\`\`powershell
   cd C:\\src\\usertasks
   Test-Path package.json
   \`\`\`

   In cmd, \`dir package.json\` should list the file:

   \`\`\`bat
   cd /d C:\\src\\usertasks
   dir package.json
   \`\`\`

2. **Quote the password for your shell.** In PowerShell, use single quotes for a password with special characters (\`$\`, \`\` \` \`\`, \`&\`), because PowerShell expands variables inside double quotes. In cmd, use double quotes; single quotes are passed through literally.

   \`\`\`powershell
   npm run bootstrap -- --email admin@example.com --password 'pa$$w0rd!' --org "Acme Inc"
   \`\`\`

   \`\`\`bat
   npm run bootstrap -- --email admin@example.com --password "pa$$w0rd!" --org "Acme Inc"
   \`\`\`

If the npm script still can't find your settings, run the script with Node's \`--env-file\` flag (Node.js 20.6 or later; tsx passes it on to Node):

\`\`\`bash
npx tsx --env-file=.env.local scripts/bootstrap-tenant.ts --email admin@example.com --password 'a-strong-password' --org "Acme Inc"
\`\`\`

With Docker, \`docker compose exec app node admin.cjs bootstrap …\` and \`docker compose exec app node admin.cjs setup-code\` work the same from any shell. The container already has its environment.

### With Helm

The Helm chart can run it as a post-install Job (\`bootstrap.enabled\`, \`bootstrap.email\`, \`bootstrap.org\`, with \`BOOTSTRAP_PASSWORD\` in the Secret). See [First admin account](/docs/self-hosting#4-first-admin-account).

## Next

[Sign in and invite people](/docs/self-hosting/invite-people).
`,
  },
  {
    slug: 'self-hosting/invite-people',
    title: 'Sign in and invite people',
    description: 'Sign in with your organisation slug, invite people from Settings → Members & invites, or connect SSO, LDAP, Google Workspace or SCIM; add instance admins.',
    body: `
After [setup](/docs/self-hosting/admin-account) you're already signed in. Next time, sign in at \`/login\` with three things:

- **Organisation**: your workspace's slug, for example \`acme-inc\`
- **Email address**
- **Password**

Self-hosted installs have no public sign-up page. Everyone else joins by invitation, through single sign-on, or from your directory.

## Invite people by email

1. Open **Settings → Members & invites**.
2. Enter each person's email address and pick a role (\`owner\`, \`admin\`, \`manager\`, \`member\` or \`viewer\`).
3. They get an email with a link, create their account (or sign in, if they already have one) and join the workspace with that role.

Invitation emails need email to be working. In the laptop trial and the standalone profile, mail goes to Mailpit at http://localhost:8025. Point \`SMTP_HOST\` (or another [email provider](/docs/services/email)) at a real relay before you invite real people.

From the CLI:

\`\`\`bash
usertasks invitations send --set email=grace@example.com --set role=member
\`\`\`

See [Teams and invitations](/docs/governance/teams-and-invitations) for teams, resending and revoking.

## Single sign-on and directories

Open **Settings → SSO & directory** to connect your identity provider:

| You want | Read |
|---|---|
| People sign in with Microsoft Entra ID, Okta, Google, Keycloak, AD FS or any OIDC or SAML provider | [SSO and directory sync](/docs/governance/sso) |
| Users, groups and managers synced from LDAP or Active Directory | [LDAP and Active Directory](/docs/governance/ldap) |
| Users and groups from Google Workspace | [Google Workspace](/docs/governance/google-workspace) |
| Your identity provider creates and removes accounts over SCIM 2.0 | [SCIM provisioning](/docs/governance/scim) |

Instance-wide sign-in options (for example \`AUTH_SSO_PROVIDERS\` for Keycloak on premises) are covered in [Auth](/docs/services/auth).

## Instance administrators

Workspace roles don't include the server's own settings. To let someone open **Settings → Infrastructure** (provider status, health checks and provider switches) and **Settings → Workspace DNS**, add them as an instance admin:

- with \`INSTANCE_ADMIN_EMAILS=ops@example.com\` in the environment, or
- with \`usertasks-admin instance-admins add ops@example.com\`.

## Next

[Use the CLI with your server](/docs/self-hosting/cli).
`,
  },
  {
    slug: 'self-hosting/cli',
    title: 'Use the CLI with your server',
    description: 'Install the usertasks CLI (from npm or the offline tarball), log in to your own server with --url, use API keys on servers and in CI, and keep a profile per server.',
    body: `
The \`usertasks\` CLI talks to your server's REST API, so it works the same against your install as against usertasks.com. You only need to tell it where your server is.

> [!NOTE]
> The CLI doesn't install UserTasks. It needs a server that's already running: your local one at http://localhost:3000 (from \`npm run setup:local\` and \`npm run dev\`, or the laptop trial), your company's server, or usertasks.com. It installs no server, database or Supabase.

## Install it

The CLI needs Node.js 20 or later (22 LTS recommended).

\`\`\`bash
npm install -g @user-tasks/cli
usertasks --version
\`\`\`

With no internet access, install it from the [air-gapped bundle](/docs/self-hosting/air-gapped). The tarball in \`npm/\` carries its own dependencies:

\`\`\`bash
npm install -g --offline ./npm/user-tasks-cli-<version>.tgz
\`\`\`

## Log in to your server

If the server runs on this machine at the default address, just run \`usertasks login\`. With no \`--url\`, no \`USERTASKS_URL\` and no saved profile, it uses http://localhost:3000 and says so. For any other host or port, pass the address people open in the browser (\`APP_URL\`) with \`--url\`:

\`\`\`bash
usertasks login
usertasks login --url https://tasks.example.com
usertasks whoami
\`\`\`

The first line logs in to http://localhost:3000 (the laptop trial, or \`npm run dev\`); the second to your domain, or another port.

The localhost default arrived in CLI 0.1.2. Older versions always need \`--url\`; \`usertasks --version\` shows which one you have.

\`login\` opens your browser and asks you to approve access. If you aren't signed in, you sign in first with your organisation slug, email and password. Add \`--no-browser\` to print the link instead of opening it; open it in a browser on the same machine, because the result comes back to the CLI on 127.0.0.1. The login waits up to 5 minutes. On a server with no browser at all, use an API key (below).

The server and your credentials are saved as a profile in \`~/.config/usertasks/config.json\` (\`%APPDATA%\\usertasks\\config.json\` on Windows), so later commands don't need \`--url\`.

## Servers and CI without a browser

Create an API key in **Settings → API keys**, then either store it in a profile:

\`\`\`bash
usertasks login --url https://tasks.example.com --api-key -  < key.txt
usertasks login --url https://tasks.example.com --api-key
\`\`\`

With \`-\`, the key is read from stdin; without a value, \`login\` prompts for it.

or skip the profile and use environment variables (handy in CI):

\`\`\`bash
export USERTASKS_URL=https://tasks.example.com
export USERTASKS_API_KEY=<the key>
usertasks workflows list
\`\`\`

\`USERTASKS_API_KEY\` always overrides a stored credential. \`usertasks-admin bootstrap --api-key <name>\` can mint a first key while it creates the workspace.

## More than one server

Give each login a profile name, then switch between them:

\`\`\`bash
usertasks login --url https://dev.example.com --profile dev
usertasks login --url https://tasks.example.com --profile prod
usertasks profiles use prod
usertasks profiles list
\`\`\`

The full guide is [CLI](/docs/cli). Every command is in the [command reference](/docs/cli/commands).

## Next

- Started on a laptop with \`npm run setup:local\`? [Move from your local Supabase to Supabase Cloud](/docs/self-hosting/local-to-supabase-cloud).
- Moving from \`http://localhost:3000\` to a real address? [Give your install a friendly address](/docs/self-hosting/friendly-address).
`,
  },
  {
    slug: 'self-hosting/local-to-supabase-cloud',
    title: 'Move from your local Supabase to Supabase Cloud',
    description: 'Started with npm run setup:local? Create a Supabase Cloud project, push the migrations, copy your data (accounts included), files and Vault secrets across, point the app at the cloud, deploy it somewhere public, set the Supabase sign-in URLs and check it.',
    body: `
You started with \`npm run setup:local\`: UserTasks and a local Supabase, both on your computer. This page moves you to a real setup: the database, sign-in and files in a **Supabase Cloud** project, and the app on a server your team can reach.

It takes about an hour. Bringing your data across is optional: skip step 3 for a fresh start.

The commands run from the UserTasks folder on your computer, with the local Supabase still running (\`npx supabase start\`). \`your-project-ref\`, \`tasks.yourcompany.com\` and the passwords are examples: use your own.

> [!NOTE]
> These steps use the Supabase CLI through \`npx supabase\`, which fetches the latest version. Since version 3, \`db push\` and \`db dump\` work on the **local** stack unless told otherwise, so the commands below always say which one: \`--linked\` for your cloud project, \`--local\` for the one on your computer. Both flags also work on older versions (version 3 prints a warning that you can ignore).

## 1. Create a Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a **new project**.
2. Pick the **region** closest to your users (and to the server you'll run the app on: every page makes several database calls).
3. Choose a strong **database password** and save it in your password manager. You need it in steps 2 and 3, and Supabase can't show it again (you can only reset it).
4. When the project is ready, collect four things from the dashboard. Supabase moves these around from time to time, so look for these names:
   - **Project ref**: the short id in the dashboard's address (\`supabase.com/dashboard/project/your-project-ref\`) and in **Project Settings**.
   - **Project URL**: \`https://your-project-ref.supabase.co\`, under **Project Settings** (API or Data API).
   - **The anon (publishable) key** and **the service_role (secret) key**, under **Project Settings → API Keys**. If you see both new-style keys and **legacy** anon and service_role keys, the legacy ones are the same kind that \`npx supabase status\` printed for your local stack.
   - **The database connection string**, from the **Connect** button at the top of the dashboard. Use the **Session pooler** string if your network has no IPv6: the direct connection is IPv6-only unless you add Supabase's IPv4 add-on.

Keep the service_role key and the database password secret: either one gives full access to the project.

## 2. Build the database in the cloud

Log in to Supabase, link this folder to the project (it asks for the database password), and apply UserTasks' migrations (\`supabase/migrations\`):

\`\`\`bash
npx supabase login
npx supabase link --project-ref your-project-ref
npx supabase db push --linked --dry-run
npx supabase db push --linked
\`\`\`

The \`--dry-run\` lists the migrations it would apply without changing anything. The last command applies them. The project now has every table, the storage buckets and the pg_cron jobs, but no workspaces or users yet.

**Starting fresh?** Skip step 3. After step 4, open the app, and the first visit sends you to \`/setup\` to [create your admin account](/docs/self-hosting/admin-account).

## 3. Bring your data across (optional)

UserTasks' own provider switch (\`usertasks-admin switch database\`) moves a Supabase install to plain PostgreSQL, not to another Supabase project: for that it says to use a Supabase dump and restore, which is what this step does. You'll copy the database rows (including people and their passwords), then the files.

You need \`psql\`, the PostgreSQL command-line client. On macOS: \`brew install libpq\`, then follow its note to add it to your PATH. On Ubuntu or Debian: \`sudo apt install postgresql-client\`.

### Back up first

Keep a full copy of the local database, in case anything goes wrong:

\`\`\`bash
mkdir -p backups
npx supabase db dump --local -f backups/local-schema.sql
npx supabase db dump --local --data-only --use-copy -f backups/local-all-data.sql
\`\`\`

A **practice run** is worth it: do steps 2 and 3 into a throwaway Supabase project first, check the app against it, then delete it and do it for real.

### Copy the database rows

1. **Dump your data.** Only the schemas UserTasks owns, plus \`auth\` (accounts, password hashes and sign-in identities):

   \`\`\`bash
   npx supabase db dump --local --data-only --use-copy -s auth,public,app_auth,app_cache,app_cron,app_events,app_kms,app_realtime,app_switch -f backups/local-data.sql
   \`\`\`

   Left out on purpose: \`storage\` (the files' records: the upload in the next part creates them), \`cron\` (the migrations already created the jobs in the cloud), and \`vault\` (secrets, which you set again in step 4). Newer versions of UserTasks may add schemas: list yours with \`psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -Atc "select nspname from pg_namespace where nspname like 'app%'"\` and add any missing \`app_\` schema to \`-s\`.

2. **Clear the rows the migrations created** in the cloud database. Your dump has its own copy of each, and restoring on top of them fails with "duplicate key value violates unique constraint". Use your connection string from step 1, in single quotes:

   \`\`\`bash
   psql 'postgresql://postgres.your-project-ref:YOUR-DB-PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres' -v ON_ERROR_STOP=1 -c "delete from public.oauth_clients; delete from app_realtime.listener_state; delete from app_cron.housekeeping_runs;"
   \`\`\`

   These hold the CLI's built-in OAuth client, a realtime bookmark and the housekeeping history; your dump brings back the CLI client and any OAuth apps you added.

3. **Restore it**, all in one transaction, so a failure leaves the cloud database as it was:

   \`\`\`bash
   psql 'postgresql://postgres.your-project-ref:YOUR-DB-PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres' -v ON_ERROR_STOP=1 --single-transaction -f backups/local-data.sql
   \`\`\`

   The dump starts with \`SET session_replication_role = replica\`, which pauses triggers and foreign-key checks while the rows go in, so the order of the tables doesn't matter.

People keep their passwords, because the password hashes come across in \`auth\`. Everyone signs in again once: the cloud project signs sessions with a different key.

### Copy the files

Uploads, logos, fonts and form files live in Supabase Storage buckets. The migrations created the same buckets in the cloud project. Download each bucket from the local stack, then upload it to the cloud:

\`\`\`bash
npx supabase storage ls --experimental --local ss:///
npx supabase storage cp --experimental --local -r ss:///logos storage-backup/logos
npx supabase storage cp --experimental --linked -r storage-backup/logos ss:///logos
\`\`\`

The first command lists the buckets (\`task-files\`, \`logos\`, \`brand-fonts\`, \`job-results\`, \`gallery-community\`, \`form-files\`). Repeat the two \`cp\` lines for each one that has files, changing \`logos\` in both places. The upload keeps each file's path, so the links stored in your data keep working. Supabase's [S3-compatible API](https://supabase.com/docs/guides/storage/s3/compatibility) with a tool such as \`rclone\` also works for large amounts of files.

### Re-point stored file links

With Supabase Storage, UserTasks saves each file's full public address in the data, such as \`http://127.0.0.1:54321/storage/v1/object/public/…\` on your laptop. Those addresses came across in step 3 and still point at your computer. Save this as \`fix-storage-urls.sql\`, put your project ref in \`new_base\` (and use \`http://localhost:54321/storage/v1/\` as \`old_base\` if that's what your \`.env.local\` had):

\`\`\`sql title="fix-storage-urls.sql"
SET session_replication_role = replica;
DO $$
DECLARE
  old_base text := 'http://127.0.0.1:54321/storage/v1/';
  new_base text := 'https://your-project-ref.supabase.co/storage/v1/';
  c record;
  n bigint;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('tenants', 'branding'), ('workspace_themes', 'theme'), ('integrations', 'config'),
    ('integration_references', 'request_config'), ('custom_table_rows', 'data'),
    ('workflows', 'nodes'), ('workflow_versions', 'nodes'), ('workflow_runs', 'node_results'),
    ('workflow_runs', 'pause_variables'), ('workflow_runs', 'execution_trace'),
    ('workflow_queue', 'result'), ('workflow_queue', 'trigger_data'), ('tasks', 'metadata'),
    ('agent_runs', 'outputs'), ('agent_runs', 'context')
  ) AS t(tbl, col) LOOP
    EXECUTE format('UPDATE public.%I SET %I = replace(%I::text, $1, $2)::jsonb WHERE strpos(%I::text, $1) > 0', c.tbl, c.col, c.col, c.col)
      USING old_base, new_base;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '%.%: % row(s)', c.tbl, c.col, n;
  END LOOP;
END $$;
\`\`\`

It changes the address in the columns UserTasks stores file links in (the same list its own storage migration uses), and prints how many rows it changed in each. Run it against the cloud database:

\`\`\`bash
psql 'postgresql://postgres.your-project-ref:YOUR-DB-PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres' -v ON_ERROR_STOP=1 -f fix-storage-urls.sql
\`\`\`

## 4. Point the app at the cloud project

In \`.env.local\` (from source) or \`.env\` (Docker Compose), replace the local Supabase values with the cloud ones:

\`\`\`ini title=".env.local"
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
\`\`\`

- **Keep \`ENCRYPTION_KEY\` exactly as it is** if you copied your data. Connector passwords and tokens are stored encrypted with it (in \`app_kms\` and the connector tables), and a new key can't read them. \`npm run setup:local\` never replaces it, for the same reason. It also signs queued workflow resumes when \`WORKFLOW_SIGNING_SECRET\` isn't set.
- **Keep \`CRON_SECRET\`**, or choose a new one: either way, store it in the cloud project's Vault below.
- The Supabase URL and keys are read when the app starts, so a restart is enough for them: stop \`npm run dev\` or \`npm start\` and start it again.

**Turn on scheduled jobs.** Schedules, reminders and the run queue run when pg_cron in the database calls the app. On your laptop, \`npm run setup:local\` stored the app's address as \`http://host.docker.internal:3000\` in the local Vault, which the cloud can't reach, and the Vault wasn't copied. Once the app has its public address (step 5), store it and the cron secret in the cloud project:

\`\`\`bash
DATABASE_URL='postgresql://postgres.your-project-ref:YOUR-DB-PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres' CRON_SECRET='your-cron-secret' npm run scheduler -- install-pg-cron --base-url https://tasks.yourcompany.com
\`\`\`

It (re)creates the pg_cron jobs and stores \`app_base_url\` and \`cron_secret\` in Vault, and is safe to run again. Use the same value as \`CRON_SECRET\` in the app's settings (or \`WORKFLOW_PROCESSOR_SECRET\`, if you set that). \`npm run scheduler -- status\` shows what's installed.

## 5. Put the app somewhere public

Your laptop isn't a server: pick a place your team can reach, and give it the same settings as your \`.env.local\` (the cloud Supabase values, \`ENCRYPTION_KEY\`, \`CRON_SECRET\`). Set \`APP_URL\` and \`NEXT_PUBLIC_APP_URL\` to the public address, for example \`https://tasks.yourcompany.com\`.

| Where | How |
|---|---|
| **Docker on a server** (simplest to own) | Copy the folder to a VM, put your settings in \`.env\`, and run \`docker compose up -d --build\` (the default profile runs only the app, against your Supabase project). See [Docker Compose](/docs/self-hosting/install#docker-compose), then [Give your install a friendly address](/docs/self-hosting/friendly-address) for the domain and HTTPS |
| **Vercel** | Import the repository as a project and add every setting under **Environment Variables**. \`NEXT_PUBLIC_APP_URL\` and \`DEPLOYMENT_MODE\` are read when Vercel builds, so redeploy after changing them; the Supabase URL and keys are read at runtime. Keep pg_cron as the scheduler (\`vercel.json\` only adds three daily fallback jobs), and note that uploads through the app are capped at 4 MB there (Supabase Storage uploads go straight to storage, so it doesn't apply to them) |
| **Kubernetes** | The Helm chart in \`deploy/helm/usertasks\`: see [Kubernetes (Helm)](/docs/self-hosting/install#kubernetes-helm). \`appUrl\` sets the address |

Whichever you choose, \`APP_URL\` must be the address people open: it's used for sign-in redirects, links in emails and cookies. See [Give your install a friendly address](/docs/self-hosting/friendly-address#5-tell-usertasks-its-address).

## 6. Sign-in settings in Supabase

With Supabase Auth, the cloud project's own settings decide where people are sent after signing in. Your local \`supabase/config.toml\` only applies to the local stack.

1. **Authentication → URL Configuration**:
   - **Site URL**: \`https://tasks.yourcompany.com\`.
   - **Redirect URLs**: add \`https://tasks.yourcompany.com/auth/callback\`. UserTasks sends people back there after a password reset, an email confirmation or Google / Microsoft sign-in; Supabase refuses return addresses that aren't on this list.
2. **Email**: Supabase Auth sends the password-reset and confirmation emails itself. Its built-in mailer is meant for trying things out and sends only a few emails an hour, so set up your own SMTP server in the project's **Authentication** email settings. UserTasks' own emails (invitations, notifications, reminders) go through its email provider instead, such as \`RESEND_API_KEY\` or SMTP: see [Email](/docs/services/email).
3. **Google or Microsoft sign-in**: turn the provider on in the cloud project (**Authentication → Providers**), and in Google Cloud or Microsoft Entra ID add the callback URL that page shows, \`https://your-project-ref.supabase.co/auth/v1/callback\`. For **Sign in with Microsoft**, set \`NEXT_PUBLIC_SSO_MICROSOFT=1\` too. See [SSO and directory sync](/docs/governance/sso).

## 7. Check it

1. **Sign in** at \`https://tasks.yourcompany.com/login\` with your organisation slug, email and password (or create the admin account at \`/setup\` on a fresh start).
2. **Run the platform self-test**: **Settings → General → Platform self-test → Install self-test**, then run the **Kitchen sink** workflow. It should end with "Kitchen sink: N/N passed". See [Platform self-test](/docs/workflows/self-test).
3. **Check scheduled jobs** a few minutes after step 4's \`install-pg-cron\`. \`usertasks-admin doctor\` reports the pg_cron jobs and the last tick ("last tick … min ago"):

   \`\`\`bash
   npm run admin -- doctor
   \`\`\`

   Run it with the cloud settings in the environment (\`DATABASE_URL\` set to the connection string, plus the Supabase URL and keys), or with Docker: \`docker compose exec app node admin.cjs doctor\`.
4. **Open a few files**: a logo, an attachment on a task or form.

## 8. Troubleshooting

### db push fails

- **"Remote migration versions not found in local migrations directory"**: the project isn't empty, or something else wrote to it. Use a new, empty project.
- **It applied nothing, or changed your local database**: the CLI ran against the local stack. Add \`--linked\` (as above).
- **Connection or password errors**: run \`npx supabase link --project-ref your-project-ref\` again and re-enter the database password, or reset it in the dashboard.

### "permission denied" or "duplicate key" when restoring

- **"duplicate key value violates unique constraint"**: rows from the migrations are still there. Run the \`delete from …\` line in step 3 first. Restore into a database that has only had \`db push\`: if an earlier restore was partly committed, start again with a fresh project.
- **"permission denied"**: connect as the \`postgres\` user with the connection string from the **Connect** button, not with an API key, and dump only the schemas listed in step 3 (Supabase's own schemas, such as \`storage\` internals or \`vault\`, can't be written from outside).
- **"column … does not exist" in an \`auth\` table**: the local Supabase is older than the cloud. Update the CLI (\`npx supabase@latest\`), run \`npx supabase stop\` and \`npx supabase start\` so the local auth service catches up, then dump again.

### People can't sign in after the move

- **"Invalid email or password"** for everyone: the \`auth\` rows weren't restored. Check that the dump included \`auth\`.
- **Sent back to the login page, or to \`localhost\`**: the Site URL and Redirect URLs (step 6), or \`APP_URL\` (step 5), still have the old address.
- **The organisation isn't found**: the \`public\` rows weren't restored.

### Files are missing

- **A file opens a "not found" error:** the bucket wasn't copied, or only partly. Run that bucket's two \`cp\` lines (step 3) again.
- **A link still says \`127.0.0.1:54321\` or \`localhost\`:** run \`fix-storage-urls.sql\` (step 3), with \`old_base\` matching the address in the link. Links saved somewhere else (an email already sent, an outside system) can't be changed: upload the file again in the app.

### Schedules don't run

- Run the \`install-pg-cron\` command from step 4 again, with the public address (never \`host.docker.internal\` or \`localhost\`).
- The cron secret in Vault must equal \`CRON_SECRET\` (or \`WORKFLOW_PROCESSOR_SECRET\`) in the app's settings.
- The app must be reachable from the internet at that address, over HTTPS with a valid certificate.
- \`npm run admin -- doctor\` shows the last tick and any failing job.

## Next

[Give your install a friendly address](/docs/self-hosting/friendly-address).
`,
  },
  {
    slug: 'self-hosting/friendly-address',
    title: 'Give your install a friendly address',
    description: 'Move from http://localhost:3000 to https://tasks.yourcompany.com: DNS records (GoDaddy, Cloudflare, Route 53), HTTPS with Caddy, nginx and certbot, a Helm ingress or Docker Compose, APP_URL and APP_BASE_DOMAIN (restart or rebuild), Settings → Workspace DNS checks, per-workspace addresses and friendly form links, and what to update afterwards.',
    body: `
Out of the box, UserTasks answers at \`http://localhost:3000\`. That's fine on your own computer, but your team needs a proper address, such as **\`https://tasks.yourcompany.com\`**. This page walks you through it: DNS, HTTPS, telling UserTasks its new address, and the things that remember the old one.

Optionally, each workspace can also get its own address, such as \`acme.tasks.yourcompany.com\`, with friendly form links like \`acme.tasks.yourcompany.com/form/employee-onboarding\`.

The examples use \`tasks.yourcompany.com\` and the server address \`203.0.113.10\`. Replace them with your own.

## 1. Before you start

You need:

- **A server other people can reach**: a VM or machine with a public IP address (or an address on your company network), where UserTasks is already running. See [Install step by step](/docs/self-hosting/install).
- **A domain** you own, such as \`yourcompany.com\`.
- **Access to the domain's DNS settings**, at GoDaddy, Cloudflare, Route 53 or wherever the domain is managed. Ask your IT team if you're not sure.

> [!NOTE]
> Running UserTasks on a laptop at \`http://localhost:3000\`? Keep using that address. A laptop on \`localhost\` can't get a public address or a trusted certificate, and it doesn't need one for a trial. Come back to this page when you move to a server.

## 2. Pick your address

| Option | Looks like | What it needs |
|---|---|---|
| **One address** (most installs) | \`https://tasks.yourcompany.com\` | One DNS record, one certificate, and \`APP_URL\` |
| **Per-workspace addresses** (optional, on top) | \`https://acme.tasks.yourcompany.com\` | Also \`APP_BASE_DOMAIN\`, a wildcard DNS record (\`*.tasks.yourcompany.com\`) and a wildcard certificate |

Start with one address. You can add per-workspace addresses later.

Use a subdomain that serves only UserTasks, such as \`tasks.yourcompany.com\`. With per-workspace addresses on, the sign-in cookie is shared with every name under it, so nothing else (a blog, a status page) should live under that name.

## 3. Point DNS at your server

In your DNS provider, add a record for your address:

| Type | Name (host) | Value | When |
|---|---|---|---|
| \`A\` | \`tasks\` | \`203.0.113.10\` | Your server has an IPv4 address |
| \`AAAA\` | \`tasks\` | your server's IPv6 address | Optional, if it also has IPv6 |
| \`CNAME\` | \`tasks\` | \`lb-1234.example.com\` | Instead of A / AAAA, when you have a load balancer with a hostname |

For per-workspace addresses, add a **wildcard** record next to it, pointing at the same place:

| Type | Name (host) | Value |
|---|---|---|
| \`A\` (or \`CNAME\`) | \`*.tasks\` | the same value as \`tasks\` |

Most providers want the name without your domain (\`tasks\`, \`*.tasks\`). Some want the full name (\`tasks.yourcompany.com\`).

**GoDaddy:** **My Products** → your domain → **DNS** → **DNS Records** → **Add New Record**. Type \`A\`, Name \`tasks\`, Value your server's IP address. Add a second record with Name \`*.tasks\` for per-workspace addresses. GoDaddy's DNS API isn't open to every account, so check before you rely on it for a wildcard certificate (step 4).

**Cloudflare:** **DNS** → **Records** → **Add record**. Set **Proxy status** to **DNS only** (grey cloud) to start:

- With DNS only, browsers connect straight to your server, and your server's own certificate (from Caddy or certbot below) is the one they see.
- With the proxy on (orange cloud), Cloudflare shows its own certificate. Set **SSL/TLS** to **Full (strict)**; **Flexible** talks to your server over plain http, which causes redirect loops. Cloudflare's free certificate covers \`yourcompany.com\` and \`*.yourcompany.com\`, but not a name two levels down such as \`acme.tasks.yourcompany.com\`, so keep the wildcard record on DNS only. Live updates work through the proxy: the app sends a keep-alive every 15 seconds, well inside Cloudflare's idle timeout.

**Route 53:** **Hosted zones** → your domain → **Create record**. Record name \`tasks\`, type \`A\`, value your server's IP address (or **Alias** to your load balancer). For per-workspace addresses, add record name \`*.tasks\` with the same value.

**Check it.** DNS changes usually show up within minutes, but can take up to 48 hours. In a terminal:

\`\`\`bash
nslookup tasks.yourcompany.com
dig +short tasks.yourcompany.com
\`\`\`

Both should print your server's address. For the wildcard, try any name under it:

\`\`\`bash
dig +short test.tasks.yourcompany.com
\`\`\`

\`dig\` comes with macOS and most Linux systems; on Windows, use \`nslookup\`.

## 4. Put HTTPS in front

UserTasks itself speaks plain http on port 3000. Put a **reverse proxy** in front of it: a small web server that holds the certificate, answers on \`https://\` (port 443) and passes each request on to the app. Whichever you use, it must:

- pass the original \`Host\` header (the app reads the address, and the workspace, from it, and sign-in forms check it);
- send \`X-Forwarded-Proto\` and \`X-Forwarded-For\`;
- not buffer streamed responses (live updates and run progress are Server-Sent Events) and allow long reads;
- accept uploads of at least 50 MB, the app's default limit (\`FORM_UPLOAD_MAX_BODY_MB\`; see [file upload limits](/docs/self-hosting#file-uploads-and-request-size-limits)).

Pick one of the examples below. Open ports 80 and 443 in your server's firewall: certificate authorities check port 80 when they issue a certificate.

### Caddy (automatic HTTPS)

[Caddy](https://caddyserver.com/docs/install) gets and renews a free Let's Encrypt certificate by itself. Its \`reverse_proxy\` passes \`Host\` and sets the \`X-Forwarded-*\` headers, and it streams Server-Sent Events without buffering. Install it, then put this in \`/etc/caddy/Caddyfile\`:

\`\`\`caddyfile title="/etc/caddy/Caddyfile"
tasks.yourcompany.com {
	request_body {
		max_size 64MB
	}
	reverse_proxy 127.0.0.1:3000
}
\`\`\`

Then reload Caddy:

\`\`\`bash
sudo systemctl reload caddy
\`\`\`

**Per-workspace addresses** need a wildcard certificate. Let's Encrypt only issues those through a **DNS challenge**, so Caddy needs your DNS provider's plugin and an API token. Stock Caddy doesn't include these plugins: download a build with yours from [caddyserver.com/download](https://caddyserver.com/download) (for example \`caddy-dns/cloudflare\` or \`caddy-dns/route53\`), or build one with \`xcaddy\`. With the Cloudflare plugin, and the token in \`CF_API_TOKEN\`:

\`\`\`caddyfile title="/etc/caddy/Caddyfile"
tasks.yourcompany.com, *.tasks.yourcompany.com {
	tls {
		dns cloudflare {env.CF_API_TOKEN}
	}
	request_body {
		max_size 64MB
	}
	reverse_proxy 127.0.0.1:3000
}
\`\`\`

### nginx and certbot

1. Install nginx and certbot. On Ubuntu or Debian:

   \`\`\`bash
   sudo apt install nginx certbot python3-certbot-nginx
   \`\`\`

2. Save this as \`/etc/nginx/sites-available/usertasks\`:

   \`\`\`nginx title="/etc/nginx/sites-available/usertasks"
   server {
       listen 80;
       server_name tasks.yourcompany.com;

       # Match the app's upload limit (FORM_UPLOAD_MAX_BODY_MB, 50 MB by default).
       client_max_body_size 64m;

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-Host $host;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header Connection "";

           # Live updates are Server-Sent Events: pass them through as they come.
           proxy_buffering off;
           proxy_read_timeout 3600s;
       }
   }
   \`\`\`

3. Turn it on, check it, and reload:

   \`\`\`bash
   sudo ln -s /etc/nginx/sites-available/usertasks /etc/nginx/sites-enabled/usertasks
   sudo nginx -t
   sudo systemctl reload nginx
   \`\`\`

4. Get the certificate. certbot adds the \`listen 443 ssl\` lines and an http-to-https redirect to the file, and renews the certificate by itself:

   \`\`\`bash
   sudo certbot --nginx -d tasks.yourcompany.com
   \`\`\`

**Per-workspace addresses:** add \`*.tasks.yourcompany.com\` to \`server_name\`. The wildcard certificate needs certbot's DNS plugin for your provider (for example \`python3-certbot-dns-cloudflare\` or \`python3-certbot-dns-route53\`) instead of \`--nginx\`, then point \`ssl_certificate\` and \`ssl_certificate_key\` at the files it writes:

\`\`\`bash
sudo certbot certonly --dns-cloudflare --dns-cloudflare-credentials /root/.secrets/cloudflare.ini -d tasks.yourcompany.com -d '*.tasks.yourcompany.com'
\`\`\`

### Kubernetes (Helm)

The chart has an Ingress. Turn it on in your values file, with cert-manager for the certificate. Its host defaults to the host of \`appUrl\`:

\`\`\`yaml title="my-values.yaml"
appUrl: "https://tasks.yourcompany.com"

ingress:
  enabled: true
  className: nginx
  maxBodySize: "64m"
  certManager:
    clusterIssuer: letsencrypt-prod
  tls:
    enabled: true
  annotations:
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
\`\`\`

Then \`helm upgrade\` (step 5). \`letsencrypt-prod\` is the name of a cert-manager ClusterIssuer you've already created. The certificate goes in the Secret \`<release>-tls\` unless you set \`ingress.tls.secretName\`.

**Per-workspace addresses:** the chart's Ingress has one host. Either use the chart's Gateway API route, which takes wildcard names (\`gateway.enabled: true\`, \`gateway.parentRefs\`, and \`gateway.hostnames\` with \`tasks.yourcompany.com\` and \`*.tasks.yourcompany.com\`), or add a second Ingress of your own for \`*.tasks.yourcompany.com\` pointing at the same Service (\`usertasks\`, port \`http\`). Either way, the wildcard certificate needs a cert-manager issuer with a **DNS-01** solver:

\`\`\`yaml title="wildcard-certificate.yaml"
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: usertasks-wildcard
  namespace: usertasks
spec:
  secretName: usertasks-wildcard-tls
  issuerRef:
    name: letsencrypt-dns01
    kind: ClusterIssuer
  dnsNames:
    - "tasks.yourcompany.com"
    - "*.tasks.yourcompany.com"
\`\`\`

### Docker Compose

\`docker-compose.yml\` publishes the app on port \`APP_PORT\` (3000 by default) of the server. Put the proxy in front of it:

1. Keep the app off the network, so only the proxy reaches it. In \`.env\`:

   \`\`\`ini title=".env"
   APP_PORT=127.0.0.1:3000
   \`\`\`

   (Compose then publishes \`127.0.0.1:3000:3000\`: reachable from the server itself, not from outside.)

2. Install Caddy or nginx on the server and use the [Caddy](#caddy-automatic-https) or [nginx](#nginx-and-certbot) example above. Both point at \`127.0.0.1:3000\`.

If you'd rather run the proxy in Docker as well, add a Caddy container next to the app. Save this as \`docker-compose.override.yml\` next to \`docker-compose.yml\`, which \`docker compose\` reads automatically, and change the Caddyfile's last line to \`reverse_proxy app:3000\`:

\`\`\`yaml title="docker-compose.override.yml"
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    depends_on:
      - app

volumes:
  caddy_data:
\`\`\`

\`npm run stack\` names its Compose files itself and doesn't read the override: use \`docker compose --profile standalone up -d\` with it instead.

## 5. Tell UserTasks its address

UserTasks builds links, redirects and cookies from the address you give it. Set:

| Variable | Set it to | What it does |
|---|---|---|
| \`APP_URL\` | \`https://tasks.yourcompany.com\` | The address people open: scheme, host and port if any, no trailing slash. Used for links in emails (invitations, password resets, notifications), sign-in and SSO redirects, OAuth redirect URIs and the SCIM URL. An \`https://\` address also makes the sign-in cookies Secure |
| \`NEXT_PUBLIC_APP_URL\` | the same address | The older name for the same setting (\`APP_URL\` wins when both are set). It's also the address the build sees: a few pages are generated during the build, and for Docker it's a build argument. Keep the two equal |
| \`APP_BASE_DOMAIN\` | \`tasks.yourcompany.com\` | Optional. Turns on per-workspace addresses, \`<workspace>.tasks.yourcompany.com\`. Leave it unset for one address |

With **only \`APP_URL\`** set, UserTasks has one address. Everything happens on it, the sign-in cookie belongs to that one host, and **Settings → General → Workspace address** says "Workspace addresses are off on this instance". On a self-hosted install, \`APP_URL\` alone never turns on per-workspace addresses. Friendly form links still work on the one address (\`https://tasks.yourcompany.com/form/<system name>\`), in the signed-in person's current workspace.

With **\`APP_BASE_DOMAIN\`** set, every name one level under it is a workspace address, and \`www.\` and \`app.\` in front of it count as the main address. Two things to get right:

- **Set it to the host of \`APP_URL\`** (\`tasks.yourcompany.com\` for \`https://tasks.yourcompany.com\`). If you set \`APP_BASE_DOMAIN=yourcompany.com\` while \`APP_URL\` is \`https://tasks.yourcompany.com\`, then \`tasks\` itself is read as a workspace address and the main page says "No workspace at this address".
- **Sharing one sign-in across the workspace addresses needs HTTPS.** The cookie is shared (\`Domain=tasks.yourcompany.com\`) only when \`APP_URL\` is \`https://\` and the base domain has a dot in it. People then sign in on the main address and come back to the workspace address they asked for, so SSO settings need no wildcard entries. On plain http, each address keeps its own sign-in.

\`APP_BASE_DOMAIN=off\` turns per-workspace addresses off again.

Put the values where your install keeps its settings:

| You run | Settings file |
|---|---|
| From source (\`npm run build\`, \`npm start\`) | \`.env.local\` |
| Docker Compose (and \`npm run stack\`) | \`.env\` |
| Kubernetes | \`appUrl\` in your values file (the chart sets \`APP_URL\` and \`NEXT_PUBLIC_APP_URL\` from it); \`APP_BASE_DOMAIN\` under \`env\` |

For example, in \`.env.local\` or \`.env\`:

\`\`\`ini title=".env"
APP_URL=https://tasks.yourcompany.com
NEXT_PUBLIC_APP_URL=https://tasks.yourcompany.com
APP_BASE_DOMAIN=tasks.yourcompany.com
\`\`\`

and in a Helm values file:

\`\`\`yaml title="my-values.yaml"
appUrl: "https://tasks.yourcompany.com"
env:
  APP_BASE_DOMAIN: "tasks.yourcompany.com"
\`\`\`

### Restart or rebuild?

The server reads \`APP_URL\` and \`APP_BASE_DOMAIN\` from its environment while it runs, so a **restart** puts them into effect: links, redirects, cookies, workspace addresses. \`NEXT_PUBLIC_APP_URL\` is also read **when the app is built**, for the few pages generated ahead of time, so **rebuild** too to keep those links right. Do both:

| You run | Then |
|---|---|
| From source | \`npm run build\`, then stop \`npm start\` (Ctrl+C) and start it again |
| \`npm run dev\` | Stop it and start it again |
| Docker Compose | \`docker compose up -d --build\` (add \`--profile standalone\` if you use it). Plain \`docker compose up -d\` restarts with the new settings but keeps the old build argument |
| \`npm run stack\` | \`npm run stack -- up\` (it rebuilds) |
| Kubernetes | \`helm upgrade usertasks deploy/helm/usertasks -n usertasks -f my-values.yaml --wait\`. The pods restart by themselves when the settings change. The image's own build-time address only affects the pages generated during the build: build it with \`--build-arg NEXT_PUBLIC_APP_URL=https://tasks.yourcompany.com\` to set it |

For example, with Docker Compose and the standalone profile:

\`\`\`bash
docker compose --profile standalone up -d --build --wait
\`\`\`

Then open \`https://tasks.yourcompany.com\`. Everyone signs in once on the new address: sign-in cookies belong to one host name, so the old address's sign-in doesn't carry over.

## 6. Check it in Settings → Workspace DNS

For per-workspace addresses, **Settings → Workspace DNS** shows the records to add for your base domain and checks them live. Only **instance admins** see it: people whose verified email address is in \`INSTANCE_ADMIN_EMAILS\` or was added with \`usertasks-admin instance-admins add <email>\` (see [Instance administrators](/docs/self-hosting/invite-people#instance-administrators)). Workspace roles, even owner, don't grant it; everyone else gets a "not found" page.

On a self-hosted install, it lists:

- **The base domain** to set (\`APP_BASE_DOMAIN\`).
- **The wildcard record**: \`*.tasks.yourcompany.com\`, an \`A\` / \`AAAA\` record at the same addresses as \`tasks.yourcompany.com\` resolves to now (or a \`CNAME\` to your load balancer), with copy buttons.
- **Certificate examples** for cert-manager, Caddy and Traefik, and a reminder to forward the \`Host\` header.

**Check again** runs the checks against a random name no workspace has (such as \`ut-check-1a2b3c4d.tasks.yourcompany.com\`), so it tests the wildcard and not a cached name. Results are kept for a minute; **Check again** skips the wait.

| Check | OK means |
|---|---|
| Base domain | \`APP_BASE_DOMAIN\` is set. "Not working" here means it isn't (with only \`APP_URL\` set, that's expected) |
| Wildcard DNS | The random name resolves, so every \`*.tasks.yourcompany.com\` name does |
| Apex DNS | \`tasks.yourcompany.com\` itself resolves |
| Nameservers | Which DNS provider hosts the zone. Information only |
| _acme-challenge delegation | Information only on a self-hosted install: fine when your certificate tool has API access to the DNS zone |
| Wildcard certificate | The certificate your proxy shows for the random name is valid and trusted. Skipped while the wildcard doesn't resolve, or when \`APP_URL\` is plain http |
| App answers | The random name reaches UserTasks. It answers 404, "No workspace at this address", and that's the app working |

Run **Check again** until Wildcard DNS, Wildcard certificate and App answers are all OK.

## 7. Optional: set the workspace address

With \`APP_BASE_DOMAIN\` set, open **Settings → General → Workspace address**. Every member can see it; changing it needs **Edit settings**.

- **Rules:** lowercase letters a–z, numbers and hyphens, 3–40 characters, not starting or ending with a hyphen, no two hyphens in a row. Reserved names such as \`www\`, \`app\`, \`api\`, \`docs\`, \`admin\` and \`mail\` can't be used. Availability is checked as you type.
- **A head start:** workspaces whose organisation slug fits the rules already have it as their address.
- **Friendly form links:** every reusable form then opens at \`https://acme.tasks.yourcompany.com/form/<system name>\`.
- **Changing it later:** links to the old address redirect to the new one for a year, and no other workspace can take the old address in that time. After that the old links stop working. Removing the address breaks them at once.

The address isn't the organisation name people type when they sign in. That stays the same. See [Workspace address](/docs/governance/workspace-address).

## 8. Update things that remember the old address

UserTasks doesn't redirect from the old address to the new one. Requests to another host name are served as they are, so anything that still uses \`http://localhost:3000\` or the server's IP address needs updating:

- **Single sign-on.** Callback URLs are built from \`APP_URL\`, so update them in your identity provider:
  - Built-in auth with OIDC (\`AUTH_SSO_PROVIDERS\`): redirect URI \`https://tasks.yourcompany.com/auth/sso/<id>/callback\`.
  - Built-in auth with SAML: ACS URL \`https://tasks.yourcompany.com/auth/saml/<id>/acs\`. The SP entity ID defaults to \`https://tasks.yourcompany.com/auth/saml/<id>/metadata\`, so it changes too: update it in the identity provider, or set \`spEntityId\` to the old value.
  - Supabase Auth (Google, Microsoft): the identity provider's callback is your Supabase project's URL, which doesn't change. In Supabase, **Authentication → URL Configuration**, set **Site URL** to the new address and add \`https://tasks.yourcompany.com/auth/callback\` to **Redirect URLs**.
- **OAuth connections** (DocuSign, Adobe Acrobat Sign, Dropbox Sign, PandaDoc, SignNow and other OAuth connectors): register the redirect URI \`https://tasks.yourcompany.com/api/connectors/oauth/callback\` in each provider's app settings.
- **The CLI.** Log in again with the new address. Scripts and CI that set \`USERTASKS_URL\` need the new value too:

  \`\`\`bash
  usertasks login --url https://tasks.yourcompany.com
  \`\`\`

- **Webhooks and integrations that call in**, such as inbound workflow webhooks (\`/api/webhooks/inbound\`), e-signature callbacks and SCIM provisioning (\`/scim/v2\`): change the URL in each sending system.
- **Scheduled jobs on Supabase (pg_cron).** If the database calls the app at the old public address, store the new one in Vault (\`app_base_url\`). From the UserTasks folder, with \`DATABASE_URL\` and \`CRON_SECRET\` set in the environment:

  \`\`\`bash
  npm run scheduler -- install-pg-cron --base-url https://tasks.yourcompany.com
  \`\`\`

- **Bookmarks, shared form links and QR codes** that point at the old address.

To keep old links working, have your proxy redirect the old name to the new one, as long as the old name still reaches the server (an IP address or an internal name, for example).

## 9. Troubleshooting

### The browser warns about the certificate

- The certificate doesn't cover the name you opened. For a workspace address, you need the wildcard certificate (\`*.tasks.yourcompany.com\`), which only a DNS challenge can issue.
- The certificate wasn't issued yet. Check the proxy's log (\`journalctl -u caddy\`, or certbot's output): port 80 must be open, and DNS must already point at the server.
- Cloudflare's proxy is on for a name two levels down (\`acme.tasks.yourcompany.com\`). Switch that record to **DNS only**.

### The page keeps redirecting

Usually Cloudflare's **Flexible** SSL mode, or a proxy that talks plain http to another proxy that redirects to https. Use **Full (strict)** in Cloudflare, and make sure the proxy in front of the app sends \`X-Forwarded-Proto\` with the scheme the browser used.

### Signing in sends me back to the login page

- **The address in the browser isn't \`APP_URL\`.** Sign-in redirects go to \`APP_URL\`, and cookies belong to one host. Open exactly that address, and check \`APP_URL\` has no typo (scheme included, no trailing slash).
- **\`APP_URL\` is \`https://\` but you reached the app over \`http://\`.** Browsers drop Secure cookies on plain http. Open the https address.
- **The proxy changes the host.** It must pass the original \`Host\` header.
- **Per-workspace addresses:** set \`APP_BASE_DOMAIN\` to the host of \`APP_URL\`, and serve every address over https so the cookie can be shared.
- **Old cookies:** after the change, sign out, or clear the site's cookies, then sign in again.

More causes: [Signing in sends me back to the login page](/docs/self-hosting/troubleshooting#signing-in-sends-me-back-to-the-login-page).

### The DNS check stays red

- **Propagation:** new records can take from minutes to 48 hours to show up everywhere. Run \`dig +short test.tasks.yourcompany.com\` to see what your computer gets, then **Check again** later.
- **The wildcard name is wrong:** it's \`*.tasks\` (or \`*.tasks.yourcompany.com\`), next to the \`tasks\` record, not \`*\` alone, which would be \`*.yourcompany.com\`.
- **Base domain says "Not working":** \`APP_BASE_DOMAIN\` isn't set where the app runs. Set it and restart.
- **App answers warns "without the app's headers":** the name reaches some other web server. Point the record at the same server as \`tasks.yourcompany.com\`, and add the wildcard name to the proxy.

### The page loads, but live updates don't

Lists and run progress update through Server-Sent Events, long-lived responses that the proxy must pass through as they arrive.

- nginx: \`proxy_buffering off;\` and a long \`proxy_read_timeout\` (the example uses 3600s).
- ingress-nginx: the \`proxy-buffering: "off"\` and \`proxy-read-timeout\` annotations in the Helm example.
- Caddy streams them already.
- A load balancer in between (AWS ALB, Azure, Google Cloud): raise its idle timeout to a few minutes.

## Next

[Updates and backups](/docs/self-hosting/updates-and-backups).
`,
  },
  {
    slug: 'self-hosting/updates-and-backups',
    title: 'Updates and backups',
    description: 'Update a self-hosted install (code and migrations) for each way of running it, and back up the database, files and encryption keys.',
    body: `
## Updating

Every update has two parts: the new code, and any new database migrations. Apply both.

| You run | To update |
|---|---|
| Source with Supabase | \`git pull\`, \`npm ci\`, \`npx supabase db push --linked\` (or \`npx supabase db reset\` on a local stack, which wipes it), \`npm run build\`, then restart \`npm start\` |
| Source with your own PostgreSQL | \`git pull\`, \`npm ci\`, \`npm run admin -- db migrate\`, \`npm run build\`, then restart \`npm start\` |
| Docker Compose, \`supabase\` profile | \`git pull\`, \`npx supabase db push --linked\`, then \`docker compose up -d --build\` |
| Docker Compose, standalone or laptop trial | \`git pull\`, then \`docker compose --profile standalone up -d --build --wait\` (or \`npm run stack -- up\`). The \`migrate\` container applies migrations on every start |
| Kubernetes | Build and push the new image, then \`helm upgrade\` with the new \`image.tag\`. Migrations run as a hook or a Job before the new pods start |
| Air-gapped bundle | Build a new bundle with the same signing key, then \`verify\`, \`load\`, and \`./bundle.sh up\` or \`helm upgrade\` |

Before updating, read the release notes and [Database and migrations](/docs/self-hosting/database): it lists any migration that needs care on a live database. \`usertasks-admin db status\` shows which migrations are applied. \`GET /api/version\` shows the version and commit a server is running.

## Backups

Back up three things. The database matters most.

1. **The database.** It holds everything: workspaces, workflows, runs, tasks, data tables and the audit log.
   - Hosted Supabase: the project's backups, plus your own dump with \`npx supabase db dump\`.
   - Your own PostgreSQL: your usual tool (\`pg_dump\`, snapshots, your cloud's backups). For the standalone profile:

     \`\`\`bash
     docker compose exec -T postgres pg_dump -U usertasks -Fc usertasks > usertasks-$(date +%F).dump
     \`\`\`

2. **Files.** Uploads, generated documents and logos live in the storage provider: Supabase Storage, the MinIO volume (\`miniodata\`), your S3, Blob or GCS bucket, or the \`STORAGE_LOCAL_ROOT\` folder.
3. **Keys and settings.** Your \`.env\`, \`.env.local\` or Kubernetes Secret.
   - Keep a safe copy of \`ENCRYPTION_KEY\` (or your KMS key) in particular: without it, the connector passwords and tokens stored in the database can't be read.
   - If the Helm chart created the Secret for you, back up its generated \`ENCRYPTION_KEY\` and \`CRON_SECRET\`.

Provider switches make their own backups before they change anything: see [Switching providers](/docs/self-hosting/switching-providers). To keep workflows, forms and settings in Git as well, use [Config as code](/docs/config-as-code) (\`usertasks config export <dir>\`).
`,
  },
  {
    slug: 'self-hosting/troubleshooting',
    title: 'Troubleshooting',
    description: 'Fixes for common self-hosting problems: the Docker build is Killed (memory), zsh: bad pattern: #, npm EBADENGINE warnings, Docker not running, the local Supabase won\'t start, no sign-up page, a lost setup code, the CLI can\'t reach the server or says "No server URL", port 3000 in use, and sign-in that loops back to the login page.',
    body: `
## The Docker build was Killed, or says "cannot allocate memory"

\`npm run stack -- up\` (building locally because no published image could be pulled, or with \`--build\`) or \`docker compose up --build\` stops during \`Creating an optimized production build\` with \`Killed\`, \`ResourceExhausted\` or \`cannot allocate memory\`, then \`docker up -d --wait… exited with 1\`.

Docker ran out of memory while compiling UserTasks. The build needs about ${DOCKER_BUILD_MEMORY_GB} GB of memory for Docker:

1. In Docker Desktop: **Settings → Resources → Memory**, set it to ${DOCKER_BUILD_MEMORY_GB} GB or more, then **Apply & restart**. (Windows with WSL 2: set \`memory=\` in \`%UserProfile%\\.wslconfig\`, then run \`wsl --shutdown\`.)
2. Stop other containers you don't need while it builds; a local Supabase, for example, uses 2 to 4 GB.
3. Run the same command again. Packages already downloaded are reused.

If a published image exists for your version, \`npm run stack -- up\` downloads it instead of building. It builds when the pull failed: check the line it printed before building (\`No published image … could be pulled\`), your network, and that you didn't pass \`--build\`.

Can't give Docker that much? Run [from source](/docs/self-hosting/quick-start) with \`npm run setup:local\` instead: nothing is compiled inside Docker. [Requirements](/docs/self-hosting/requirements#memory-for-the-docker-build) has the details.

## zsh: bad pattern: #, or zsh: command not found: #

You pasted several commands with \`#\` comments into the macOS Terminal. An interactive zsh, the Mac's default shell, doesn't treat \`#\` as the start of a comment, so it tries to run the comment.

- Paste one command at a time, and leave out anything after a \`#\`.
- Or turn comments on for this terminal window first, then paste again:

\`\`\`bash
setopt interactive_comments
\`\`\`

To keep it on, add that line to \`~/.zshrc\`. The snippets on usertasks.com and in these docs have no comments, so they paste as they are.

## npm warn EBADENGINE … required: { node: '>=22' }

A warning, not an error: one of UserTasks' packages (\`unpdf\`, which reads PDFs) asks for Node.js 22, and your computer has an older version. \`npm install\` still finishes and UserTasks runs on Node.js 20.9 or later, but Node.js 20 is past its end of life: install the **22 LTS** (or later) from [nodejs.org](https://nodejs.org/), open a new terminal, and check with \`node --version\`. If you use nvm: \`nvm install 22\`, then \`nvm use 22\`.

## I can't find the sign-up page

There isn't one on a self-hosted install. That's on purpose: nobody can create an account on your server unless you let them.

- **New install:** open the app. While no workspace exists, every page redirects to \`/setup\`, where you [create your admin account](/docs/self-hosting/admin-account).
- **Everyone else:** they join by [invitation, SSO or directory sync](/docs/self-hosting/invite-people).

The **Create a free workspace** link on the login page only exists in the cloud edition at usertasks.com.

If someone without an invitation tries to sign in, they see "Invalid email or password. If you're new, ask an admin to invite you first."

## /setup sends me to the login page

Setup is already done: a workspace or a user exists. Perhaps someone ran \`npm run bootstrap\`, used \`npm run stack -- up --email …\`, or the Helm chart's bootstrap Job ran.

- Sign in with that account at \`/login\`.
- If nobody knows its password, use **Forgot password?** on the login page. This needs email to be working.
- To find out whether setup is still needed, run \`usertasks-admin setup-code status\`.

## I lost the setup code, or it doesn't work

- **Make a new one:**
  - from a source checkout: \`npm run setup-code\`
  - with Docker Compose: \`docker compose exec app node admin.cjs setup-code\`
  - on Kubernetes: \`kubectl -n usertasks exec deploy/usertasks -- node admin.cjs setup-code\`

  The previous code stops working when you do.
- **The server restarted:** it printed a new code, and the old one no longer works. Look at the newest log line.
- **Several replicas:** the code may be in another pod's log. See [Kubernetes](/docs/self-hosting/admin-account#kubernetes).
- **\`USERTASKS_SETUP_CODE\` is set:** the code is that variable's value, and the log doesn't print it. Case, dashes and spaces don't matter.
- **Refused after several wrong tries:** wrong codes are rate-limited per IP address. Wait a few minutes, then try again.

## The CLI says it can't reach UserTasks

\`\`\`text
error: can't reach UserTasks at http://localhost:3000. Is it running?
\`\`\`

The CLI knows the address but nothing answered there (CLI 0.1.3 or later).

- **Start UserTasks** on that machine: \`npm run dev\` (or \`npm run start\` after a build) from the UserTasks folder, or \`docker compose up -d\`. Wait until it's ready, then try again.
- **A different port or host:** pass it with \`--url\`, for example \`usertasks login --url http://localhost:3100\` or \`--url https://tasks.example.com\`.
- **From another machine or a container:** \`localhost\` means the machine the CLI runs on. Use the server's real address.

## The CLI says "No server URL" (older CLIs)

\`\`\`text
No server URL for profile "default". Pass --url <server>, set USERTASKS_URL, or run \`usertasks login --url <server>\`.
\`\`\`

The CLI doesn't know which server to talk to.

- **CLI 0.1.2 or later:** a bare \`usertasks login\` uses http://localhost:3000 when nothing else is set. For a server anywhere else, log in once with its address.
- **Older CLIs** have no default, so always pass \`--url\` (or update with \`npm install -g @user-tasks/cli\`).

\`\`\`bash
usertasks login
usertasks login --url https://tasks.example.com
\`\`\`

The first is for the server on this machine (port 3000), the second for any other host or port.

The address is saved in the profile, so later commands don't need it. For one-off commands, add \`--url <server>\`. In CI, set \`USERTASKS_URL\` (and \`USERTASKS_API_KEY\`). If you use several profiles, check that you're on the right one with \`usertasks profiles list\`. See [Use the CLI with your server](/docs/self-hosting/cli).

"Not logged in to …" means the server is known but there's no credential for it. Run \`usertasks login\` (or \`usertasks login --api-key\`), or set \`USERTASKS_API_KEY\`.

## npm says "ENOENT … package.json"

\`\`\`text
npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '…\\package.json'
\`\`\`

You ran \`npm run …\` outside the UserTasks folder, so npm stops before any UserTasks code runs. \`cd\` into the folder you cloned (the one with \`package.json\`) and run the command again. To check you're in the right place: \`ls package.json\` in bash or zsh, \`Test-Path package.json\` in PowerShell, \`dir package.json\` in cmd.

## "Missing environment variables"

\`\`\`text
Missing environment variables: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
\`\`\`

\`npm run bootstrap\` or \`setup-code\` couldn't find the settings it needs to reach the database. It reads \`.env.local\`, then \`.env\`, from the current folder; variables set in your shell win. The lines under the message say what it found:

- **"Run this from the UserTasks folder (the one with package.json)"**: you're in another folder. \`cd\` into the UserTasks folder.
- **"No .env.local in …"**: create it. Copy \`.env.example\` to \`.env.local\` in that folder and fill in the Supabase URL and service-role key.
- **Not using Supabase?** Set \`DB_PROVIDER=postgres\`, \`DATABASE_URL\` and \`AUTH_PROVIDER=builtin\` instead. With \`DB_PROVIDER=postgres\`, the message names \`DATABASE_URL\`.

Still stuck? Run the script with Node's \`--env-file\` flag, or run the command inside the Docker container, as described in [On Windows](/docs/self-hosting/admin-account#on-windows).

## Docker isn't running

\`npm run setup:local\` and \`npx supabase start\` need Docker:

- **"Docker isn't installed"**: install [Docker Desktop](https://www.docker.com/products/docker-desktop/), restart if it asks, then open a **new** terminal.
- **"Docker is installed but not running"** (or "Cannot connect to the Docker daemon", "error during connect"): open Docker Desktop and wait until it says **Engine running**, then run the command again.
- **Windows:** Docker Desktop needs WSL 2. If it asks to turn it on or update it, say yes; or run \`wsl --install\` (or \`wsl --update\`) in PowerShell opened with **Run as administrator**, then restart.

## The local Supabase won't start

- **Ports in use** ("port is already allocated"): another Supabase project is running. Stop it with \`npx supabase stop\` in that project's folder, or \`docker ps\` to see what's using 54321–54324.
- **Out of memory or disk:** in Docker Desktop, open Settings → Resources and give it at least 4 GB of memory, or free up disk space.
- **"[inbucket] … is no longer supported"**: your checkout is older than the Supabase CLI. Update it (\`git pull\`), or run an older CLI with \`npx supabase@2 start\`.
- **A container stays unhealthy on Windows:** run \`npx supabase stop\`, then \`npx supabase start\` again. If the logging container (vector) is the one failing, \`npx supabase start -x vector\` starts without it.

To start the database from scratch (this deletes everything in it): \`npm run setup:local -- --reset\`.

## Port 3000 is already in use

Run the app on another port, and change the app's address to match:

| You run | Do this |
|---|---|
| \`npm run dev\` / \`npm start\` | \`PORT=3001 npm run dev\` (or \`npm start\`); in PowerShell or cmd, \`npm run dev -- -p 3001\`. Set \`APP_URL\` and \`NEXT_PUBLIC_APP_URL\` to \`http://localhost:3001\` in \`.env.local\` |
| Laptop trial, first time | \`npm run stack -- up --port 3001\` |
| Docker Compose | In \`.env\`, set \`APP_PORT=3001\` and change \`APP_URL\` and \`NEXT_PUBLIC_APP_URL\` to \`http://localhost:3001\`. Then \`docker compose up -d --build\` (add \`--profile standalone\` if you use it). The address is baked into the image, so rebuild |

To see what's using the port: \`lsof -i :3000\` on macOS and Linux, \`netstat -ano | findstr :3000\` on Windows. Often it's an \`npm run dev\` left running in another terminal window: close it.

## Signing in sends me back to the login page

This almost always means the browser didn't keep the sign-in cookie. Check these in order:

1. **The address in the browser doesn't match \`APP_URL\`.** Sign-in redirects go to \`APP_URL\` (or \`NEXT_PUBLIC_APP_URL\`), and cookies belong to one host. If you open \`http://192.168.1.20:3000\` but \`APP_URL\` says \`http://localhost:3000\`, you're bounced between the two.
   - Set \`APP_URL\` and \`NEXT_PUBLIC_APP_URL\` to the exact address people use, including the scheme and port.
   - Moved to a domain name? See [Give your install a friendly address](/docs/self-hosting/friendly-address#8-update-things-that-remember-the-old-address).
   - Restart the app. For Docker, rebuild the image, because the address is a build argument.
2. **\`APP_URL\` is \`https://…\` but you opened the app over \`http://\`.** An https address makes the sign-in cookies Secure, and browsers never store Secure cookies from a plain-http page.
   - Open the app through your HTTPS address.
   - For a trial on plain http, set \`APP_URL\` to the http address. \`AUTH_COOKIE_SECURE=false\` also works, but never use it on a server people really use.
3. **A proxy changes the host.** Your reverse proxy must pass the original \`Host\` header to the app.
4. **Workspace addresses on localhost.** With \`APP_BASE_DOMAIN=localhost\`, sign in on the address you use (for example \`http://acme.localhost:3000\`). Browsers don't share cookies between \`localhost\` and its subdomains.

If the login page says "Invalid email or password", check the **Organisation** field. It takes the workspace slug (for example \`acme-inc\`), not the display name.

## Still stuck

Run \`usertasks-admin doctor\` (\`docker compose exec app node admin.cjs doctor\` in Docker). It checks every provider: database, sign-in, storage, email, the scheduler and more. Then compare your settings with [Environment variables](/docs/self-hosting/environment).
`,
  },
]
