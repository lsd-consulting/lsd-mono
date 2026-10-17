Feature: Step outcomes

  Scenario: passes
    Given the shop is open
    Then the basket is checked out

  Scenario: fails
    Given the shop is open
    When the card is declined
    Then the basket is checked out

  Scenario: pending
    Given the shop is open
    When the refund is not written yet

  Scenario: undefined
    Given the shop is open
    When nobody wrote this step

  Scenario: skipped
    Given the shop is open
    When the payment provider is offline

  Scenario: ambiguous
    Given the shop is open
    When a coupon SAVE10 applies
    Then the basket is checked out

  @audited
  Scenario: hooked
    Given the shop is open
    Then the basket is checked out
