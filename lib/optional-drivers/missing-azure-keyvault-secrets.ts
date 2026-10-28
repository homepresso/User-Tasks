// Bundled in place of @azure/keyvault-secrets when it is not installed at build time (see
// next.config.ts). Importing it fails like a missing module, which the email /
// secrets providers turn into an "install the optional package" error.
throw Object.assign(new Error("Cannot find module '@azure/keyvault-secrets'"), { code: "MODULE_NOT_FOUND" })

export {}
