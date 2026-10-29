/**
 * Limits for the document actions (Read / Compare / Convert / PDF tools /
 * Extract / Redact / Inspect). Instance-wide caps come from the environment
 * so self-hosters can raise them; a node can only lower them.
 */

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = typeof process !== 'undefined' ? process.env?.[name] : undefined
  const n = raw === undefined || raw === '' ? NaN : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

const MB = 1024 * 1024

export const DOCUMENT_LIMITS = {
  /** Largest input file (DOCUMENT_MAX_MB, default 25). */
  get maxInputBytes() { return envNumber('DOCUMENT_MAX_MB', 25, 1, 200) * MB },
  /** ZIP containers (DOCX/XLSX/PPTX/ODF): parts, one part unpacked, all parts unpacked. */
  zipMaxEntries: 5000,
  get zipMaxEntryBytes() { return 100 * MB },
  get zipMaxTotalBytes() { return envNumber('DOCUMENT_MAX_UNPACKED_MB', 250, 10, 2000) * MB },
  /** PDF pages read at most (DOCUMENT_MAX_PDF_PAGES, default 500). */
  get maxPdfPages() { return envNumber('DOCUMENT_MAX_PDF_PAGES', 500, 1, 10000) },
  /** Spreadsheet cells read at most across all sheets. */
  maxCells: 2_000_000,
  /** Characters of text kept in an output by default (a node can lower it). */
  defaultMaxChars: 2_000_000,
  /** Inputs to a diff: characters per side (character / word diffs are quadratic-ish). */
  maxDiffChars: 2_000_000,
  maxCharDiffChars: 100_000,
  /** Rows per side for a keyed spreadsheet diff. */
  maxDiffRows: 200_000,
  /** Files in one merge. */
  maxMergeFiles: 50,
  /** Rows one Extract writes into a data table. */
  maxTableRows: 5000,
  /** OCR: pages (DOCUMENT_OCR_MAX_PAGES, default 20) and total time per node. */
  get ocrMaxPages() { return envNumber('DOCUMENT_OCR_MAX_PAGES', 20, 1, 500) },
  get ocrTimeoutMs() { return envNumber('DOCUMENT_OCR_TIMEOUT_SECONDS', 120, 5, 900) * 1000 },
  /** One node's overall budget for parsing (DOCUMENT_TIMEOUT_SECONDS, default 60). */
  get timeoutMs() { return envNumber('DOCUMENT_TIMEOUT_SECONDS', 60, 5, 900) * 1000 },
}

export class DocumentLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentLimitError'
  }
}

/** Reject an input above the instance cap (or a lower per-node cap). */
export function assertInputSize(size: number, name: string, maxBytes = DOCUMENT_LIMITS.maxInputBytes): void {
  if (size > maxBytes) {
    throw new DocumentLimitError(`"${name}" is too large (${(size / MB).toFixed(1)} MB; at most ${Math.round(maxBytes / MB)} MB)`)
  }
}

/** Run `work` with a deadline; rejects with a clear message when it is passed. */
export async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DocumentLimitError(`${what} took longer than ${Math.round(ms / 1000)} s`)), ms)
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
