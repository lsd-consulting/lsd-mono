/**
 * Local ESLint rules for the report UI (#30).
 *
 * `lsd/escaped-markup` keeps the #28 escaping in force. Wherever markup is built from
 * strings (a template literal or `+` concatenation that contains a tag or ends in an
 * attribute's opening quote) or handed to an HTML sink (`innerHTML`, `outerHTML`,
 * `insertAdjacentHTML`), every interpolated value must be one of:
 *
 * - a call to an escaper in src/lib/escape.ts (`escapeHtml`, `escapeAttr`, `jsonForScript`,
 *   `cssEscape`) or to `encodeURIComponent`;
 * - a value, property or function named `html`, `svg` or `markup` or ending in `Html`, `Svg`
 *   or `Markup`: markup that was built (and checked) elsewhere;
 * - a local variable whose every assignment is safe, or a call to a function in the same
 *   file whose every return value is safe;
 * - a nested markup template (checked on its own), or `.map(...).join(...)` whose callback
 *   returns safe values;
 * - a literal, a ternary or `&&`/`||`/`??` of safe values;
 * - anything the type checker proves is a number, boolean, bigint, null/undefined, or a
 *   string literal union with no markup characters (such as `Status`).
 *
 * Anything else needs `escapeHtml` or `escapeAttr`, or a name that says it is markup.
 */
import ts from 'typescript'

const ESCAPERS = new Set([
  'escapeHtml',
  'escapeAttr',
  'jsonForScript',
  'cssEscape',
  'encodeURIComponent',
  'toFixed',
  'toPrecision',
])
const MARKUP_NAME = /(?:^|[a-z0-9_])(?:Html|Svg|Markup)$|^(?:html|svg|markup)$/
const TAG = /<[A-Za-z/!?]/
const ATTRIBUTE_OPEN = /[\w:-]+=["']$/
const UNSAFE_CHARS = /[<>&"']/
const SAFE_FLAGS =
  ts.TypeFlags.NumberLike |
  ts.TypeFlags.BooleanLike |
  ts.TypeFlags.BigIntLike |
  ts.TypeFlags.Null |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Void |
  ts.TypeFlags.Never

function nameOf(node) {
  if (node.type === 'Identifier') return node.name
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier')
    return node.property.name
  if (node.type === 'MemberExpression' && node.computed && node.property.type === 'Literal')
    return String(node.property.value)
  return undefined
}

function isMarkupTemplate(node) {
  return node.quasis.some(
    (quasi) =>
      TAG.test(quasi.value.cooked ?? quasi.value.raw) || ATTRIBUTE_OPEN.test(quasi.value.cooked ?? quasi.value.raw),
  )
}

/** Flattens `a + b + c` into its operands. */
function operands(node) {
  return node.type === 'BinaryExpression' && node.operator === '+'
    ? [...operands(node.left), ...operands(node.right)]
    : [node]
}

function isMarkupString(node) {
  return (
    node.type === 'Literal' &&
    typeof node.value === 'string' &&
    (TAG.test(node.value) || ATTRIBUTE_OPEN.test(node.value))
  )
}

/** Return values of a function, not looking into nested functions. */
function returnValues(fn) {
  if (fn.body.type !== 'BlockStatement') return [fn.body]
  const found = []
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return
    if (node !== fn && /Function/.test(node.type)) return
    if (node.type === 'ReturnStatement') {
      if (node.argument) found.push(node.argument)
      return
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent') continue
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value.type === 'string') visit(value)
    }
  }
  visit(fn.body)
  return found
}

export const escapedMarkup = {
  meta: {
    type: 'problem',
    docs: { description: 'Values interpolated into markup must be escaped with src/lib/escape.ts' },
    schema: [],
    messages: {
      unescaped:
        '`{{text}}` is interpolated into markup unescaped. Wrap it in escapeHtml or escapeAttr (src/lib/escape.ts), or name the value *Html/*Svg if it is markup built safely elsewhere.',
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices
    const checker = services?.program?.getTypeChecker()

    function safeType(node) {
      if (!checker || !services.esTreeNodeToTSNodeMap) return false
      const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node))
      const parts = type.isUnion() ? type.types : [type]
      return parts.every((part) => {
        if (part.flags & SAFE_FLAGS) return true
        if (part.isStringLiteral()) return !UNSAFE_CHARS.test(part.value)
        return false
      })
    }

    /** The variable an identifier refers to, if it is declared in this file. */
    function resolve(identifier) {
      for (let scope = context.sourceCode.getScope(identifier); scope; scope = scope.upper) {
        const variable = scope.set.get(identifier.name)
        if (variable) return variable.defs.length ? variable : undefined
      }
      return undefined
    }

    // Variables and functions being checked, so recursion through them terminates (as unsafe).
    const visiting = new Set()

    function safeVariable(identifier) {
      const variable = resolve(identifier)
      if (!variable || visiting.has(variable)) return false
      visiting.add(variable)
      try {
        const def = variable.defs[0]
        if (def.type === 'FunctionName') return false
        const writes = variable.references.filter((ref) => ref.isWrite() && ref.writeExpr)
        return (
          writes.length > 0 &&
          variable.defs.every((d) => d.type === 'Variable') &&
          writes.every((ref) => isSafe(ref.writeExpr))
        )
      } finally {
        visiting.delete(variable)
      }
    }

    function safeLocalCall(identifier) {
      const variable = resolve(identifier)
      if (!variable || visiting.has(variable)) return false
      const def = variable.defs[0]
      const fn =
        def.type === 'FunctionName'
          ? def.node
          : def.type === 'Variable' && def.node.init && /Function/.test(def.node.init.type)
            ? def.node.init
            : undefined
      if (!fn) return false
      visiting.add(variable)
      try {
        return returnValues(fn).every(isSafe)
      } finally {
        visiting.delete(variable)
      }
    }

    function isSafe(node) {
      switch (node.type) {
        case 'ArrayExpression':
          return node.elements.every(
            (element) => element === null || isSafe(element.type === 'SpreadElement' ? element.argument : element),
          )
        case 'Literal':
          return true
        case 'TemplateLiteral':
          // A markup template is checked on its own; a plain one is safe when its parts are.
          return isMarkupTemplate(node) || node.expressions.every(isSafe)
        case 'ConditionalExpression':
          return isSafe(node.consequent) && isSafe(node.alternate)
        case 'LogicalExpression':
          return node.operator === '&&' ? isSafe(node.right) : isSafe(node.left) && isSafe(node.right)
        case 'BinaryExpression':
          return node.operator !== '+' || operands(node).every(isSafe) || safeType(node)
        case 'ChainExpression':
          return isSafe(node.expression)
        case 'TSNonNullExpression':
        case 'TSAsExpression':
          return isSafe(node.expression)
        case 'CallExpression': {
          const name = nameOf(node.callee)
          if (name && (ESCAPERS.has(name) || MARKUP_NAME.test(name))) return true
          if (name === 'String' && node.callee.type === 'Identifier') return node.arguments.every(isSafe)
          if (node.callee.type === 'Identifier' && safeLocalCall(node.callee)) return true
          if (name === 'join' && node.callee.type === 'MemberExpression') {
            const target = node.callee.object
            if (target.type === 'CallExpression' && nameOf(target.callee) === 'map') {
              const fn = target.arguments[0]
              if (fn && (fn.type === 'ArrowFunctionExpression' || fn.type === 'FunctionExpression'))
                return returnValues(fn).every(isSafe)
            }
            if (nameOf(target) && MARKUP_NAME.test(nameOf(target))) return true
            if (target.type === 'Identifier' && safeVariable(target)) return true
          }
          return safeType(node)
        }
        case 'Identifier':
          return MARKUP_NAME.test(node.name) || safeType(node) || safeVariable(node)
        case 'MemberExpression': {
          const name = nameOf(node)
          return (name !== undefined && MARKUP_NAME.test(name)) || safeType(node)
        }
        default:
          return safeType(node)
      }
    }

    function check(node) {
      if (!isSafe(node))
        context.report({ node, messageId: 'unescaped', data: { text: context.sourceCode.getText(node).slice(0, 60) } })
    }

    return {
      TemplateLiteral(node) {
        if (node.parent.type === 'TaggedTemplateExpression') return
        if (isMarkupTemplate(node)) node.expressions.forEach(check)
      },
      BinaryExpression(node) {
        if (node.operator !== '+' || (node.parent.type === 'BinaryExpression' && node.parent.operator === '+')) return
        const parts = operands(node)
        if (parts.some(isMarkupString)) parts.filter((part) => !isMarkupString(part)).forEach(check)
      },
      AssignmentExpression(node) {
        const name = nameOf(node.left)
        if (name === 'innerHTML' || name === 'outerHTML') check(node.right)
      },
      CallExpression(node) {
        const name = nameOf(node.callee)
        if (name === 'insertAdjacentHTML' && node.arguments[1]) check(node.arguments[1])
        if ((name === 'write' || name === 'writeln') && nameOf(node.callee.object ?? {}) === 'document')
          node.arguments.forEach(check)
      },
    }
  },
}

export default {
  meta: { name: 'eslint-plugin-lsd' },
  rules: { 'escaped-markup': escapedMarkup },
}
