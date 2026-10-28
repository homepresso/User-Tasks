/**
 * resumeWorkflow found no run in a resumable state: it never existed, was
 * already resumed (e.g. a double submit) or was cancelled.
 */
export class RunNotResumableError extends Error {
  constructor() {
    super("Run not found or not in waiting/paused state")
    this.name = "RunNotResumableError"
  }
}
