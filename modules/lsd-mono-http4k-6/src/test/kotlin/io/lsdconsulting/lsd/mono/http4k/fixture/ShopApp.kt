package io.lsdconsulting.lsd.mono.http4k.fixture

import io.lsdconsulting.lsd.mono.http4k.LsdHttp4k
import org.http4k.core.HttpHandler
import org.http4k.core.Method.GET
import org.http4k.core.Method.POST
import org.http4k.core.Request
import org.http4k.core.Response
import org.http4k.core.Status
import org.http4k.core.Status.Companion.ACCEPTED
import org.http4k.core.Status.Companion.BAD_GATEWAY
import org.http4k.core.Status.Companion.CONFLICT
import org.http4k.core.Status.Companion.CREATED
import org.http4k.core.Status.Companion.OK
import org.http4k.core.then
import org.http4k.routing.bind
import org.http4k.routing.path
import org.http4k.routing.routes

/** The shop the fixtures test: orders checked against inventory and paid through payments. */
object ShopApp {
    private val json = "Content-Type" to "application/json"

    /** Inventory: lamps in stock, desks not. */
    val inventory: HttpHandler =
        LsdHttp4k.serverFilter("Inventory").then(
            routes(
                "/stock/{sku}" bind GET to { request ->
                    val sku = request.path("sku").orEmpty()
                    val available = sku.startsWith("lamp")
                    Response(OK).header(json.first, json.second).body("""{"sku":"$sku","available":$available}""")
                },
            ),
        )

    /** A payments provider outside the app: no LSD filter of its own, so the shop's client draws it. */
    fun payments(status: Status = ACCEPTED): HttpHandler = { Response(status).header(json.first, json.second).body("""{"payment":"p-1"}""") }

    /** The shop, calling [inventory] and [payments] through client filters. */
    fun shop(
        inventory: HttpHandler = ShopApp.inventory,
        payments: HttpHandler = payments(),
    ): HttpHandler {
        val stock = LsdHttp4k.clientFilter("Inventory").then(inventory)
        val pay = LsdHttp4k.clientFilter("Payments").then(payments)
        return LsdHttp4k.serverFilter("Shop").then(
            routes(
                "/orders/{sku}" bind POST to { request ->
                    val sku = request.path("sku").orEmpty()
                    val inStock = stock(Request(GET, "/stock/$sku")).bodyString().contains("\"available\":true")
                    when {
                        !inStock -> Response(CONFLICT).header(json.first, json.second).body("""{"error":"$sku is out of stock"}""")
                        !pay(Request(POST, "/payments").header(json.first, json.second).body("""{"amount":49.0}""")).status.successful ->
                            Response(BAD_GATEWAY).header(json.first, json.second).body("""{"error":"payment failed"}""")
                        else -> Response(
                            CREATED,
                        ).header(json.first, json.second).header("Location", "/orders/o-1").body("""{"order":"o-1","sku":"$sku","total":49.0}""")
                    }
                },
            ),
        )
    }

    fun order(sku: String): Request = Request(POST, "/orders/$sku").header(json.first, json.second).body("""{"quantity":1}""")
}
