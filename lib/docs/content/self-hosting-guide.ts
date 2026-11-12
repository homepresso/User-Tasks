import type { DocPageDef } from '../types'
import { DOCKER_BUILD_MEMORY_GB } from '../../docker-build-memory'

/**
 * The self-hosting guide: a beginner's quick start (npm run setup:local), how to choose, install, set up (the first-run
 * /setup screen and its setup code), invite people, use the CLI, update,
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
| Laptop trial | Docker (Docker Desktop, or Docker Engine with the Compose plugin) with about ${DOCKER_BUILD_MEMORY_GB} GB of memory ([below](#memory-for-the-docker-build)), git, and Node.js 22 LTS (20.9 or later works) to run the \`npm run stack\` helper |
| From source (\`npm run dev\`, \`npm start\`) | Node.js 22 LTS, which the Docker image also uses, and npm. Node.js 20.9 or later still works (npm prints an \`EBADENGINE\` warning for one package, and Node.js 20 is past its end of life). Plus a database: a Supabase project, a local Supabase (Docker and the Supabase CLI, \`npx supabase\`), or PostgreSQL 15+ |
| Docker Compose | Docker Engine with Compose v2.20 or later (the \`docker compose\` command) |
| Kubernetes | Kubernetes 1.27 or later and Helm 3 |
| Air-gapped bundle | On the offline host: a shell, \`sha256sum\`, OpenSSL 3 and Docker with the Compose plugin. No Node.js. For Kubernetes, also \`helm\` and a container registry the cluster can pull from |
| The CLI | Node.js 20 or later (22 LTS recommended) on the machine where you run \`usertasks\` |

**Database:** PostgreSQL 15 or later with the \`pg_trgm\` extension. Supabase includes it.

## Memory for the Docker build

The laptop trial (\`npm run stack -- up\`), \`docker compose up --build\` and \`docker build\` compile UserTasks inside Docker. That needs about **${DOCKER_BUILD_MEMORY_GB} GB of memory for Docker**, and the first build takes 10 to 20 minutes. Below that, the build stops with \`Killed\` or \`cannot allocate memory\`.

- **Docker Desktop (macOS, Windows):** Settings → Resources → Memory → ${DOCKER_BUILD_MEMORY_GB} GB or more → Apply & restart. On Windows with WSL 2, the limit is \`memory=\` in \`%UserProfile%\\.wslconfig\`.
- Other containers running at the same time (a local Supabase, for example) use some of that memory too.
- \`npm run stack -- up\` checks Docker's memory before it builds and stops with these steps when there isn't enough (\`--skip-memory-check\` builds anyway).
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

In production, serve the app over HTTPS behind a reverse proxy (nginx, Caddy, Traefik, a cloud load balancer or a Kubernetes ingress). The proxy must pass the original \`Host\` header through. The [file upload limits](/docs/self-hosting#file-uploads-and-request-size-limits) list the body size each proxy needs.

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
2. Builds the app image. The first build takes a few minutes.
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

## Docker Compose

\`docker-compose.yml\` has two profiles. The profile decides which containers start. \`.env\` decides which services the app uses. The app's Compose service is called \`app\`. See [Deployment profiles](/docs/self-hosting/deployment-profiles) for every option.

### With a Supabase project (default)

Only the app runs in Docker. The database, sign-in, files and live updates are in your Supabase project, hosted or self-hosted.

1. Apply the database migrations to your project:

   \`\`\`bash
   git clone <repository-url> usertasks && cd usertasks
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
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
- Put an HTTPS reverse proxy in front of port 3000.

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

Open the app and [create your admin account](/docs/self-hosting/admin-account).
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

Workspace roles don't include the server's own settings. To let someone open **Settings → Infrastructure** (provider status, health checks and provider switches), add them as an instance admin:

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
| Source with Supabase | \`git pull\`, \`npm ci\`, \`npx supabase db push\` (or \`npx supabase db reset\` on a local stack, which wipes it), \`npm run build\`, then restart \`npm start\` |
| Source with your own PostgreSQL | \`git pull\`, \`npm ci\`, \`npm run admin -- db migrate\`, \`npm run build\`, then restart \`npm start\` |
| Docker Compose, \`supabase\` profile | \`git pull\`, \`npx supabase db push\`, then \`docker compose up -d --build\` |
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

\`npm run stack -- up\` or \`docker compose up --build\` stops during \`Creating an optimized production build\` with \`Killed\`, \`ResourceExhausted\` or \`cannot allocate memory\`, then \`docker up -d --wait… exited with 1\`.

Docker ran out of memory while compiling UserTasks. The build needs about ${DOCKER_BUILD_MEMORY_GB} GB of memory for Docker:

1. In Docker Desktop: **Settings → Resources → Memory**, set it to ${DOCKER_BUILD_MEMORY_GB} GB or more, then **Apply & restart**. (Windows with WSL 2: set \`memory=\` in \`%UserProfile%\\.wslconfig\`, then run \`wsl --shutdown\`.)
2. Stop other containers you don't need while it builds; a local Supabase, for example, uses 2 to 4 GB.
3. Run the same command again. Packages already downloaded are reused.

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
