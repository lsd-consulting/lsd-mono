/** Full demo payloads. Not part of the first script. Keyed by scenarioId/messageId. */
export const samplePayloads: Record<string, unknown> = {
  'sc-happy/m1': {
    method: 'POST',
    path: '/checkout',
    status: 202,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-request-id': 'req_checkout_88',
    },
    body: {
      cartId: 'cart_88',
      items: [
        {
          sku: 'SOCK-01',
          qty: 2,
        },
      ],
      paymentMethodId: 'pm_visa',
    },
  },
  'sc-happy/m2': {
    cartId: 'cart_88',
    currency: 'GBP',
  },
  'sc-happy/m3': {
    sql: "INSERT INTO orders (id, status) VALUES ('ord_9f2a1c', 'RESERVED')",
  },
  'sc-happy/m4': {
    method: 'POST',
    path: '/orders',
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'req_insert_9f2a1c',
    },
    body: {
      orderId: 'ord_9f2a1c',
      rows: 1,
    },
  },
  'sc-happy/m5': {
    orderId: 'ord_9f2a1c',
    status: 'RESERVED',
  },
  'sc-happy/m6': {
    orderId: 'ord_9f2a1c',
    amountMinor: 4850,
    currency: 'GBP',
  },
  'sc-happy/m7': {
    chargeId: 'ch_77ab',
    status: 'succeeded',
  },
  'sc-happy/m8': {
    orderId: 'ord_9f2a1c',
    event: 'order.confirmed',
  },
  'sc-happy/m9': {
    orderId: 'ord_9f2a1c',
    status: 'CONFIRMED',
  },
  'sc-warn/wm1': {
    cartId: 'cart_slow',
    paymentMethodId: 'pm_visa',
  },
  'sc-warn/wm2': {
    attempt: 1,
    timeoutMs: 1500,
  },
  'sc-warn/wm3': {
    error: 'GATEWAY_TIMEOUT',
    message: 'No response within 1500ms',
  },
  'sc-warn/wm4': {
    attempt: 2,
  },
  'sc-warn/wm5': {
    chargeId: 'ch_retry',
    status: 'succeeded',
  },
  'sc-warn/wm6': {
    method: 'POST',
    path: '/events/order.confirmed',
    status: 202,
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'req_bus_slow',
    },
    body: {
      orderId: 'ord_slow1',
      event: 'order.confirmed',
    },
  },
  'sc-warn/wm7': {
    method: 'POST',
    path: '/checkout',
    status: 201,
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'req_checkout_slow',
    },
    body: {
      orderId: 'ord_slow1',
      status: 'CONFIRMED',
    },
  },
  'sc-error/em1': {
    cartId: 'cart_empty_stock',
    items: [
      {
        sku: 'SOCK-01',
        qty: 1,
      },
    ],
  },
  'sc-error/em2': {
    method: 'POST',
    path: '/orders/reserve',
    status: 409,
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'req_reserve_empty',
    },
    body: {
      cartId: 'cart_empty_stock',
      items: [
        {
          sku: 'SOCK-01',
          qty: 1,
        },
      ],
    },
  },
  'sc-error/em3': {
    sku: 'SOCK-01',
    requested: 1,
  },
  'sc-error/em4': {
    sku: 'SOCK-01',
    available: 0,
  },
  'sc-error/em5': {
    error: 'INSUFFICIENT_STOCK',
    sku: 'SOCK-01',
    requested: 1,
    available: 0,
  },
  'sc-error/em6': {
    status: 409,
    title: 'Conflict',
    detail: 'SKU SOCK-01 is out of stock',
  },
}
