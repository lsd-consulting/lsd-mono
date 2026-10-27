# Usage ping

[![jsDelivr hits](https://data.jsdelivr.com/v1/package/gh/lsd-consulting/lsd-mono/badge)](https://www.jsdelivr.com/package/gh/lsd-consulting/lsd-mono)

A report written by a release of lsd-mono (not a `-SNAPSHOT` build) counts towards jsDelivr's public hit count, the number on the jsDelivr badge here. When the report opens, the page requests one tiny file from jsDelivr, pinned to the version that wrote the report:

```text
https://cdn.jsdelivr.net/gh/lsd-consulting/lsd-mono@<version>/ping/<event>.txt
```

- **Events.** `report-open` when a report or the index page opens. `source-junit`, `source-cucumber` or `source-api` for the integration that wrote the report. `metrics-open` when the Metrics view is opened, and `components-open` when a scenario's Components view is shown. Each event is one file under [`ping/`](../ping) and is requested at most once per page load.
- **What is sent.** Only the request: the version and the event, in the path. There is no query string, cookie or referrer, and no report title, scenario data or ids. Like any request, it shows jsDelivr your IP address and browser User-Agent ([jsDelivr's privacy policy](https://www.jsdelivr.com/terms/privacy-policy)). We only read jsDelivr's public totals per file and version.
- **The report doesn't depend on it.** The request is never awaited and a failure is ignored, so a report opened offline, from `file://`, or behind a proxy or Content-Security-Policy that blocks jsDelivr works and looks the same.
- **Turn it off** with `lsd.mono.report.usagePing=false`, set like any other [property](../README.md#configuration) (for example `LSD_MONO_REPORT_USAGEPING=false`). The setting is written into the report, and `false` means the page makes no request at all.

Snapshot builds, the report UI's dev server and checks, and the sample reports this repository publishes never ping.
