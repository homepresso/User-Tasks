import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Design-system guardrails (docs/design/foundations.md), warn-only until
// workstreams B–F have migrated their directories; the final cleanup promotes
// them to errors.
const CLASS_SOURCES = [
  "JSXAttribute[name.name='className']",
  "CallExpression[callee.name=/^(cn|clsx|cva)$/]",
];
const ARBITRARY_TEXT_SIZE = /text-\[[0-9.]+(px|rem)\]/.source;
const arbitraryTextSize = CLASS_SOURCES.flatMap((src) => [
  { selector: `${src} Literal[value=/${ARBITRARY_TEXT_SIZE}/]`, message: "Arbitrary text sizes break the type scale: use text-2xs (11px floor), text-xs, text-ui (13px), text-sm, text-base, text-lg, text-title or text-metric." },
  { selector: `${src} TemplateElement[value.raw=/${ARBITRARY_TEXT_SIZE}/]`, message: "Arbitrary text sizes break the type scale: use text-2xs (11px floor), text-xs, text-ui (13px), text-sm, text-base, text-lg, text-title or text-metric." },
]);
const HEX = /#[0-9a-fA-F]{6}\b/.source;
const HEX_MESSAGE = "Raw hex colours bypass the workspace theme: use the semantic utilities (bg-panel, text-fg-muted, border-border, text-danger …) or a --theme-* / --ds-* variable.";
const rawHex = [
  ...CLASS_SOURCES.flatMap((src) => [
    { selector: `${src} Literal[value=/${HEX}/]`, message: HEX_MESSAGE },
    { selector: `${src} TemplateElement[value.raw=/${HEX}/]`, message: HEX_MESSAGE },
  ]),
  { selector: `JSXAttribute[name.name='style'] Literal[value=/${HEX}/]`, message: HEX_MESSAGE },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/**/*.tsx", "components/**/*.tsx"],
    rules: { "no-restricted-syntax": ["warn", ...arbitraryTextSize, ...rawHex] },
  },
  {
    // Marketing and gallery pages carry their own brand palette (the hex rule waits for their token block).
    files: ["components/marketing/**/*.tsx", "components/gallery/**/*.tsx", "app/(marketing)/**/*.tsx", "app/docs/**/*.tsx"],
    rules: { "no-restricted-syntax": ["warn", ...arbitraryTextSize] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Built package output (npm workspaces).
    "packages/*/dist/**",
    // Gallery form controls: bundled modules and their own npm project.
    "gallery/controls/*/dist/**",
    "gallery/controls/node_modules/**",
  ]),
]);

export default eslintConfig;
