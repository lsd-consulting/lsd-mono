Feature: Place an order

  Scenario: places an order
    Given a customer is ready to check out
    When the customer places an order for socks
    Then the order is accepted
