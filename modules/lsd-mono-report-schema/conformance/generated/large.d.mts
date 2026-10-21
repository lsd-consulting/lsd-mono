// Types for large.mjs. The report is plain data; a consumer with its own report type casts it.
export function largeReport(size?: { participants?: number; messages?: number }): Record<string, unknown>
