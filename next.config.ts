import { existsSync } from "fs";
import path from "path";
import type { NextConfig } from "next";
import { contentSecurityPolicy as currentContentSecurityPolicy } from "./lib/csp";
import { LEGACY_DOC_REDIRECTS } from "./lib/docs/redirects";
import { missingStubPath, optionalPackageNames } from "./lib/optional-drivers";
import { USE_CASE_REDIRECTS } from "./lib/use-cases";

// Defense-in-depth headers (see lib/csp.ts for the policy and why). The CSP
// here is evaluated when the server starts / the build runs; proxy.ts
// replaces it per request from the runtime config on every proxied path.
const contentSecurityPolicy = currentContentSecurityPolicy();

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

// The optionalDependencies (Snowflake, Oracle and MongoDB drivers; storage,
// email, secrets and KMS provider SDKs; the SAML library) are listed in
// lib/optional-drivers. When one is not installed, alias it to a stub that
// fails like a missing module so the build still succeeds and the feature
// reports how to install it. The choice is made here, at build time: adding a
// package later needs a rebuild. Installed database drivers resolve normally
// (and are traced into the standalone output); installed provider SDKs stay
// external to the server bundle.
const isInstalled = (pkg: string) => existsSync(path.join(process.cwd(), "node_modules", pkg, "package.json"));
const missingDriverAliases = Object.fromEntries(
  optionalPackageNames().filter((pkg) => !isInstalled(pkg)).map((pkg) => [pkg, missingStubPath(pkg)]),
);
const OPTIONAL_EXTERNALS = [...optionalPackageNames("storage"), ...optionalPackageNames("provider")].filter(isInstalled);

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (see Dockerfile). Opt-in
  // so `next start` and Vercel builds keep the default output.
  output: process.env.NEXT_OUTPUT_STANDALONE === "true" ? "standalone" : undefined,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Was 1gb — a DoS amplifier. Document uploads cap well below this; raise
      // deliberately if a real payload exceeds it.
      bodySizeLimit: "50mb",
    },
  },
  turbopack: { resolveAlias: missingDriverAliases },
  // Workspace package shipped as TypeScript source (the postgres db provider).
  transpilePackages: ["@usertasks/pg-query"],
  serverExternalPackages: ["pg", "mssql", "bcryptjs", "@azure/identity", "exceljs", ...OPTIONAL_EXTERNALS],
  async redirects() {
    return [
      // Apps (formerly Projects) were retired; send old links to automations.
      { source: "/apps", destination: "/automations", permanent: true },
      { source: "/apps/:path*", destination: "/automations", permanent: true },
      { source: "/projects", destination: "/automations", permanent: true },
      { source: "/projects/:path*", destination: "/automations", permanent: true },
      // The home dashboard was retired; tasks is the post-login landing page.
      { source: "/dashboard", destination: "/tasks", permanent: true },
      // Forms, pages and the templates hub were retired; email templates moved
      // to /automations/email-templates.
      { source: "/templates", destination: "/automations", permanent: true },
      { source: "/templates/:path*", destination: "/automations", permanent: true },
      { source: "/pages", destination: "/automations", permanent: true },
      { source: "/pages/:path*", destination: "/automations", permanent: true },
      // API keys and webhooks live under settings (behind its permission gate).
      { source: "/api-keys", destination: "/settings/api-keys", permanent: true },
      { source: "/webhooks", destination: "/settings/webhooks", permanent: true },
      // The theme designer is /settings/theme (early links said brand-theme).
      { source: "/settings/brand-theme", destination: "/settings/theme", permanent: true },
      // The K2 and Nintex SEO pages became migration guides under /use-cases.
      ...Object.entries(USE_CASE_REDIRECTS).map(([source, destination]) => ({ source, destination, permanent: true })),
      // Docs pages that moved when /docs was restructured.
      ...Object.entries(LEGACY_DOC_REDIRECTS).map(([slug, destination]) => ({ source: `/docs/${slug}`, destination, permanent: true })),
    ]
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
