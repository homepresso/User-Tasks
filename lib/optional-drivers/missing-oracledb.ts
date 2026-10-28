// Bundled in place of oracledb when it is not installed at build time (see
// next.config.ts). Importing it fails like a missing module, which
// lib/db-connector turns into an "install the optional package" error.
throw Object.assign(new Error("Cannot find module 'oracledb'"), { code: "MODULE_NOT_FOUND" })

export {}
