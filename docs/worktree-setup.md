# Worktree setup

In **New session**, select **Use its own worktree** to give the session a separate checkout. **Worktree setup…** is available there and in a project's menu in Projects.

## Local files

Put patterns in `.worktreeinclude` in the repository's main checkout:

```gitignore
# Local configuration, copied independently into each new worktree
.env
.env.*
!.env.example
appsettings.user.json
config/*.local.*
```

Patterns use `.gitignore` matching, including comments, directory patterns, wildcards and `!` exclusions. Dawsha copies matching **Git-ignored** files; tracked files already come from Git. Include a private key explicitly if you need it. Keys are never suggested automatically.

Without this file, New session can suggest ignored local configuration once per project. **Save as .worktreeinclude** saves the displayed paths; **Not now** remembers the dismissal. Both choices can be changed from Worktree setup.

Files are copied, never linked. Links that leave the repository are rejected, and existing files in the destination are not overwritten. A copy is limited to 50 MB. Dependency and build directories such as `node_modules`, `bin`, `obj`, `.venv`, `dist`, `target` and `vendor` are skipped. The scan is bounded; a project that exceeds the scan limits reports the problem instead of making a partial worktree.

## Setup commands

The setup editor suggests commands from lockfiles and manifests, including nested projects. Choose the commands you need, edit them, or leave the field empty to skip setup. Commands are saved in Dawsha's project settings. Repository comments never become executable setup commands.

Commands run in the new session's terminal before its agent starts. On Windows they use Command Prompt. Enter one command per line; each starts from the new worktree's root. A failed command stops setup and leaves its output visible. **Retry** runs setup again; **Start the agent anyway** explicitly skips the failure.

The same preparation applies to new sessions, presets, comparisons, Try another way, and other Dawsha-created worktrees. Existing worktrees are not prepared again just because another terminal opens in them.
