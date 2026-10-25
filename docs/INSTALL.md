# Installing Chista

## Install on another computer

Copy an installer built for the destination computer's operating system and processor.

| System | Installation |
| --- | --- |
| macOS | Open the `.dmg` and drag **Chista** into **Applications**. |
| Windows | Run the `.exe` installer. |
| Linux | Install the `.deb` package or run the `.AppImage`. |

The verified build is currently **macOS on Apple Silicon (M1 or newer)**. Windows, Linux, and Intel Mac builds have not been verified. Prebuilt downloads are not published on GitHub yet.

Current Mac builds are not Developer ID signed or notarized, so macOS may block first launch. Production distribution needs Apple signing and notarization.

## Set up an agent

Install Codex or Claude Code on the destination computer and complete its native sign-in. Alternatively, configure a hosted chat-completions provider in **Settings → Models**. End users do not need Node.js or Rust when installing a built package.

Codex MCP uses that computer's CLI configuration. HTTPS and loopback HTTP servers are supported; local services must be running. Stdio servers and Claude MCP are not supported yet.

Workspaces and CLI credentials are not transferred with the installer. Add the new computer's repo folders in Workspace config.

## Build an installer

On the target operating system, install Node.js, Rust, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), then run:

```sh
git clone https://github.com/hadiranjbar25/chista.git
cd chista
npm ci --ignore-scripts
npm run tauri build
```

Packages are written to `src-tauri/target/release/bundle/`. Build for the destination processor architecture; the current Apple Silicon package does not run on Intel Macs.

See [Tauri distribution](https://v2.tauri.app/distribute/) for platform packaging and signing.
