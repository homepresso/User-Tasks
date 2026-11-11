import { PUBLIC_PAGES } from '@/lib/seo/public-pages'

/**
 * Signed-in app, API, auth and form-runtime routes: never crawled by anyone.
 * Public marketing pages, the docs, the gallery and /llms.txt are open.
 */
export const PRIVATE_PATHS = ['/api/', '/settings', '/reports', '/tasks', '/automations', '/agents', '/packages', '/data', '/integrations', '/extensibility', '/team', '/activity', '/oauth', '/invite', '/login', '/signup', '/forgot-password', '/reset-password', '/check-email', '/onboarding', '/home', '/p/', '/f/', '/form/', '/form-login', '/files/', '/attachments/', '/scim/', '/auth/', '/ws/']

/**
 * AI search and assistant crawlers we want to read the public site, so that
 * ChatGPT, Claude, Perplexity, Gemini, Copilot and Apple Intelligence can
 * find and cite it. Training crawlers are included on purpose: UserTasks is
 * open source and its public docs are meant to be learned from. That includes
 * CCBot (Common Crawl), whose open corpus many models and research tools use.
 */
export const AI_CRAWLERS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-User', 'Claude-SearchBot',
  'PerplexityBot', 'Perplexity-User',
  'Google-Extended', 'Applebot-Extended', 'Applebot',
  'Bingbot', 'CCBot',
]

/**
 * Public pages, allowed explicitly: robots rules match by prefix and the
 * longest match wins, so `/tasks-and-approvals` and `/data-and-reports` need
 * an allow that outranks the `/tasks` and `/data` disallows.
 */
export function publicAllowList(): string[] {
  return ['/', ...PUBLIC_PAGES.map((page) => page.path), '/use-cases/', '/gallery/', '/docs/', '/llms.txt', '/llms-full.txt']
}

