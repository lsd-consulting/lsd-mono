Feature: returns in parallel

  Scenario: r1
    Given the scenario "r1"
    When "r1" sends 30 messages

  Scenario: r2
    Given the scenario "r2"
    When "r2" sends 30 messages

  Scenario: r3
    Given the scenario "r3"
    When "r3" sends 30 messages

  Scenario Outline: r outline
    Given the scenario "<tag>"
    When "<tag>" sends 30 messages

    Examples:
      | tag  |
      | ro1 |
      | ro2 |

    Examples:
      | tag  |
      | ro3 |
