Feature:

  Scenario: places an untitled order
    Given a customer is ready to check out
    When the customer places an order for socks
    Then the order is accepted
