# Diagram rendering implementation

For preview controls and setup, see [Diagrams in Files](diagrams.md).

## Managed PlantUML binary

Dawsha pins the [official PlantUML MIT 1.2025.4 release](https://github.com/plantuml/plantuml/releases/tag/v1.2025.4), asset `plantuml-mit-1.2025.4.jar`:

- Download: `https://github.com/plantuml/plantuml/releases/download/v1.2025.4/plantuml-mit-1.2025.4.jar`.
- Size: 12,967,352 bytes, shown as about 13 MB.
- SHA-256: `cb8bca6301c114eb66c6e6c55b4cd1962f380616c622e964596a24f94246bc41`.

The digest and size come from GitHub's official release asset metadata. Both are checked before the temporary download becomes `<userData>/diagrams/plantuml-mit-1.2025.4.jar`. Failed or incomplete downloads are deleted. Opening a preview never starts the download automatically. Only the Download button requests this public binary, without diagram text.

Java 8 or newer is required. Detection tries `JAVA_HOME/bin/java` (`java.exe` on Windows), then `java` on `PATH`, checking `java -version`. Microsoft OpenJDK 21.0.9 was used for the real-world checks below.

Jar selection uses `settings.plantumlJarPath`, then `DAWSHA_PLANTUML_JAR`, then the managed download. User-selected existing jars are not checked against the managed release's digest. A missing configured jar is reported separately so the preview can direct the user to correct its path.

## Process and data boundaries

The local Java child receives UTF-8 diagram text on stdin through `spawn` with `shell: false`, headless mode and `-tsvg -pipe -charset UTF-8 -Playout=smetana`. Smetana removes the Graphviz installation requirement. The working directory is the diagram's directory, resolving relative includes within the opened project.

Dawsha forces PlantUML's [ALLOWLIST security profile](https://plantuml.com/security). The opened project is the local-file allowlist, the diagram's directory is the include search path, and the URL allowlist is empty. Inherited PlantUML properties and JVM option environment variables are removed so inherited configuration cannot enable remote includes. Source text is never sent to a remote rendering service.

A process-wide queue runs one diagram child at a time. New pending work replaces older work with the same absolute file path and optional Markdown fence source line. Different fences in one file have independent slots. A running render is allowed to finish or is killed at its deadline; its obsolete result is discarded. Rendering has a 20-second deadline, a 1 MiB UTF-8 input limit and an 8 MiB combined stdout/stderr limit. PlantUML's zero-based pipe error index is converted to a one-based editor line.

## SVG isolation

`@xmldom/xmldom` is pinned to 0.9.12 under the [MIT license](https://github.com/xmldom/xmldom/blob/master/LICENSE). Its [documented XML parser and serializer](https://github.com/xmldom/xmldom#usage) are used in both the main process and renderer. The sanitizer rejects DTDs, entity declarations and malformed XML rather than repairing them.

The sanitizer creates a fresh SVG document from allowlisted static SVG elements and attributes. It drops foreign namespaces, namespace declarations, scripts, animation, foreign objects, event attributes and unknown attributes. Link attributes are checked by namespace URI rather than prefix spelling, and copied using a canonical name. Only safe fragment references and raster image data URLs remain. Styles reject CSS comments, escapes, at-rules, external resource URLs and resource-loading functions. Safe Mermaid theme rules and fragment references used by SVG markers are preserved. Previews additionally display SVG through an inert image URL, never by inserting SVG markup into the application document.

## Cache

Entries live at `<userData>/diagrams/cache`. SHA-256 keys include source text, diagram directory, PlantUML version, jar path, jar size and modification time. The disk cache is capped at 128 entries and 64 MiB, pruning older entries after successful writes. Each entry remains subject to the 8 MiB output cap. Diagrams containing preprocessor directives, including `!include`, or file/environment-reading functions bypass the cache. Changes to a relative include are therefore reflected in the next render.

## Offline renderer protocol

`DAWSHA_PLANTUML_FAKE_RENDERER` accepts an absolute Node script path only when `DAWSHA_USER_DATA` is set, as it is in isolated test sandboxes. It substitutes the Java child, reports Java and the jar as available, and needs no download.

- Executable: Dawsha's executable with `ELECTRON_RUN_AS_NODE=1`.
- Argument 1: absolute opened-project folder.
- Argument 2: absolute diagram file path.
- Working directory: the diagram file's directory.
- Standard input: full UTF-8 source text.
- Success: exit zero and an SVG document on stdout.
- Failure: exit nonzero and a diagnostic on stderr. `Error line 3: message` uses a one-based line; native PlantUML `ERROR\n2\nmessage` uses a zero-based index.

`tests/fixtures/diagrams/fake-renderer.cjs` implements this protocol.

## Real-world verification

On 2026-11-14, Microsoft OpenJDK 21.0.9 rendered these read-only Architecture repository files through the production `DiagramService`, using the downloaded and hash-verified jar. Cold-cache times include Java detection, startup, rendering, SVG filtering and cache write:

| Architecture file | Result | Time |
| --- | --- | --- |
| `System/SystemOverview.puml` | SVG, component overview | 1,219 ms |
| `Tenancy/SharedVsDedicated.puml` | SVG, database overview | 1,241 ms |
| `Workflow/ApproverResolution.puml` | SVG, sequence diagram | 1,418 ms |
| `Workflow/ApproverActs.puml` | SVG, sequence diagram | 1,267 ms |
| `System/RequestFlow.puml` | SVG, sequence diagram | 1,178 ms |

The binary download took 1,519 ms. A local `!include participant.iuml` probe rendered successfully. An `!includeurl` to a loopback URL was rejected with `Cannot open URL`. An invalid third source line confirmed the CLI index needs conversion before jumping to the editor. All five saved real SVG outputs were also passed through the namespace-aware sanitizer after its hardening. The Architecture repository was never modified.
