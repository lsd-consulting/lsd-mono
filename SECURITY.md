# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| Latest `0.y.z` release | Yes |
| Older `0.y.z` releases | No: upgrade to the latest |

Until v1, fixes go to `main` and ship in the next `0.y.z` release, which is cut automatically
([docs/releasing.md](docs/releasing.md)). There are no backports.

## Reporting a vulnerability

Report it privately through GitHub: on this repository, open **Security → Report a vulnerability**.
Please do not open a public issue. Include what is affected, how to reproduce it, and its impact.

lsd-mono is a test-time library. Reports it writes can contain captured request and response
payloads; `lsd.mono.payload.*` sets limits and redaction. Issues in that redaction are in scope.

A report written by a release requests one small file from jsDelivr when it is opened, to count
usage. It sends no report content, and `lsd.mono.report.usagePing=false` turns it off. See
[Usage ping](README.md#usage-ping).
