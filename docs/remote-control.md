# Remote control

Dawsha v0.4.0 does **not** implement built-in remote control from another computer, phone, or browser. There is no remote-control setting to enable, network port to open, pairing code, or remote client to configure.

What Dawsha provides is a **local command-line interface on Windows**. It can open the desktop app, manage projects, and start or resume sessions on the same computer. It does not stream terminals or provide interactive terminal input over the network.

## Use the local CLI on Windows

1. Install the Windows setup build, `Dawsha-Setup-0.4.0.exe`, on Windows 10 or 11 (x64). The installer adds its installation directory to your user PATH.
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

Do not expose or bridge the CLI endpoint as a public network service. Dawsha currently has no remote authentication, encrypted remote transport, access-control configuration, or remote session UI. Adding a firewall rule or changing `DAWSHA_PIPE` does not supply those features.

If you need access from another device today, use a separately configured remote-desktop solution to operate the existing desktop app. That solution supplies authentication and transport security; Dawsha has no integration or setup controls for it. Remote features offered by individual agent tools are also separate from Dawsha.

## Troubleshooting the local CLI

- **`dawsha` is not recognized:** open a new terminal after installing the Windows setup build. Check that its installation directory is on your user PATH. The portable build does not configure PATH.
- **“Dawsha did not start in time”:** open the desktop app directly, wait for it to load, and retry. If you set `DAWSHA_PIPE`, check that the app and launcher inherited the same value, or remove the override and restart both.
- **“Dawsha is still starting” or “Dawsha did not answer in time”:** the command depends on the desktop app being ready and responsive. Wait for startup or resolve any open app interaction, then retry.
- **“No project named …”:** run `dawsha ls` to see configured names, or use `dawsha add` with the folder path.
- **No remote-control option appears in Settings:** expected in v0.4.0; this feature is not implemented.

## Implementation references

This document describes the v0.4.0 repository implementation:

- [Local CLI server and endpoint selection](../src/main/cliServer.ts)
- [Desktop startup and CLI server lifecycle](../src/main/index.ts)
- [CLI launcher](../build/dawsha-cli.cjs) and [Windows launcher wrapper](../build/dawsha.cmd)
- [Windows installer PATH registration](../build/installer.nsh) and [packaging configuration](../electron-builder.yml)
- [Command parser and supported operations](../src/shared/cli.ts)
- [Desktop readiness and command handling](../src/main/cliRunner.ts)
- [Settings and full-access defaults](../src/shared/settingsSchema.ts) and [agent launch behavior](../src/main/agentLaunch.ts)
