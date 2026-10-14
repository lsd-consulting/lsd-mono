# Security policy

## Supported versions

lsd-mono has not been released. Fixes go to `main`.

## Reporting a vulnerability

Report it privately through GitHub: on this repository, open **Security → Report a vulnerability**.
Please do not open a public issue. Include what is affected, how to reproduce it, and its impact.

lsd-mono is a test-time library. Reports it writes can contain captured request and response
payloads; `lsd.mono.payload.*` sets limits and redaction. Issues in that redaction are in scope.
