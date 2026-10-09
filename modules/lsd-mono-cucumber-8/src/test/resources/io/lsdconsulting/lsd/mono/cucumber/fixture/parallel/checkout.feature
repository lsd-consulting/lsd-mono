Feature: checkout in parallel

  Scenario: c1
    Given the scenario "c1"
    When "c1" sends 30 messages

  Scenario: c2
    Given the scenario "c2"
    When "c2" sends 30 messages

  Scenario: c3
    Given the scenario "c3"
    When "c3" sends 30 messages

  Scenario Outline: c outline
    Given the scenario "<tag>"
    When "<tag>" sends 30 messages

    Examples:
      | tag  |
      | co1 |
      | co2 |

    Examples:
      | tag  |
      | co3 |
