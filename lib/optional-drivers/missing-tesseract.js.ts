// Bundled in place of tesseract.js when it is not installed at build time (see
// next.config.ts). Importing it fails like a missing module, which
// lib/documents/ocr turns into an "install the optional package" error.
throw Object.assign(new Error("Cannot find module 'tesseract.js'"), { code: "MODULE_NOT_FOUND" })

export {}
