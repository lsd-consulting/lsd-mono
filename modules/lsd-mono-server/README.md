# LSD server (early scaffold)

Part of [LSD: living sequence diagrams](../../README.md). Tracked in
[#186](https://github.com/lsd-consulting/lsd-mono/issues/186).

A local server you start yourself, to import, keep, compare and watch LSD reports. It is a
Node package, so it works without a JVM. **This is a scaffold:** the routes and pages exist, most
of what they do is still a `TODO(#186)`, and it is not published anywhere yet (`"private": true`).

## Run it

Needs the Node version in the repo's `.nvmrc`.

```sh
cd modules/lsd-mono-server
nvm use
npm install
npm start                          # http://127.0.0.1:7357
npm start -- --port 8080           # another port (or LSD_SERVER_PORT=8080)
npm start -- --expose              # every interface (or LSD_SERVER_EXPOSE=1)
```

`npm test`, `npm run lint` and `npm run typecheck` are what CI runs.

## What is there

| Path                            | What                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `GET /`                         | The UI shell: import a file, the report list, delete per report, bulk delete (not wired yet) |
| `GET /health`                   | `ok`                                                                                         |
| `GET /api/reports`              | The report index, newest first: `id`, `title`, `importedAt`, `source`, `size`                |
| `GET /api/reports/<id>`         | One stored report's JSON                                                                     |
| `POST /api/reports/import`      | Import an LSD report (201 with its index entry) or OTLP JSON (501 until #96)                 |
| `DELETE /api/reports/<id>`      | Delete one report                                                                            |
| `POST /api/reports/bulk-delete` | Delete several reports: see below                                                            |
| `GET /api/diff`                 | 501 for now: side-by-side diff of two reports                                                |
| `ws://…/ws/captures`            | Real-time captures: sends a `hello` and ignores messages for now                             |

## Storage

Each report is `<id>.json` in the reports directory, next to an `index.json` that the report list
reads, so listing never opens the reports. Each entry holds the `id`, the report's `title` (or
"Untitled report"), `importedAt` (ISO-8601), `source` (`import`, later `capture`) and `size` in
bytes. The index is replaced whole via a temp file and a rename, and writes are queued. A reports
directory without an index gets one rebuilt from its report files.

## Bulk delete

`POST /api/reports/bulk-delete` with `{"ids": ["…", "…"]}` (1 to 1000 ids):

| Status | When                               | Body                                    |
| ------ | ---------------------------------- | --------------------------------------- |
| 200    | At least one report was deleted    | `{"deleted": [...], "notFound": [...]}` |
| 404    | None of the ids exist              | `{"deleted": [], "notFound": [...]}`    |
| 400    | The body is not JSON of that shape | A plain-text reason                     |

Duplicate ids count once.

## Decisions (#186)

1. **Secure by default.** Binds to `127.0.0.1`. Only `--expose` (or `LSD_SERVER_EXPOSE=1`) binds every interface.
2. **Import** takes exported LSD report JSON and OTLP JSON telemetry exports. Both land as stored reports.
3. **Storage** is a directory the server owns, hard-coded to `~/.lsd/server/reports` for v1.
4. **No access control** yet. It comes later, after the expose flag.
5. **Cleanup is manual:** delete per report and bulk delete. No maximum count, no auto-expiry.
6. **Real-time captures** use a WebSocket interface defined by its protocol, not by any capture
   library. A Ktor filter pointed at the server is one example of a client. The message shape is
   still to settle (#152).
