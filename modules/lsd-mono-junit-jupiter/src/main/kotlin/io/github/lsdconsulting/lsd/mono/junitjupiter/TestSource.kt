package io.github.lsdconsulting.lsd.mono.junitjupiter

import java.io.File
import java.lang.reflect.Method

/**
 * Finds a test method's source on disk, so the scenario can show it next to the diagram (#72).
 *
 * The class file has no method body, so the source is read at run time: from the roots in
 * `lsd.mono.junit.sourceRoot` first, then from `src/test/kotlin` and `src/test/java` under the working directory
 * and above the test class's compiled location. The file is `<package>/<top-level class>.kt` or
 * `.java`, or another `.kt` file in that package that declares the class. The method is cut out
 * from its annotations through the brace that closes its body, skipping braces inside strings and
 * comments; it is not parsed.
 *
 * Nothing here throws: a missing file, an unreadable one or a method it cannot find means no source.
 */
internal object TestSource {
    /** The fact key the source is written under. */
    const val FACT_KEY: String = "Test source"

    /** Longest method shown, in lines; a longer one is left out rather than cut. */
    const val MAX_LINES: Int = 400

    private val conventionalRoots = listOf("src/test/kotlin", "src/test/java")

    /**
     * The source of [method], declared in [testClass] (possibly a nested class), or null.
     * [configuredRoots] are the `lsd.mono.junit.sourceRoot` directories, tried first.
     */
    fun of(
        testClass: Class<*>,
        method: Method,
        configuredRoots: List<String>,
        workingDir: File = File(System.getProperty("user.dir") ?: "."),
    ): String? =
        runCatching {
            val top = generateSequence(testClass) { it.enclosingClass }.last()
            val code = recent.get(Triple(top, configuredRoots, workingDir)) { parsedSource(top, configuredRoots, workingDir) } ?: return null
            extract(code, classChain(testClass), jvmName(method.name))
        }.getOrNull()

    /**
     * The test class's source, read and marked once: each test of a class asks for it, and the
     * `.kt` search can read every file in the package. A few classes are kept, so the tests of a
     * class (or of the classes running in parallel) share it without holding every test source.
     */
    private val recent = Recent<Triple<Class<*>, List<String>, File>, Code>(capacity = 16)

    private fun parsedSource(top: Class<*>, configuredRoots: List<String>, workingDir: File): Code? {
        val file = sourceFile(top, configuredRoots, workingDir) ?: return null
        return Code(file.readText(), kotlin = file.name.endsWith(".kt"))
    }

    /** A small least-recently-used map; a key whose value is null is remembered too. */
    internal class Recent<K, V : Any>(
        private val capacity: Int,
    ) {
        private val entries = object : LinkedHashMap<K, Any>(capacity, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<K, Any>?): Boolean = size > capacity
        }

        @Suppress("UNCHECKED_CAST")
        fun get(key: K, load: () -> V?): V? {
            synchronized(entries) { entries[key] }?.let { return if (it === NONE) null else it as V }
            val value = load()
            synchronized(entries) { entries[key] = value ?: NONE }
            return value
        }

        val size: Int get() = synchronized(entries) { entries.size }

        private object NONE
    }

    /** The outermost class first, then each nested class down to [testClass]. */
    private fun classChain(testClass: Class<*>): List<String> =
        generateSequence(testClass) { it.enclosingClass }.map { it.simpleName }.toList().reversed()

    /** An `internal` Kotlin function's JVM name carries a `$module` suffix. */
    private fun jvmName(name: String): String = name.substringBefore('$')

    private fun sourceFile(top: Class<*>, configuredRoots: List<String>, workingDir: File): File? {
        val packagePath = top.packageName.replace('.', '/')
        return roots(top, configuredRoots, workingDir).firstNotNullOfOrNull { root ->
            val dir = File(root, packagePath)
            sequenceOf(File(dir, "${top.simpleName}.kt"), File(dir, "${top.simpleName}.java")).firstOrNull { it.isFile }
                ?: declaringKotlinFile(dir, top.simpleName)
        }
    }

    /** A Kotlin test class can live in a file of another name. */
    private fun declaringKotlinFile(dir: File, simpleName: String): File? {
        val declaration = Regex("""\bclass\s+`?${Regex.escape(simpleName)}`?\b""")
        return dir
            .listFiles { f -> f.isFile && f.name.endsWith(".kt") }
            ?.sortedBy { it.name }
            ?.firstOrNull { declaration.containsMatchIn(it.readText()) }
    }

    private fun roots(top: Class<*>, configuredRoots: List<String>, workingDir: File): List<File> {
        val configured =
            configuredRoots.map { File(it).let { f -> if (f.isAbsolute) f else File(workingDir, it) } }
        val bases = listOf(workingDir) + compiledLocationAncestors(top)
        val conventional = bases.flatMap { base -> conventionalRoots.map { File(base, it) } }
        return (configured + conventional).filter { it.isDirectory }.distinctBy { it.absoluteFile.normalize() }
    }

    /** The directories above the test class's compiled location, such as `<project>/build/classes/kotlin/test`. */
    private fun compiledLocationAncestors(top: Class<*>): List<File> {
        val location = runCatching {
            top.protectionDomain
                ?.codeSource
                ?.location
                ?.toURI()
                ?.let(::File)
        }.getOrNull() ?: return emptyList()
        return generateSequence(location.absoluteFile.parentFile) { it.parentFile }.take(6).toList()
    }

    /**
     * Cuts the method [name] out of [text]: within the body of each class in [classChain] in turn,
     * from the annotations above its declaration through the brace that closes its body.
     */
    internal fun extract(text: String, classChain: List<String>, name: String, kotlin: Boolean): String? =
        extract(Code(text, kotlin), classChain, name)

    private fun extract(code: Code, classChain: List<String>, name: String): String? {
        val text = code.text
        var start = 0
        var end = text.length
        for (className in classChain) {
            val body = code.classBody(className, start, end) ?: return null
            start = body.first
            end = body.last
        }
        val declaration = declaration(name, code.kotlin)
        val match =
            declaration
                .findAll(text.substring(start, end))
                .map { it.range.first + start }
                .firstOrNull { !code.isInsideStringOrComment(it) && code.depth(start, it) == 0 }
                ?: return null
        val bodyEnd = code.methodEnd(match, end) ?: return null
        val from = code.annotationsStart(lineStart(text, match))
        val lines = text.substring(from, bodyEnd).lines()
        if (lines.size > MAX_LINES) return null
        return lines.trimIndent().joinToString("\n").trimEnd()
    }

    /** A Kotlin `fun name(` or `` fun `name`( ``; a Java method declaration `Type name(`. */
    private fun declaration(name: String, kotlin: Boolean): Regex {
        // Concatenated, not templated: these are regular expressions, not markup, and the
        // HTML escaping guard reads any template holding `<` as markup.
        val n = Regex.escape(name)
        return if (kotlin) {
            Regex("""\bfun\s+(?:<[^>]*>\s*)?(?:`""" + n + "`|" + n + """)\s*\(""")
        } else {
            Regex("""(?<![\w.])[\w<>\[\],.?]+\s+""" + n + """\s*\(""")
        }
    }

    private fun lineStart(text: String, index: Int): Int = text.lastIndexOf('\n', index - 1) + 1

    private fun List<String>.trimIndent(): List<String> {
        val indent = filter { it.isNotBlank() }.minOfOrNull { line -> line.takeWhile { it == ' ' || it == '\t' }.length } ?: 0
        return map { if (it.isBlank()) "" else it.drop(indent).trimEnd() }
    }

    /** Source text with its strings and comments marked, so braces inside them are skipped. */
    private class Code(
        val text: String,
        /** Kotlin: block comments nest. */
        val kotlin: Boolean,
    ) {
        /** For each character, whether it is code (not inside a string, char literal or comment). */
        private val isCode: BooleanArray = mark()

        fun isInsideStringOrComment(index: Int): Boolean = !isCode[index]

        /** Brace depth at [index], counting from [from]. */
        fun depth(from: Int, index: Int): Int {
            var depth = 0
            for (i in from until index) {
                if (!isCode[i]) continue
                when (text[i]) {
                    '{' -> depth++
                    '}' -> depth--
                }
            }
            return depth
        }

        /**
         * Back up over the annotations directly above the declaration line starting at [declarationLine]:
         * lines holding only annotations, and an annotation whose arguments span lines, such as
         * `@CsvSource(` … `)`, found from its closing parenthesis. A line that starts with an
         * annotation but goes on to declare something, such as a one-line test above, is not one.
         */
        fun annotationsStart(declarationLine: Int): Int {
            var from = declarationLine
            while (from > 0) {
                val previous = lineStart(text, from - 1)
                if (onlyAnnotations(previous, from)) {
                    from = previous
                    continue
                }
                val close = (from - 1 downTo previous).firstOrNull { isCode[it] && !text[it].isWhitespace() }
                if (close == null || text[close] != ')') break
                val open = openingParen(close) ?: break
                val annotationLine = lineStart(text, open)
                if (!onlyAnnotations(annotationLine, close + 1)) break
                from = annotationLine
            }
            return from
        }

        /**
         * Whether [from] until [to] holds at least one annotation and nothing else in code: each is
         * `@` and a (qualified, or use-site) name, optionally with its arguments in parentheses.
         */
        private fun onlyAnnotations(from: Int, to: Int): Boolean {
            var i = from
            var annotations = 0
            while (i < to) {
                when {
                    !isCode[i] || text[i].isWhitespace() -> i++
                    text[i] == '@' -> {
                        i++
                        while (i < to && isCode[i] && (text[i].isLetterOrDigit() || text[i] in "_.:")) i++
                        var j = i
                        while (j < to && text[j].isWhitespace()) j++
                        if (j < to && isCode[j] && text[j] == '(') i = (closingParen(j, to) ?: return false) + 1
                        annotations++
                    }
                    else -> return false
                }
            }
            return annotations > 0
        }

        /** The `)` that closes the `(` at [open], before [to]. */
        private fun closingParen(open: Int, to: Int): Int? {
            var depth = 0
            for (i in open until to) {
                if (!isCode[i]) continue
                when (text[i]) {
                    '(' -> depth++
                    ')' -> if (--depth == 0) return i
                }
            }
            return null
        }

        /** The `(` that the `)` at [close] closes. */
        private fun openingParen(close: Int): Int? {
            var depth = 0
            for (i in close downTo 0) {
                if (!isCode[i]) continue
                when (text[i]) {
                    ')' -> depth++
                    '(' -> if (--depth == 0) return i
                }
            }
            return null
        }

        /** The inside of `class Name … { … }` (or object, interface), between [from] and [to]. */
        fun classBody(name: String, from: Int, to: Int): IntRange? {
            val declaration = Regex("""\b(?:class|object|interface|enum\s+class|record)\s+`?${Regex.escape(name)}`?\b""")
            val match =
                declaration
                    .findAll(text.substring(from, to))
                    .map { it.range.first + from }
                    .firstOrNull { isCode[it] && depth(from, it) == 0 }
                    ?: return null
            // The first brace outside the constructor's parentheses, whose defaults can hold lambdas.
            var parens = 0
            val open =
                (match until to).firstOrNull {
                    if (isCode[it]) {
                        when (text[it]) {
                            '(' -> parens++
                            ')' -> parens--
                        }
                    }
                    isCode[it] && text[it] == '{' && parens == 0
                } ?: return null
            val close = matching(open, to) ?: return null
            return (open + 1)..close
        }

        /**
         * The end of the method declared at [declaration]: after the brace that closes its body, or,
         * for a Kotlin expression body with no braces, the end of its line.
         */
        fun methodEnd(declaration: Int, to: Int): Int? {
            var parens = 0
            var i = declaration
            while (i < to) {
                if (isCode[i]) {
                    when (text[i]) {
                        '(' -> parens++
                        ')' -> parens--
                        '{' -> if (parens == 0) return matching(i, to)?.plus(1)
                        '=' -> if (parens == 0) return expressionEnd(declaration, i, to)
                        ';' -> if (parens == 0) return null
                    }
                }
                i++
            }
            return null
        }

        /**
         * A Kotlin `= …` body, on the declaration's line or wrapped onto the lines below it: it ends at
         * the end of a line where its brackets are all closed and the next non-blank line is
         * indented no deeper than the declaration.
         */
        private fun expressionEnd(declaration: Int, equals: Int, to: Int): Int {
            val indent = indentOf(lineStart(text, declaration))
            var depth = 0
            var i = equals
            while (i < to) {
                val c = text[i]
                if (isCode[i]) {
                    when (c) {
                        '(', '{', '[' -> depth++
                        ')', '}', ']' -> depth--
                    }
                }
                if (c == '\n' && depth <= 0) {
                    val next = nextNonBlankLine(i + 1, to)
                    if (next == null || indentOf(next) <= indent) return i
                }
                i++
            }
            return to
        }

        private fun indentOf(lineStart: Int): Int {
            var j = lineStart
            while (j < text.length && (text[j] == ' ' || text[j] == '\t')) j++
            return j - lineStart
        }

        /** The start of the first line from [from] with something on it, or null before [to]. */
        private fun nextNonBlankLine(from: Int, to: Int): Int? {
            var line = from
            while (line < to) {
                val end = text.indexOf('\n', line).let { if (it < 0) text.length else it }
                if (text.substring(line, end).isNotBlank()) return line
                line = end + 1
            }
            return null
        }

        /** The index of the brace closing the one at [open]. */
        private fun matching(open: Int, to: Int): Int? {
            var depth = 0
            for (i in open until to) {
                if (!isCode[i]) continue
                when (text[i]) {
                    '{' -> depth++
                    '}' -> if (--depth == 0) return i
                }
            }
            return null
        }

        private fun mark(): BooleanArray {
            val code = BooleanArray(text.length) { true }
            var i = 0

            fun skipTo(end: Int) {
                val stop = end.coerceAtMost(text.length)
                for (j in i until stop) code[j] = false
                i = stop
            }
            while (i < text.length) {
                val c = text[i]
                when {
                    text.startsWith("//", i) -> skipTo(text.indexOf('\n', i).let { if (it < 0) text.length else it })
                    text.startsWith("/*", i) -> skipTo(blockCommentEnd(i))
                    text.startsWith("\"\"\"", i) -> skipTo(text.indexOf("\"\"\"", i + 3).let { if (it < 0) text.length else it + 3 })
                    // A backticked Kotlin name can hold a quote or a brace: skip it whole.
                    c == '`' -> skipTo(text.indexOf('`', i + 1).let { if (it < 0 || text.indexOf('\n', i) in i until it) i + 1 else it + 1 })
                    c == '"' || c == '\'' -> skipTo(literalEnd(i, c))
                    else -> i++
                }
            }
            return code
        }

        /** The index after the block comment at [start]; Kotlin's nest, Java's do not. */
        private fun blockCommentEnd(start: Int): Int {
            if (!kotlin) return text.indexOf("*/", start + 2).let { if (it < 0) text.length else it + 2 }
            var depth = 0
            var j = start
            while (j < text.length) {
                when {
                    text.startsWith("/*", j) -> {
                        depth++
                        j += 2
                    }
                    text.startsWith("*/", j) -> {
                        j += 2
                        if (--depth == 0) return j
                    }
                    else -> j++
                }
            }
            return text.length
        }

        /** The index after a "…" or '…' literal starting at [start], honouring backslash escapes. */
        private fun literalEnd(start: Int, quote: Char): Int {
            var j = start + 1
            while (j < text.length) {
                when (text[j]) {
                    '\\' -> j += 2
                    quote -> return j + 1
                    '\n' -> return j
                    else -> j++
                }
            }
            return text.length
        }
    }
}
