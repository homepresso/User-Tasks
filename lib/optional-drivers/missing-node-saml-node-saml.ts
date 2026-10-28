// Bundled in place of @node-saml/node-saml when it is not installed at build
// time (see next.config.ts). Importing it fails like a missing module, which
// the SAML auth provider turns into an "install the optional package" error.
throw Object.assign(new Error("Cannot find module '@node-saml/node-saml'"), { code: "MODULE_NOT_FOUND" })

export {}
