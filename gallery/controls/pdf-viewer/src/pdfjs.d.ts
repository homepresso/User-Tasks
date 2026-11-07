// The minified pdf.js builds ship without their own declarations; they are the same API as the package root.
declare module 'pdfjs-dist/build/pdf.min.mjs' {
  export * from 'pdfjs-dist'
}
declare module 'pdfjs-dist/build/pdf.worker.min.mjs' {
  export const WorkerMessageHandler: unknown
}
