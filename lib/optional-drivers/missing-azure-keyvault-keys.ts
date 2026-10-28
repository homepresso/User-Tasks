// Bundled in place of @azure/keyvault-keys when it is not installed at build time (see
// next.config.ts). Importing it fails like a missing module, which the KMS
// provider turns into an "install the optional package" error.
throw Object.assign(new Error("Cannot find module '@azure/keyvault-keys'"), { code: "MODULE_NOT_FOUND" })

export {}
