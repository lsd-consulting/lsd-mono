package io.github.lsdconsulting.lsd.mono.report.model

/**
 * Marks lsd-mono-report-model's types, and lsd-mono-report-html's writer API that takes them, as
 * experimental: they can change in any release, with no binary-compatibility promise. The wide
 * classes are made with builders, so that the schema's added fields stop breaking callers
 * (https://github.com/lsd-consulting/lsd-mono/issues/118); the marker stays until that shape has
 * been used for a release or two.
 *
 * A Kotlin caller opts in where it uses them, with `@OptIn(ExperimentalLsdReportModel::class)`, or
 * once per module with the compiler option
 * `-opt-in=io.github.lsdconsulting.lsd.mono.report.model.ExperimentalLsdReportModel`. Java does not see
 * opt-in markers, so a Java caller gets no warning: the modules' READMEs say the same.
 */
@RequiresOptIn(
    message = "lsd-mono's report model and writer API are experimental: they can change in any release, with no binary compatibility.",
    level = RequiresOptIn.Level.ERROR,
)
@Retention(AnnotationRetention.BINARY)
@Target(
    AnnotationTarget.CLASS,
    AnnotationTarget.FUNCTION,
    AnnotationTarget.PROPERTY,
    AnnotationTarget.CONSTRUCTOR,
    AnnotationTarget.TYPEALIAS,
)
public annotation class ExperimentalLsdReportModel
