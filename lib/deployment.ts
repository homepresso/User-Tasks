import { notFound } from 'next/navigation'
import { configuredAppUrl, getBootstrapConfig } from '@/lib/config/bootstrap'

/**
 * Deployment mode. `cloud` is the hosted usertasks.com edition (marketing
 * site, SEO pages, contact form, self-signup). `self_hosted` is the
 * open-source default: those public surfaces are disabled and `/` goes
 * straight to the app.
 *
 * Read at request time on dynamic routes and at build time on statically
 * prerendered ones (robots, sitemap, marketing pages), so set
 * DEPLOYMENT_MODE in the build environment as well as at runtime.
 */
export type DeploymentMode = 'cloud' | 'self_hosted'

const CLOUD_BASE_URL = 'https://usertasks.com'
const SELF_HOSTED_BASE_URL = 'http://localhost:3000'

export function getDeploymentMode(): DeploymentMode {
  return getBootstrapConfig().deploymentMode
}

export function isCloud(): boolean {
  return getDeploymentMode() === 'cloud'
}

/** 404s the current route unless this is the cloud edition. */
export function assertCloudRoute(): void {
  if (!isCloud()) notFound()
}

/** Canonical public origin, without a trailing slash. */
export function publicBaseUrl(): string {
  const configured = configuredAppUrl()?.trim().replace(/\/+$/, '')
  if (configured) return configured
  return isCloud() ? CLOUD_BASE_URL : SELF_HOSTED_BASE_URL
}

/**
 * Primary call to action on public docs pages. Sign-in on every edition for
 * now (the cloud landing page has no signup section); kept as a helper so the
 * cloud CTA can change in one place.
 */
export function publicCta(): { href: string; label: string } {
  return { href: '/login', label: 'Sign in' }
}
