package io.github.lsdconsulting.lsd.mono.ktor.fixture

import io.github.lsdconsulting.lsd.mono.ktor.Lsd
import io.github.lsdconsulting.lsd.mono.ktor.LsdClient
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.response.header
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing

/** The shop the fixtures test: orders checked against inventory and paid through payments. */
object ShopApp {
    private val json = ContentType.Application.Json

    /** Inventory: lamps in stock, desks not. */
    fun Application.inventory() {
        install(Lsd) { app = "Inventory" }
        routing {
            get("/stock/{sku}") {
                val sku = call.parameters["sku"].orEmpty()
                call.respondText("""{"sku":"$sku","available":${sku.startsWith("lamp")}}""", json)
            }
        }
    }

    /** A payments provider outside the app: no LSD plugin of its own, so the shop's client draws it. */
    fun Application.payments(status: HttpStatusCode = HttpStatusCode.Accepted) {
        routing { post("/payments") { call.respondText("""{"payment":"p-1"}""", json, status) } }
    }

    /** This client, drawing its calls to [target]. */
    fun HttpClient.to(target: String): HttpClient = config { install(LsdClient) { this.target = target } }

    /** The shop, calling inventory at [inventoryUrl] and payments at [paymentsUrl] through [client]. */
    fun Application.shop(
        client: HttpClient,
        inventoryUrl: String = "http://inventory",
        paymentsUrl: String = "http://payments",
    ) {
        val stock = client.to("Inventory")
        val pay = client.to("Payments")
        install(Lsd) { app = "Shop" }
        routing {
            post("/orders/{sku}") {
                val sku = call.parameters["sku"].orEmpty()
                val inStock = stock.get("$inventoryUrl/stock/$sku").bodyAsText().endsWith("\"available\":true}")
                when {
                    !inStock -> call.respondText("""{"error":"$sku is out of stock"}""", json, HttpStatusCode.Conflict)
                    !pay
                        .post("$paymentsUrl/payments") {
                            contentType(json)
                            setBody("""{"amount":49.0}""")
                        }.status
                        .isSuccess() -> call.respondText("""{"error":"payment failed"}""", json, HttpStatusCode.BadGateway)
                    else -> {
                        call.response.header(HttpHeaders.Location, "/orders/o-1")
                        call.respondText("""{"order":"o-1","sku":"$sku","total":49.0}""", json, HttpStatusCode.Created)
                    }
                }
            }
        }
    }

    /** Places an order for [sku] through [client], at [base]. */
    suspend fun order(
        client: HttpClient,
        sku: String,
        base: String = "",
    ): HttpStatusCode =
        client
            .post("$base/orders/$sku") {
                contentType(json)
                setBody("""{"quantity":1}""")
            }.status
}
