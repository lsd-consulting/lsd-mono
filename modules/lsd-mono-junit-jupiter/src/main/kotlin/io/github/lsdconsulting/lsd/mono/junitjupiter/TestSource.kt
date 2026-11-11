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
            val file = sourceFile(testClass, configuredRoots, workingDir) ?: return null
            extract(file.readText(), classChain(testClass), jvmName(method.name), file.name.endsWith(".kt"))
        }.getOrNull()

    /** The outermost class first, then each nested class down to [testClass]. */
    private fun classChain(testClass: Class<*>): List<String> =
        generateSequence(testClass) { it.enclosingClass }.map { it.simpleName }.toList().reversed()

    /** An `internal` Kotlin function's JVM name carries a `$module` suffix. */
    private fun jvmName(name: String): String = name.substringBefore('$')

    private fun sourceFile(testClass: Class<*>, configuredRoots: List<String>, workingDir: File): File? {
        val top = generateSequence(testClass) { it.enclosingClass }.last()
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
    internal fun extract(text: String, classChain: List<String>, name: String, kotlin: Boolean): String? {
        val code = Code(text)
        var start = 0
        var end = text.length
        for (className in classChain) {
            val body = code.classBody(className, start, end) ?: return null
            start = body.first
            end = body.last
        }
        val declaration = declaration(name, kotlin)
        val match =
            declaration
                .findAll(text.substring(start, end))
                .map { it.range.first + start }
                .firstOrNull { !code.isInsideStringOrComment(it) && code.depth(start, it) == 0 }
                ?: return null
        val bodyEnd = code.methodEnd(match, end) ?: return null
        val from = annotationsStart(text, lineStart(text, match))
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

    /** Back up over annotation lines (and blank-free lines continuing them) directly above the declaration. */
    private fun annotationsStart(text: String, declarationLine: Int): Int {
        var from = declarationLine
        while (from > 0) {
            val previous = lineStart(text, from - 1)
            val line = text.substring(previous, from).trim()
            if (line.startsWith("@")) from = previous else break
        }
        return from
    }

    private fun List<String>.trimIndent(): List<String> {
        val indent = filter { it.isNotBlank() }.minOfOrNull { line -> line.takeWhile { it == ' ' || it == '\t' }.length } ?: 0
        return map { if (it.isBlank()) "" else it.drop(indent).trimEnd() }
    }

    /** Source text with its strings and comments marked, so braces inside them are skipped. */
    private class Code(
        val text: String,
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
                        '=' -> if (parens == 0) return expressionEnd(i, to)
                        ';' -> if (parens == 0) return null
                    }
                }
                i++
            }
            return null
        }

        /** A Kotlin `= …` body: through its matching brace when it opens one on that line, else to the line end. */
        private fun expressionEnd(equals: Int, to: Int): Int {
            val lineEnd = text.indexOf('\n', equals).let { if (it < 0 || it > to) to else it }
            val open = (equals until lineEnd).firstOrNull { isCode[it] && text[it] == '{' } ?: return lineEnd
            return matching(open, to)?.plus(1) ?: lineEnd
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
                    text.startsWith("/*", i) -> skipTo(text.indexOf("*/", i + 2).let { if (it < 0) text.length else it + 2 })
                    text.startsWith("\"\"\"", i) -> skipTo(text.indexOf("\"\"\"", i + 3).let { if (it < 0) text.length else it + 3 })
                    // A backticked Kotlin name can hold a quote or a brace: skip it whole.
                    c == '`' -> skipTo(text.indexOf('`', i + 1).let { if (it < 0 || text.indexOf('\n', i) in i until it) i + 1 else it + 1 })
                    c == '"' || c == '\'' -> skipTo(literalEnd(i, c))
                    else -> i++
                }
            }
            return code
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
