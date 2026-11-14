# Diagram fixtures

These small PlantUML files are copied without modification from the owner's
read-only Architecture repository at `C:/Users/tuy_2/Desktop/Work/Architecture`:

- `TokenFlow.puml`: `Pos/TokenFlow.puml` (sequence and skin parameters).
- `HealthProbing.puml`: `Gateway/HealthProbing.puml` (nested loops and alternatives).
- `PublishAfterCommit.puml`: `Messaging/PublishAfterCommit.puml` (database and alternatives).
- `HrOverview.puml`: `HR/Overview.puml` (components, database, and queue).

`fake-renderer.cjs` replaces only the Java process for offline end-to-end tests.
It reads the diagram from stdin and writes a deterministic SVG. The sentinel
`DAWSHA_TEST_ERROR` produces a line 3 error for editor navigation coverage.
Simple relative `!include` directives load their local file so watcher and
cache invalidation tests can observe changes to included diagram text.
