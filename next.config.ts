import { existsSync } from "fs";
import path from "path";
import type { NextConfig } from "next";
import { contentSecurityPolicy as currentContentSecurityPolicy } from "./lib/csp";
import { LEGACY_DOC_REDIRECTS } from "./lib/docs/redirects";
import { OUTPUT_FILE_TRACING_INCLUDES, TESSERACT_WORKER_FILES } from "./lib/function-tracing";
import { missingStubPath, optionalPackageNames } from "./lib/optional-drivers";
import { USE_CASE_REDIRECTS } from "./lib/use-cases";
import { TASK_QUEUE_REDIRECT } from "./lib/tasks/unified-list";

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
// email, secrets and KMS provider SDKs; the SAML library; tesseract.js for OCR) are listed in
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
// The Docker image's server bundle (NEXT_OUTPUT_STANDALONE=true).
const STANDALONE = process.env.NEXT_OUTPUT_STANDALONE === "true";
const OPTIONAL_EXTERNALS =[...optionalPackageNames("storage"), ...optionalPackageNames("provider"), ...optionalPackageNames("document")].filter(isInstalled);

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (see Dockerfile). Opt-in
  // so `next start` and Vercel builds keep the default output.
  output: STANDALONE ? "standalone" : undefined,
  // Vercel's build machine (2 cores, 8 GB) runs out of memory when `next build`
  // also type-checks this codebase. CI and the release gates run
  // `tsc --noEmit` before every deploy, so the hosted build skips the
  // duplicate check. Set NEXT_BUILD_TYPECHECK=true to force it. The Docker
  // build type-checks before removing the optional packages it leaves out,
  // then builds with NEXT_BUILD_TYPECHECK=false.
  typescript: {
    ignoreBuildErrors: process.env.NEXT_BUILD_TYPECHECK === "false"
      || (Boolean(process.env.VERCEL) && process.env.NEXT_BUILD_TYPECHECK !== "true"),
  },
  poweredByHeader: false,
  // A browser tab left open across a deploy otherwise calls Server Actions
  // that no longer exist ("Server Action … was not found on the server").
  // With a deployment id, Next sees the mismatch and reloads the page instead.
  // Prebuilt Vercel deploys get a fresh id per build; NEXT_DEPLOYMENT_ID wins.
  deploymentId: process.env.NEXT_DEPLOYMENT_ID || (process.env.VERCEL ? `ut-${Date.now().toString(36)}` : undefined),
  experimental: {
    // Fewer static-generation workers on Vercel keeps peak memory in bounds.
    ...(process.env.VERCEL ? { cpus: 1 } : {}),
    serverActions: {
      // Was 1gb — a DoS amplifier. Document uploads cap well below this; raise
      // deliberately if a real payload exceeds it.
      bodySizeLimit: "50mb",
    },
    // proxy.ts buffers request bodies for the route handlers behind it and
    // silently cuts them at this size (Next's default is 10 MB). Form
    // attachments go straight to storage when the provider signs uploads;
    // the streamed path (local-disk storage) takes bodies up to
    // FORM_UPLOAD_MAX_BODY_MB (default 50, read at build time; Vercel caps
    // function bodies at ~4.5 MB whatever this says). The upload route
    // refuses a body shorter than the size the browser declared.
    proxyClientMaxBodySize: `${Math.max(1, Math.min(Number(process.env.FORM_UPLOAD_MAX_BODY_MB) || 50, 1024))}mb`,
  },
  // The project directory is the root. Without it Turbopack infers the root
  // from the outermost lockfile, so a checkout nested inside another (a git
  // worktree) traces the outer checkout's node_modules.
  turbopack: { root: process.cwd(), resolveAlias: missingDriverAliases },
  // Workspace package shipped as TypeScript source (the postgres db provider).
  transpilePackages: ["@usertasks/pg-query"],
  // The QuickJS sandbox embeds its WebAssembly binary in a JS string; when the
  // production build minifies it, the string becomes a template literal with
  // octal escapes that Node refuses to parse ("Failed to load chunk"). Load
  // both packages from node_modules untouched.
  serverExternalPackages: ["pg", "mssql", "ssh2", "bcryptjs", "@azure/identity", "exceljs", "quickjs-emscripten-core", "@jitl/quickjs-singlefile-cjs-release-sync", ...OPTIONAL_EXTERNALS],
  // Prebuilt Vercel deploys are built on macOS; the darwin sharp/libvips
  // binaries (~15 MB) cannot run on Vercel's Linux functions and push every
  // function towards the 250 MB limit.
  outputFileTracingExcludes: process.env.VERCEL
    ? { "/*": ["node_modules/@img/sharp-darwin-*/**/*", "node_modules/@img/sharp-libvips-darwin-*/**/*"] }
    : undefined,
  // Files read at runtime through paths the tracer is told to ignore (see
  // lib/function-tracing.ts). Everything else a route needs is traced from
  // its imports; `npm run check:function-size` verifies both.
  outputFileTracingIncludes: STANDALONE && isInstalled("tesseract.js-core")
    ? { ...OUTPUT_FILE_TRACING_INCLUDES, "/**": [...OUTPUT_FILE_TRACING_INCLUDES["/**"], ...TESSERACT_WORKER_FILES] }
    : OUTPUT_FILE_TRACING_INCLUDES,
  async redirects() {
    return [
      // Apps (formerly Projects) were retired; send old links to automations.
      { source: "/apps", destination: "/automations", permanent: true },
      { source: "/apps/:path*", destination: "/automations", permanent: true },
      { source: "/projects", destination: "/automations", permanent: true },
      { source: "/projects/:path*", destination: "/automations", permanent: true },
      // The old dashboard URL lands on Home (/home), the post-login landing page.
      { source: "/dashboard", destination: "/home", permanent: true },
      // The Task queue page was folded into My tasks (status Queued).
      TASK_QUEUE_REDIRECT,
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
      // Custom form control frames (app/form-controls/frame) set their own
      // CSP (sandboxed, framed by the app only): no DENY framing, no app CSP.
      {
        source: "/((?!form-controls/frame/|f/|form/|form-login|p/).*)",
        headers: securityHeaders,
      },
      // Form link pages other sites may embed (lib/forms/embed.ts): no
      // X-Frame-Options; proxy.ts sets their CSP with `frame-ancestors *`.
      ...["/f/:path*", "/form/:path*", "/p/:path*", "/form-login"].map((source) => ({
        source,
        headers: securityHeaders.filter((h) => h.key !== "X-Frame-Options"),
      })),
      {
        source: "/form-controls/frame/:path*",
        headers: securityHeaders.filter((h) => h.key !== "Content-Security-Policy" && h.key !== "X-Frame-Options"),
      },
    ];
  },
};

export default nextConfig;
