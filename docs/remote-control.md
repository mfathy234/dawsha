# Remote control

Dawsha Remote Control is a **BETA** feature in the public 0.5.x release. It connects a paired browser to the Dawsha app running on your computer; Dawsha does not host your projects or sessions. Remote Access is off until you turn it on in Settings.

## Start Remote Control

On the computer running Dawsha, open **Settings → Remote Access** and choose **Start Remote Access**. Dawsha starts a loopback listener and a temporary Cloudflare Quick Tunnel. If a compatible cloudflared is not already on PATH, Dawsha downloads the matching official Cloudflare release, verifies its SHA-256 digest, and installs it in the app-data folder. First setup needs internet access to Cloudflare's GitHub release service; it does not use a package manager, change PATH, or require administrator access.

Open the displayed HTTPS URL on the browser you want to pair, enter the one-use code from Dawsha, and approve pairing. The code expires after five minutes and can only be used once; paired browsers expire after 30 days. You can revoke a browser from the device list in Settings. Stop Remote Access to close the listener and stop Dawsha's tunnel process. The temporary URL changes each time it starts.

Remote access starts read-only. Terminal input and session start/resume each have a separate permission and remain off until enabled in Settings. Session access follows the agent's existing **Start with full access** preference, including any elevated permissions configured for local sessions.

## Network and privacy limits

Quick Tunnels are intended for development and testing, and this feature remains beta. The URL is public-facing while active, so share it only with the browser you are pairing. Cloudflare terminates browser HTTPS and can process proxied traffic; this is neither end-to-end encrypted nor peer-to-peer. Pairing and the separate permissions still apply. The optional Cloudflare email PIN adds a gate, but there is an [open report of PIN sessions expiring before follow-up requests](https://github.com/cloudflare/cloudflared/issues/1752).

Tunnel hostnames can take time to appear in DNS or may be unavailable on a particular network. Dawsha waits briefly for DNS before showing the tunnel as ready. If setup reports that the DNS name is not reachable, Remote Access stays off; wait a little, try again, or use a network that can resolve Cloudflare Quick Tunnel hostnames. If the page shows a pairing error or a stale URL, stop and restart Remote Access, then pair again with the new URL and code.

### Troubleshooting Remote Control

- **Cloudflare Tunnel could not be installed:** check internet access to GitHub and try Start again. Dawsha verifies the release digest before running or replacing a managed executable.
- **A PATH copy is not compatible:** update Cloudflare Tunnel or remove the incompatible copy from PATH; Dawsha then installs its verified app-local copy.
- **The Quick Tunnel does not start or DNS is unavailable:** keep Dawsha open, wait briefly, and try again. If the hostname still does not resolve, use another network. A failed setup leaves Remote Access off.
- **The pairing code expired or was already used:** generate a fresh code in Settings.
- **The page cannot connect:** keep Dawsha running and open the current HTTPS address shown in Settings. A restart creates a new URL.
- **Controls are missing:** check the separate terminal-input and session-control permissions in Settings.
- **The Remote Access tab is missing:** update to a public build that includes Remote Control.

### Remote browser workspace

The paired browser opens a workspace with **Sessions** and **Projects** views. Sessions shows running terminals and recent resumable sessions across Claude, Codex, and Gemini, labeled by agent and project. Choose a recent session to resume it with the agent that created it. The Projects view shows configured projects and their default agents; **New session** lets you choose both a project and an installed agent before starting. Session creation and resume require the separate session-control permission. When that permission is off, the browser remains read-only and hides session controls. Terminal input has its own permission. The browser layout adapts to phone screens, while host-only tools remain in the desktop app.

## Use the local CLI on Windows

The local command-line interface works independently of Remote Control. It can open the desktop app, manage projects, and start or resume sessions on the same computer. It does not stream terminals or provide interactive terminal input over the network.

1. Install the Windows setup build, `Dawsha-Setup-0.5.0.exe`, on Windows 10 or 11 (x64). The installer adds its installation directory to your user PATH.
2. Open a new PowerShell or Command Prompt window so it picks up the updated PATH.
3. Check the launcher:

   ```powershell
   dawsha --version
   dawsha --help
   ```

4. Open Dawsha and list your projects:

   ```powershell
   dawsha open
   dawsha ls
   ```

The launcher connects to the desktop app. If it cannot connect, it attempts to start the app and retries for up to 30 seconds. Normal commands bring the desktop window to the front; this is not a headless service.

Starting or resuming an agent requires that agent to be installed and configured on this computer. Use Dawsha's **Agents** view to check installation status. The launcher itself uses the bundled executable and does not require a separate Node.js installation.

The portable build does not add `dawsha` to PATH. These setup steps describe the Windows installer; the macOS package does not install the Windows command launcher.

## Available commands

These examples run locally. Replace the sample folder and project name with your own.

| Command | Effect |
| --- | --- |
| `dawsha` or `dawsha open` | Open Dawsha or bring it to the front. |
| `dawsha ls` | List projects, their folders, default agents, and open session counts. |
| `dawsha add "C:\work\my-project" --name "My project"` | Add a project. |
| `dawsha .` | Add the current folder if necessary and start its default agent. |
| `dawsha start "My project" --agent codex` | Start Codex in an existing project. Agent choices are `claude`, `codex`, and `gemini`. |
| `dawsha start "My project" --here` | Start a tab in the focused pane when it belongs to that project; otherwise start a new pane. |
| `dawsha sessions "My project"` | List earlier sessions for a project. Omit the name to list across projects. |
| `dawsha resume "My project"` | Open the desktop resume picker for that project. |
| `dawsha resume "My project" --last --agent claude` | Resume the newest matching Claude session, or focus it if already open. |
| `dawsha layouts` | List saved layouts. |
| `dawsha open "My layout" --alongside` | Open a saved layout while keeping current panes. |
| `dawsha open "My layout" --replace` | Stop current sessions and replace their panes with a saved layout. |
| `dawsha update-agents` | Start the installed-agent update workflow in the app. |

Opening a layout without `--alongside` or `--replace` can require a choice in the desktop app when panes are already open. These commands do not expose a remote shell or an API for sending prompts into running terminals.

## What `DAWSHA_PIPE` means

The local CLI server starts automatically with Dawsha. On Windows, the default endpoint is a named pipe of the form `\\.\pipe\dawsha-<username>`, with unsupported username characters replaced by underscores.

`DAWSHA_PIPE` is an environment-variable override for that endpoint path. Both the app and launcher must use the same value to communicate. It is not a remote-control toggle and does not configure a TCP host, port, HTTP address, or WebSocket server. Normal installations should leave it unset.

There is no Settings switch to enable or disable this local CLI server. It closes when the app quits.

## Security and access from another device

The CLI protocol has no application-level authentication token, pairing handshake, or permission prompts for each command. It relies on access to the operating-system IPC endpoint. The username in the pipe name is a naming convention, not an authentication check implemented by Dawsha. A client that can connect can invoke the supported commands, including starting agents, replacing a layout, and initiating agent updates.

New sessions use your configured **Start with full access** setting. Its defaults are on for Claude Code and Codex, and off for Gemini. With the standard agent launch commands, full access bypasses the agent's approval prompts; for Codex it also bypasses the sandbox. Review that setting before allowing anyone else to operate your desktop or automation environment.

Do not expose or bridge the CLI endpoint as a public network service. Remote Access is separate from this CLI endpoint; it does not add authentication, encrypted transport, or access controls to the local IPC protocol. Adding a firewall rule or changing `DAWSHA_PIPE` does not supply those features.

If you need access from another device today, use a separately configured remote-desktop solution to operate the existing desktop app. That solution supplies authentication and transport security; Dawsha has no integration or setup controls for it. Remote features offered by individual agent tools are also separate from Dawsha.

## Troubleshooting the local CLI

- **`dawsha` is not recognized:** open a new terminal after installing the Windows setup build. Check that its installation directory is on your user PATH. The portable build does not configure PATH.
- **“Dawsha did not start in time”:** open the desktop app directly, wait for it to load, and retry. If you set `DAWSHA_PIPE`, check that the app and launcher inherited the same value, or remove the override and restart both.
- **“Dawsha is still starting” or “Dawsha did not answer in time”:** the command depends on the desktop app being ready and responsive. Wait for startup or resolve any open app interaction, then retry.
- **“No project named …”:** run `dawsha ls` to see configured names, or use `dawsha add` with the folder path.
- **No Remote Access option appears in Settings:** update to a public build that includes Remote Control.

## Implementation references

The local CLI references describe the 0.4.0-era implementation. Remote-control implementation:

- [Private-build flag and scripts](../src/shared/remoteBuild.ts), [Cloudflare Quick Tunnel adapter](../src/main/cloudflareQuickTunnel.ts), [pairing/auth](../src/main/remoteAuth.ts), [HTTP and WebSocket server](../src/main/remoteServer.ts), and [settings controller](../src/main/remoteAccessController.ts)
- [Remote browser page](../src/renderer/remote.html) and [Remote Access controls](../src/renderer/components/settingsView.ts)

Local CLI implementation:

- [Local CLI server and endpoint selection](../src/main/cliServer.ts)
- [Desktop startup and CLI server lifecycle](../src/main/index.ts)
- [CLI launcher](../build/dawsha-cli.cjs) and [Windows launcher wrapper](../build/dawsha.cmd)
- [Windows installer PATH registration](../build/installer.nsh) and [packaging configuration](../electron-builder.yml)
- [Command parser and supported operations](../src/shared/cli.ts)
- [Desktop readiness and command handling](../src/main/cliRunner.ts)
- [Settings and full-access defaults](../src/shared/settingsSchema.ts) and [agent launch behavior](../src/main/agentLaunch.ts)
