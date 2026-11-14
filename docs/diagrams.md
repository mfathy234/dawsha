# Diagrams in Files

Implementation details, dependency pins and real-world checks are documented in
[Diagram rendering implementation](diagram-rendering.md).

Files draws PlantUML (`.puml`, `.plantuml`, `.pu`, and `.iuml`) and Mermaid
(`.mmd`) diagrams. Markdown previews also draw `plantuml` and `mermaid` fenced
blocks, including the `::: mermaid` form used by architecture wiki pages.

Choose **Source** to read or edit a diagram and **Diagram** to return to its
preview. Markdown blocks have their own Source button. Saved edits and file
changes refresh the preview. A rendering error keeps the source readable;
PlantUML errors offer a line button that opens the corresponding editor line.

The preview starts fitted to its available width. Use **+**, **−**, or
**Ctrl + mouse wheel** to zoom. Drag a zoomed diagram to pan, and use **Fit** or
**Ctrl+0** to return to its fitted size. PlantUML keeps its original colors on a
light background, including when the app uses a dark theme.

Right-click the file or open the command palette for **Copy diagram as SVG** and
**Save diagram as…**. The save dialog supports SVG and PNG. Copying SVG produces
text that can be pasted into an SVG file or another tool that accepts SVG.

## Local PlantUML setup

PlantUML requires Java. When Java is missing, Files shows the source and a link
to Microsoft's OpenJDK download page.

On the first PlantUML preview, Dawsha offers a one-time download of the MIT
PlantUML jar. The download starts only after choosing **Download**, is checked
against a pinned SHA-256 checksum, and is stored in Dawsha's user data folder.
To use an existing jar, enter its path under **Settings > General > PlantUML**.
The path is saved in app settings and survives restarting Dawsha.

Rendering runs on the local computer. Diagram source is never sent to a remote
renderer. Java runs from the diagram's folder so relative local includes can be
resolved, and the bundled Smetana layout removes the need to install Graphviz.
Remote includes are unavailable. Dawsha limits rendering time, input size, and
the on-disk preview cache.

## Mermaid

Mermaid is bundled with Dawsha and loads when a Mermaid preview is needed.
Its theme follows the app's light or dark theme. It renders in strict security
mode, and the resulting SVG is displayed as an inert image. Remote images,
rich node metadata (`@{...}`), sequence `properties`/`details`, custom CSS
resources, and Mermaid configuration directives are rejected before rendering.
These forms can hide image references inside parsed metadata. Ordinary graph
styles and local labels are supported; external resources remain unavailable.

## Offline development checks

The end-to-end diagram tests use
`tests/fixtures/diagrams/fake-renderer.cjs` through
`DAWSHA_PLANTUML_FAKE_RENDERER`. This substitutes only the Java process and
requires no network, Java installation, or downloaded jar. The fixtures also
contain four small diagrams copied from the owner's Architecture repository.

Run the focused checks after building:

```powershell
npx playwright test tests/e2e/diagrams.spec.ts --workers=1
```
