// ESLint flat config for the report UI (#30). `npm run lint` runs it; Gradle's reportLint
// task runs it on `check`. Formatting is Prettier's job, so eslint-config-prettier turns
// off the stylistic rules that would fight it.
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import lsd from './lint/eslint-plugin-lsd.js'

/**
 * Hand-rolled HTML escaping, which only src/lib/escape.ts may do: escaping entities
 * (`&lt;`, `&#39;`, or `&#` built up by hand) and replacing a markup character or a
 * class of them (`.replace(/[<>&]/g, ...)`, `.replaceAll('<', ...)`).
 */
const ENTITY = '/&(lt|gt|amp|quot|apos|#0*39|#x0*27);|^&#x?$/'
const MARKUP_CHARS = `/^(\\[[<>&"'\\\\]+\\]|[<>&"'])$/`
const ESCAPING = 'Hand-rolled HTML escaping. Use escapeHtml or escapeAttr from src/lib/escape.ts.'
const handRolledEscaping = [
  { selector: `Literal[value=${ENTITY}]`, message: ESCAPING },
  { selector: `TemplateElement[value.raw=${ENTITY}]`, message: ESCAPING },
  {
    selector: `CallExpression[callee.property.name=/^replace(All)?$/][arguments.0.regex.pattern=${MARKUP_CHARS}]`,
    message: ESCAPING,
  },
  {
    selector: `CallExpression[callee.property.name=/^replace(All)?$/][arguments.0.value=${MARKUP_CHARS}]`,
    message: ESCAPING,
  },
]

const SLEEP = 'No fixed sleeps in check:ux: use expect.poll, frames or expectStable (checks/ux-helpers.ts).'

export default defineConfig(
  { ignores: ['dist/', 'coverage/', 'test-results/', 'playwright-report/', 'node_modules/'] },
  // A disable comment that no longer silences anything fails lint instead of lingering (#110).
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: './tsconfig.test.json', tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser },
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/**/*.test-util.ts'],
    plugins: { lsd },
    rules: {
      'lsd/escaped-markup': 'error',
      'no-restricted-syntax': ['error', ...handRolledEscaping],
    },
  },
  {
    files: ['src/lib/escape.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['*.config.ts', 'checks/**/*.ts', 'src/**/*.test.ts', 'src/**/*.test-util.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // check:ux runs in parallel: a fixed sleep races what it waits for or proves nothing (#110).
    // Wait with expect.poll, frames or expectStable (checks/ux-helpers.ts). Any mention of
    // waitForTimeout (a call, page['waitForTimeout'], a destructured or aliased one) and any
    // setTimeout or setInterval (in Node or inside page.evaluate) is rejected. A sleep that is the
    // thing being tested (a long press) takes an eslint-disable comment whose `-- reason` says so.
    files: ['checks/**/*.ts'],
    plugins: { lsd },
    rules: {
      'lsd/disable-reason': 'error',
      'no-restricted-syntax': [
        'error',
        { selector: "Identifier[name='waitForTimeout']", message: SLEEP },
        { selector: "Literal[value='waitForTimeout']", message: SLEEP },
        { selector: "TemplateElement[value.cooked='waitForTimeout']", message: SLEEP },
        { selector: 'Identifier[name=/^set(Timeout|Interval)$/]', message: SLEEP },
        { selector: 'Literal[value=/^set(Timeout|Interval)$/]', message: SLEEP },
      ],
    },
  },
  {
    // Test doubles implement async interfaces (loadPayload, clipboard.writeText) with
    // `async` stubs that have nothing to await.
    files: ['src/**/*.test.ts'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },
  prettier,
)
