// The error rule for an interaction status, the same as the report's Errors metric (ScenarioMetrics.kt).

const ERROR_WORDS = /\b(error|errors|fail|failed|failure|fault|timeout|timed out|exception|rejected|denied)\b/i
const LEADING_CODE = /^\s*(\d{3})\b/

/** An HTTP-style code 400 to 599 (`503`, `404 Not Found`), or with no leading code a word such as `error`. */
export function isErrorStatus(status: string): boolean {
  const code = LEADING_CODE.exec(status)?.[1]
  if (code != null) return Number(code) >= 400 && Number(code) <= 599
  return ERROR_WORDS.test(status)
}
