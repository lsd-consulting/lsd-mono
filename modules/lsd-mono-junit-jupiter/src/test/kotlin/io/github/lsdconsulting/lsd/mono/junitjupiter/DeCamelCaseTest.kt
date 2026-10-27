package io.github.lsdconsulting.lsd.mono.junitjupiter

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource

class DeCamelCaseTest {
    @ParameterizedTest(name = "{0} -> {1}")
    @CsvSource(
        delimiter = '|',
        textBlock = """
        helloWorld                | hello world
        LsdOutcomeFixtures        | lsd outcome fixtures
        getURLs                   | get urls
        parseHTTPResponse         | parse http response
        userIDsAreUnique          | user ids are unique
        orderForIPhone            | order for i phone
        retry3Times               | retry3 times
        http2Client               | http2 client
        test1                     | test1
        version10Plus             | version10 plus
        2fa                       | 2fa
        places_an_order           | places an order
        URL                       | url
        x                         | x
        Order for iPhone          | Order for iPhone
        Refund (partial)          | Refund (partial)
        places an order           | places an order
        '  padded name  '         | padded name
        [1] amount=5              | [1] amount=5""",
    )
    fun `deCamelCase splits identifiers and keeps written text`(name: String, expected: String) {
        assertEquals(expected, name.deCamelCase())
    }
}
