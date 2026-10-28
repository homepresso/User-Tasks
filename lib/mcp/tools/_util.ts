/** Shared helpers for the MCP tool modules. */

/** The error's message, or `fallback` for non-Error throws and empty messages. */
export const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message) || fallback
