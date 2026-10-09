import { RuleTester } from 'eslint'
import tseslint from 'typescript-eslint'
import { afterAll, describe, it } from 'vitest'
import { escapedMarkup } from './eslint-plugin-lsd.js'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

// Without type information: the type-aware allowances (numbers, Status) are covered by
// linting the real sources, which run with the TypeScript program.
const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } })
const unescaped = { messageId: 'unescaped' }

tester.run('lsd/escaped-markup', escapedMarkup, {
  valid: [
    'const a = (t: string) => `<p>${escapeHtml(t)}</p>`',
    'const a = (t: string) => `<a href="${escapeAttr(t)}">x</a>`',
    'const a = (bodyHtml: string) => `<div>${bodyHtml}</div>`',
    'const a = (d: { svg: string }) => `<div>${d.svg}</div>`',
    'const a = (xs: string[]) => `<ul>${xs.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`',
    'const a = (on: boolean) => `<b>${on ? "yes" : "no"}</b>`',
    'const a = (t: string) => { const safe = escapeHtml(t); return `<p>${safe}</p>` }',
    'function cue() { return "!" }\nconst a = () => `<p>${cue()}</p>`',
    'const a = (t: string) => `plain ${t}`',
    'const a = (el: HTMLElement) => { el.innerHTML = "" }',
    'const a = (el: HTMLElement, t: string) => { el.innerHTML = `<p>${escapeHtml(t)}</p>` }',
  ],
  invalid: [
    { code: 'const a = (t: string) => `<p>${t}</p>`', errors: [unescaped] },
    { code: 'const a = (t: string) => `<a title="${t}">x</a>`', errors: [unescaped] },
    // An attribute's opening quote makes the whole template markup.
    { code: 'const a = (t: string) => `x ${t} class="${t}"`', errors: [unescaped, unescaped] },
    { code: 'const a = (t: string) => "<p>" + t + "</p>"', errors: [unescaped] },
    { code: 'const a = (el: HTMLElement, t: string) => { el.innerHTML = t }', errors: [unescaped] },
    {
      code: 'const a = (el: HTMLElement, t: string) => { el.insertAdjacentHTML("beforeend", t) }',
      errors: [unescaped],
    },
    { code: 'const a = (xs: string[]) => `<ul>${xs.map((x) => x).join("")}</ul>`', errors: [unescaped] },
    { code: 'const a = (t: string) => { let s = escapeHtml(t); s = t; return `<p>${s}</p>` }', errors: [unescaped] },
    { code: 'const a = (on: boolean, t: string) => `<b>${on ? escapeHtml(t) : t}</b>`', errors: [unescaped] },
  ],
})
