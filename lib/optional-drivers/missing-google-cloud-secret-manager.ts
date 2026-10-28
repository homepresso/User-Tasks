// Bundled in place of @google-cloud/secret-manager when it is not installed at build time (see
// next.config.ts). Importing it fails like a missing module, which the email /
// secrets providers turn into an "install the optional package" error.
throw Object.assign(new Error("Cannot find module '@google-cloud/secret-manager'"), { code: "MODULE_NOT_FOUND" })

export {}
