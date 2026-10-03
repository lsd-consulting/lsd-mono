/**
 * Small static report for axe and screenshots. Not the perf payload pages.
 * generatedAt is fixed. Screenshots crop the diagram and do not include the hero.
 */
export const uxFixture = {
  title: 'UX fixture',
  generatedAt: '2026-01-15T12:00:00+00:00',
  generator: 'ux-fixture',
  scenarios: [
    {
      id: 'ux',
      title: 'Checkout',
      status: 'success',
      description: 'A short checkout used by the accessibility checks.',
      facts: [{ key: 'orderId', value: 'ord_ux' }],
      metrics: [{ key: 'Messages', value: '14' }],
      participants: [
        { id: 'client', name: 'Client', type: 'ACTOR' },
        { id: 'api', name: 'Api', type: 'PARTICIPANT' },
        { id: 'db', name: 'Database', type: 'DATABASE' },
        { id: 'bus', name: 'Queue', type: 'QUEUE' },
      ],
      events: Array.from({ length: 14 }, (_, i) => {
        const hop = i % 3
        const from = hop === 0 ? 'client' : hop === 1 ? 'api' : 'db'
        const to = hop === 0 ? 'api' : hop === 1 ? 'db' : 'api'
        const label = i === 0 ? 'place order' : hop === 2 ? 'ok' : hop === 1 ? 'insert' : 'charge'
        return {
          kind: 'message',
          id: `m${i}`,
          from,
          to,
          label: i === 0 ? label : `${label} ${i}`,
          type: hop === 2 ? 'SYNCHRONOUS_RESPONSE' : 'SYNCHRONOUS',
          data: {
            method: 'POST',
            path: `/orders/${i}`,
            status: hop === 2 ? 200 : 202,
            body: { n: i },
          },
        }
      }),
    },
  ],
}
