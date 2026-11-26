import type { ExtensionId } from '@/lib/seo/extensions'

/**
 * The body of the /extensions/infrastructure and /extensions/processing
 * product pages (components/marketing/extension-detail-page.tsx). Name,
 * status, price, summary and structured data come from lib/seo/extensions.ts;
 * this file holds the longer copy: who it's for, how it works, setup, what
 * stays free, security, FAQ and the screenshots (real UI only, captured from
 * a self-hosted install: public/screenshots/extensions/).
 *
 * Rules (owner decisions, 2026-11): paid extensions are for SELF-HOSTED
 * UserTasks (the Enterprise edition: one image, each licence unlocks its
 * extension), never for usertasks.com cloud workspaces; while the status is
 * early access the call to action asks for early access and nothing says it
 * can be bought or downloaded today; prices in USD; no throughput or other
 * numbers we can't cite.
 */

export type DetailId = Extract<ExtensionId, 'infrastructure' | 'processing'>

export type DetailScreenshot = {
  /** File under public/screenshots/extensions/ (the page imports it statically). */
  file: string
  alt: string
  caption: string
}

export type ExtensionDetail = {
  id: DetailId
  /** Eyebrow-length phrase for the hero (who it's for, in a few words). */
  heroAudience: string
  /** The self-hosted statement shown near the top and in the FAQ. */
  selfHosted: string
  /** Who it's for: one line each. */
  who: string[]
  /** How it works: a few steps or parts. */
  howItWorks: Array<{ title: string; body: string }>
  /** Setup, in order. `code` is a command shown under the step. */
  setup: Array<{ title: string; body: string; code?: string }>
  /** What stays free in the open-source core (no licence). */
  free: string[]
  /** Security and licensing. */
  security: Array<{ title: string; body: string }>
  screenshots: DetailScreenshot[]
  /** `earlyAccess`: only while the extension is not available yet (the page drops it after the status flip). */
  faqs: Array<{ question: string; answer: string; earlyAccess?: boolean }>
  docs: Array<{ href: string; label: string }>
  /** Subject for /contact?subject=… (the contact form pre-fills its message with it). */
  contactSubject: string
}

const SELF_HOSTED = 'For self-hosted UserTasks only: it runs in the Enterprise edition on your own servers, on premises or air-gapped. It is not offered for usertasks.com cloud workspaces.'

const ENTERPRISE_STEP = {
  title: 'Install or upgrade to the Enterprise edition',
  body: 'UserTasks Enterprise is one image with every paid extension, each locked until its own licence is installed. Pass your licence to the installer for a new install (first command), or switch an existing install once with usertasks upgrade (second command; its data is kept). Adding another extension later is just another licence: no reinstall.',
}

const LICENCE_STEP = {
  title: 'Add the licence in Settings → Licence',
  body: 'Upload the licence file, or run usertasks-admin licence install <file>. On an air-gapped network, download an activation request (it holds no secrets), carry it to a connected computer and carry the licence file back.',
}

export const EXTENSION_DETAILS: Record<DetailId, ExtensionDetail> = {
  infrastructure: {
    id: 'infrastructure',
    heroAudience: 'For platform and infrastructure teams',
    selfHosted: SELF_HOSTED,
    who: [
      'Teams that must run UserTasks on their approved PostgreSQL, object storage, identity provider, mail service or secret store, not the bundled ones.',
      'Installs that started on the standard stack (a Supabase project, or everything in one Compose project) and now need to move one service at a time, without losing data.',
      'On-premises and air-gapped deployments, where every service is your own and nothing calls home.',
    ],
    howItWorks: [
      { title: 'Pick a service and a provider', body: 'Database, sign-in, files, live updates, background jobs, email, secret store, cache or key management: each moves on its own, from the setup wizard, Settings → Infrastructure or usertasks-admin switch.' },
      { title: 'Test the connection and review the plan', body: 'The target is tested first (reachable, writable, the right version and permissions), and the plan lists every step and every setting it will write. Nothing changes until you type the confirmation.' },
      { title: 'Copy and verify the data', body: 'A backup is taken before anything moves. Database moves copy every table and check row counts and checksums, and an RLS smoke test compares what users see on both sides. File moves copy every object and verify each by SHA-256. Sign-in moves keep password hashes, so people keep their passwords. The original is never deleted.' },
      { title: 'Switch, with a log and a way back', body: 'Every switch, rollback and settings change is recorded with who made it and the settings before and after (secret values are never shown). A switch can be rolled back from the switch log or with usertasks-admin rollback.' },
    ],
    setup: [
      { ...ENTERPRISE_STEP, code: 'curl -fsSL https://usertasks.com/install.sh | sh -s -- --edition enterprise --licence ./infrastructure.licence\nusertasks upgrade --edition enterprise --licence ./infrastructure.licence' },
      LICENCE_STEP,
      { title: 'Install straight onto your own services (optional)', body: 'Choose your own services in the installer (or re-run the service choices later): it writes a separated profile once the licence checks out offline, for your own PostgreSQL, S3-compatible storage, SSO-only sign-in and so on. A re-run that keeps the same services needs no licence. usertasks-admin install profile … --licence does the same for scripted installs.', code: 'usertasks config --licence ./infrastructure.licence' },
      { title: 'Or move services later', body: 'In the setup wizard\'s Services step or Settings → Infrastructure, Change… on a service opens the guided switch: test, plan, apply, follow its progress. The same engine runs from the command line.', code: 'usertasks-admin switch storage --to s3 --dry-run' },
    ],
    free: [
      'The standard stacks: a Supabase project, or the bundled stack (PostgreSQL, built-in sign-in, a files folder or the bundled MinIO, live updates, the worker and the cache, all installed with UserTasks).',
      'Email over SMTP (your relay, Microsoft 365 or Exchange), Resend or log-only, and identity providers (OIDC, SAML, Microsoft Entra ID, AD FS) on built-in sign-in: settings of the stack, changed for free in the setup wizard.',
      'Running any configuration: an install that already runs on separated services keeps running and upgrading without a licence.',
      'Health checks for every service (Settings → Infrastructure, usertasks-admin doctor), the read-only status page and the switch history.',
    ],
    security: [
      { title: 'Checked on the server', body: 'Every change is refused by the server without a valid licence (the pages, the API and usertasks-admin alike), not only hidden in the interface. Only instance administrators can change infrastructure.' },
      { title: 'Licences verified offline', body: 'A licence is a signed file verified against a pinned public key: no call home, so it works air-gapped. It can be bound to your install\'s address or instance id.' },
      { title: 'Running never depends on the licence', body: 'An expired or removed licence stops changes 24 hours after expiry. The services you already moved keep running, and core never asks the add-on to run them.' },
      { title: 'Secrets stay secret', body: 'Passwords and keys you type are stored encrypted and never shown again; the switch log records which settings changed, never their values.' },
    ],
    screenshots: [
      { file: 'infrastructure-setup-wizard.webp', alt: 'The setup wizard Services step: every service with its provider, a health badge, Settings and Change… buttons', caption: 'The setup wizard: each service, its health, and Change… to move it.' },
      { file: 'infrastructure-storage-plan.webp', alt: 'Change storage provider dialog: connection checks passed and a four-step plan to copy files from a local folder to S3-compatible storage', caption: 'Moving files from a local folder to S3-compatible storage (MinIO): tested, then planned step by step.' },
      { file: 'infrastructure-database-switch.webp', alt: 'Change database provider dialog showing a succeeded switch: migrations applied, tables copied, row counts and checksums verified, RLS smoke test passed', caption: 'A database move to another PostgreSQL server, copied and verified, with the environment to set.' },
      { file: 'infrastructure-switch-log.webp', alt: 'The switch log listing a storage switch, a database switch and a rollback, each with who made it and a Rollback button', caption: 'The switch log: every change, who made it, and Rollback.' },
    ],
    faqs: [
      { question: 'Can I buy the Infrastructure add-on today?', answer: 'Not yet. It is in early access while the Enterprise edition is prepared for release. Request early access and tell us about your deployment; we will be in touch.', earlyAccess: true },
      { question: 'Is it available for usertasks.com cloud workspaces?', answer: 'No. Paid extensions are for self-hosted UserTasks: the Infrastructure add-on runs in the Enterprise edition on your own servers, on premises or air-gapped.' },
      { question: 'What stays free?', answer: 'The standard stacks (a Supabase project, or the bundled PostgreSQL stack), email over SMTP or Resend, identity providers on built-in sign-in, the health checks and status page, and running any configuration you already have. The add-on is for changing where services run.' },
      { question: 'What happens if the licence expires?', answer: 'Changes stop 24 hours after the licence expires. Everything you already moved keeps running and keeps upgrading; renew the licence to change providers again.' },
      { question: 'Can I undo a move?', answer: 'Yes. Every switch takes a backup first and can be rolled back from the switch log or with usertasks-admin rollback. The original data is never deleted. Writes made after a database move are not copied back, so plan a database move for a quiet moment.' },
      { question: 'Does it work air-gapped?', answer: 'Yes. The licence is verified offline against a pinned public key, the installers check it without a network, and every target can be on your own network.' },
      { question: 'How much does it cost?', answer: '$9,000 USD per deployment per year.' },
    ],
    docs: [
      { href: '/docs/self-hosting/infrastructure-add-on', label: 'Infrastructure add-on (docs)' },
      { href: '/docs/self-hosting/switching-providers', label: 'Switching providers (docs)' },
      { href: '/docs/self-hosting/licensing', label: 'Licences for paid extensions (docs)' },
    ],
    contactSubject: 'Infrastructure add-on: early access',
  },
  processing: {
    id: 'processing',
    heroAudience: 'For busy and heavy workloads',
    selfHosted: SELF_HOSTED,
    who: [
      'Installs with a high volume of workflow runs, where queued work should not compete with people using the web app.',
      'Long-running agent jobs and media work (transcription, redaction, conversion) that need their own processes and memory.',
      'Teams that want to scale processing separately: more workers on their own machines or Kubernetes nodes, inside their own deployment.',
    ],
    howItWorks: [
      { title: 'The web app queues, workers process', body: 'With the add-on licensed and set to workers, the web app only queues work. Separate processor processes (the same Enterprise image, started as workers) claim and run workflow runs, agent jobs and media jobs.' },
      { title: 'A continuous processor', body: 'Workers keep processing as work arrives, woken as soon as it is queued, instead of waiting for the next scheduler tick.' },
      { title: 'Backpressure and graceful drain', body: 'Each worker takes only what fits its memory budget. On a deploy or scale-down it stops claiming, finishes what it holds and exits.' },
      { title: 'Health and metrics', body: 'Worker health and queue depth show in Settings → Infrastructure → Processing, and each worker exposes health checks and Prometheus metrics for your monitoring and autoscaling (Kubernetes HPA or KEDA).' },
      { title: 'Designer test runs on workers', body: 'Test runs from the designer stay in the web app by default; turn on test runs on workers to run them where production work runs.' },
    ],
    setup: [
      { ...ENTERPRISE_STEP, code: 'curl -fsSL https://usertasks.com/install.sh | sh -s -- --edition enterprise --licence ./processing.licence\nusertasks upgrade --edition enterprise --licence ./processing.licence' },
      LICENCE_STEP,
      { title: 'Start workers and switch the mode', body: 'Run processor workers next to the app (Docker Compose or Kubernetes, on the same or other machines of your deployment), then set processing to workers in Settings → Infrastructure → Processing. Without a valid licence the web app simply processes again itself.' },
    ],
    free: [
      'Processing in the web app: every workflow, agent and media job runs without the add-on.',
      'Reliability in every mode: leases and stuck-job recovery (a job whose worker crashed or ran out of memory is put back and retried), and checkpoints, so a recovered run continues after its last completed step.',
      'Retry, cancel and force-cancel of stuck jobs, and the queue health shown in Settings → Infrastructure → Processing.',
    ],
    security: [
      { title: 'Checked on the server', body: 'The workers and the mode switch run only with a valid licence for the add-on. Without one, the web app processes the queue again: nothing stops.' },
      { title: 'Licences verified offline', body: 'A licence is a signed file verified against a pinned public key: no call home, so workers run air-gapped.' },
      { title: 'Your machines, your network', body: 'Workers are part of your self-hosted deployment and reach the same database the app uses. No work or data leaves your network.' },
    ],
    screenshots: [
      { file: 'processing-settings-card.webp', alt: 'Settings → Infrastructure → Processing card: processing in the web app, queue counts (waiting, processing, stuck, retrying or failed) and the Processing add-on', caption: 'Settings → Infrastructure → Processing: where work runs, and the queue at a glance.' },
    ],
    faqs: [
      { question: 'Can I buy the Processing add-on today?', answer: 'Not yet. It is in early access while the Enterprise edition is prepared for release. Request early access and tell us about your workload; we will be in touch.', earlyAccess: true },
      { question: 'Is it available for usertasks.com cloud workspaces?', answer: 'No. Paid extensions are for self-hosted UserTasks: the Processing add-on runs in the Enterprise edition on your own servers.' },
      { question: 'What stays free?', answer: 'Processing in the web app, and the reliability features in every mode: leases, stuck-job recovery, checkpoints and the stuck-job controls. The add-on moves processing to separate workers.' },
      { question: 'What happens if the licence expires?', answer: 'The web app processes the queue again by itself, 24 hours after the licence expires. Queued work is not lost.' },
      { question: 'Where do the workers run?', answer: 'Inside your self-hosted deployment: next to the app or on other machines or Kubernetes nodes, with access to the same database.' },
      { question: 'How much does it cost?', answer: '$2,500 USD per deployment per year.' },
    ],
    docs: [
      { href: '/docs/self-hosting/infrastructure', label: 'Processing tier and reliability (docs)' },
      { href: '/docs/self-hosting/licensing', label: 'Licences for paid extensions (docs)' },
    ],
    contactSubject: 'Processing add-on: early access',
  },
}

export function extensionDetail(id: DetailId): ExtensionDetail {
  return EXTENSION_DETAILS[id]
}

/** The FAQ for the extension's status: the early-access answers only until it is available. */
export function detailFaqs(detail: ExtensionDetail, available: boolean): Array<{ question: string; answer: string }> {
  return detail.faqs.filter((faq) => !available || !faq.earlyAccess).map(({ question, answer }) => ({ question, answer }))
}
