# Installing Chista

Use this guide to install a packaged app, connect an agent, or build an installer from source.

- [Install on another computer](#install-on-another-computer)
- [Set up an agent](#set-up-an-agent)
- [Build an installer](#build-an-installer)
- [Troubleshooting](#troubleshooting)
- [Data stored on this computer](#data-stored-on-this-computer)

## Install on another computer

Copy an installer built for the destination computer's operating system and processor.

| System  | Installation                                               |
| ------- | ---------------------------------------------------------- |
| macOS   | Open the `.dmg` and drag **Chista** into **Applications**. |
| Windows | Run the `.exe` installer.                                  |
| Linux   | Install the `.deb` package or run the `.AppImage`.         |

Download installers from [GitHub Releases](https://github.com/hadiranjbar25/chista/releases). The release workflow builds a universal macOS `.dmg` for Apple Silicon and Intel, and a Windows x64 setup `.exe`. Each release includes `SHA256SUMS.txt` for checking downloaded files.

The verified runtime is currently **macOS on Apple Silicon (M1 or newer)**. Windows, Linux, and Intel Mac runtime behavior has not been verified on physical hardware. A successful installer build does not establish full platform support.

Current Mac builds are not Developer ID signed or notarized, so macOS may block first launch. Production distribution needs Apple signing and notarization.

## Set up an agent

Install Codex or Claude Code on the destination computer and complete its native sign-in. Alternatively, configure a hosted chat-completions provider in **Settings → Models**. End users do not need Node.js or Rust when installing a built package.

1. Open **Settings → Models** and choose the active agent.
2. For Codex or Claude Code, expand its settings and use the installation check. If automatic detection fails, enter the absolute path to the installed executable. Complete the CLI's native sign-in when prompted.
3. For a hosted provider, enter an HTTPS chat-completions endpoint, model identifier, and API token, then select **Use hosted provider**. Configuration is kept in memory for this app run. The first request verifies access; saving the settings alone does not test connectivity.
4. Open **Workspace config**, add a repository folder, and start a **New session**. Attach evidence with **Add files**, inspect **Files & mappings**, and send a question.

Choose a model beside the agent selector in chat or under **Settings → Models**. Model choices load automatically from the selected CLI when Chista opens or you change agents or executable paths, without sending a chat message. The picker shows a loading state until the correct catalog is ready. Use **Refresh models** in Settings to reload the list, or **Custom model…** to enter a provider-specific ID. **CLI default model** uses the CLI’s configured default. Each agent remembers its selection for this app run. Changing models updates the existing native connection without replaying instructions, conversation history or attached evidence; the selected model is shown in outgoing request previews.

Claude Code and Codex offer the same in-app capabilities: streaming conversation, reviewed attachments, interactive response blocks, HTTP API requests, and MCP tools with approval, sanitized evidence and connection status. Both support configured stdio servers and HTTPS or loopback HTTP MCP connections. Local services must be running. Servers come from each CLI's user configuration; project and plugin configurations are not loaded in the isolated chat directory. Use the **Sign in** button in the top-right MCP connections list to open the selected CLI's native MCP login. When you return after login, Chista refreshes the server connection and available tools. **Refresh connections** reloads the list manually. Refreshing does not send a chat message or replay the conversation. Each tool call requires approval even when message preview is off. Claude MCP transport failures end the turn before an unsanitized native error can reach the model. For a complete example, follow the [access-investigation guide](INVESTIGATION.md).

Claude chat preserves connection-related settings from your user `settings.json`, including the configured model, provider environment, proxies, certificates and credential helper. It passes these privately to both the sign-in check and chat process; tool permissions, hooks and plugins remain managed by Chista. A successful sign-in check confirms authentication, not that the provider will accept a model request. Errors identify known provider, model, access, limit and network failures without echoing raw provider output. A failed request may already have delivered sanitized context; Chista does not automatically resend it.

Workspaces and CLI credentials are not transferred with the installer. Add the new computer's repo folders in Workspace config.

Selected repository folder names are included as sanitized chat metadata, so the agent can answer which repository is selected. Full paths, internal repository IDs, and repository files remain local. Changing the repository selection updates its metadata in the existing CLI conversation.

Agent responses restore known placeholders using the workspace's local mask mapping for display, including streamed text and interactive response content. The model receives masked values; conversation history, file exports, and tool results remain sanitized. Unknown placeholders stay unchanged. Restored values are sanitized again if used in a follow-up message.

### Sending messages and calling APIs

**Review before sending** is off by default. Messages send immediately after local sanitization; turn the checkbox on when you want an outgoing-message preview. API and MCP tool approvals are separate and remain required.

After submission, the composer clears the sent message and file chips immediately. The imported files remain in **Files & mappings**, and the CLI retains their delivered context for follow-ups. Sending an empty composer does not resend previously submitted attachments. New debug sessions can still use the workspace's files.

Codex and Claude Code keep a native CLI session for each debug conversation. Initial instructions, conversation history, and attached evidence are sent when that session starts. Follow-ups send only the next message. Switching views keeps a running response and its native connection alive. Use Stop to cancel it. Changing attachments sends a replacement evidence snapshot in the same session; an unchanged snapshot is not sent again. Recoverable provider errors and acknowledged Stop requests keep the native conversation; the next message does not replay the earlier prompt. Changing the agent or executable, losing the process, or failing to interrupt a turn cleanly requires a new native connection and a one-time replay of the sanitized history. Hosted chat-completions providers are stateless and still receive the required conversation on every request.

With **Claude Code or Codex**, ask for an HTTP(S) API call or a curl request. Chista exposes `chista_http_request`, which uses your computer's curl executable. Review the method, URL, headers, and text body in **Approve API request**, then approve once or deny. **Stop** cancels the running request. HTTP error statuses such as 403 are returned as evidence rather than invented successes.

This API tool supports GET, HEAD, POST, PUT, PATCH, DELETE, and OPTIONS, with a 30-second curl timeout and a 1 MB response limit. It does not follow redirects, read local files, load curl configuration files, or run arbitrary shell commands. JSON/text responses pass through the workspace sanitizer before reaching either agent; non-text responses are omitted. It works without configuring an MCP server. Install curl separately if it is missing from your system.

Sensitive placeholders in approved URLs, headers, and bodies are sent exactly as shown. Chista does not reverse placeholders into original credentials or identifiers, so a masked credential will not authenticate a request. Both Claude Code and Codex expose this API tool with the same approval and sanitization flow. Hosted providers do not expose tools.

## Build an installer

Build installers on their destination operating system. The Tauri build command builds the frontend automatically before compiling and packaging the desktop app; `npm run build` alone only builds the frontend.

### Prerequisites

Install Git, Node.js with npm, and Rust with Cargo through `rustup`. Install the platform dependencies in the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/):

| Build computer | Additional requirements                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| macOS          | Xcode Command Line Tools (`xcode-select --install`), or full Xcode.                                                                      |
| Windows        | Visual Studio Build Tools with **Desktop development with C++**, Microsoft Edge WebView2, and the Rust MSVC toolchain.                   |
| Linux          | Your distribution's WebKitGTK and native development packages listed in the Tauri guide. Linux builds have not been verified for Chista. |

Check the tools in a new terminal after installation:

```sh
node --version
npm --version
rustc --version
cargo --version
```

### Get the source

For a fresh checkout:

```sh
git clone https://github.com/hadiranjbar25/chista.git
cd chista
npm ci --ignore-scripts
```

If you already have the repository, open its root folder and run `npm ci --ignore-scripts`. Run all build commands below from that folder. The first build downloads Rust dependencies and can take several minutes.

### Choose a package

| Package                                | Build on  | Command                                 | Output directory                        |
| -------------------------------------- | --------- | --------------------------------------- | --------------------------------------- |
| macOS disk image                       | macOS     | `npm run tauri build -- --bundles dmg`  | `src-tauri/target/release/bundle/dmg/`  |
| Windows setup executable               | Windows   | `npm run tauri build -- --bundles nsis` | `src-tauri/target/release/bundle/nsis/` |
| All configured formats for the host OS | Target OS | `npm run tauri build`                   | `src-tauri/target/release/bundle/`      |

These output paths assume the default Rust target directory and no explicit `--target` option. Share the resulting installer with users; they do not need the source checkout or build tools.

### macOS disk image (`.dmg`)

Build on a Mac with Xcode Command Line Tools installed:

```sh
npm run tauri build -- --bundles dmg
```

The disk image is written to `src-tauri/target/release/bundle/dmg/`. Open it and drag **Chista** into **Applications** to install.

The build targets your Mac's processor by default. Build for the destination processor architecture; an Apple Silicon package does not run on Intel Macs. See the [Tauri DMG guide](https://v2.tauri.app/distribute/dmg/).

To create one disk image for both Apple Silicon and Intel, install both Rust targets and build a universal binary:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri build -- --target universal-apple-darwin --bundles dmg
```

Its output is in `src-tauri/target/universal-apple-darwin/release/bundle/dmg/`. Universal and Intel builds still need validation on their destination hardware. See the [Tauri macOS distribution guide](https://v2.tauri.app/distribute/macos-application-bundle/).

For public distribution, configure [Apple Developer ID signing and notarization](https://v2.tauri.app/distribute/sign/macos/). Current builds do not configure these, so macOS may block first launch.

### Windows installer (`.exe`)

Build on Windows with Visual Studio Build Tools and the **Desktop development with C++** workload installed, in addition to Node.js and Rust:

```sh
npm run tauri build -- --bundles nsis
```

The setup executable is written to `src-tauri/target/release/bundle/nsis/`. Run the resulting `.exe` to install Chista.

Use a Windows computer or a Windows CI runner, such as GitHub Actions, for this build. Cross-compiling from macOS requires additional tools and has limitations. See the [Tauri Windows installer guide](https://v2.tauri.app/distribute/windows-installer/).

### Other package formats

To build all configured package formats supported by the build computer's operating system, run:

```sh
npm run tauri build
```

Packages are written to `src-tauri/target/release/bundle/`.

See [Tauri distribution](https://v2.tauri.app/distribute/) for platform packaging and signing.

## Troubleshooting

| Symptom                                                        | What to check                                                                                                                                                                                                                          |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cargo` or `rustc` is not found                                | Install Rust through `rustup`, then reopen the terminal.                                                                                                                                                                               |
| A compiler, linker, or WebKit dependency is missing            | Complete the prerequisites for the build computer's OS. On Windows, use the MSVC Rust toolchain and install the C++ workload.                                                                                                          |
| `failed to run light.exe` on Windows                           | The all-formats build also creates an MSI, which requires the Windows VBSCRIPT optional feature. Use `--bundles nsis` if you only need the `.exe` installer. See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). |
| No installer appears after `npm run build`                     | Run the platform's `npm run tauri build` command above to package the desktop app.                                                                                                                                                     |
| macOS blocks first launch                                      | Current builds are unsigned and unnotarized. Public releases need Apple signing and notarization.                                                                                                                                      |
| The app does not run on an Intel Mac                           | Use an Intel or universal build; the default Apple Silicon build cannot run on Intel.                                                                                                                                                  |
| An agent CLI is not detected                                   | In **Settings → Models**, enter its absolute executable path and rerun the installation check.                                                                                                                                         |
| Hosted chat returns an HTTP error                              | Check the full chat-completions endpoint, model identifier, API token, and provider access. Reenter configuration after restarting Chista.                                                                                             |
| Repository selection or CLI chat is unavailable in the browser | Open the desktop app. `npm run dev` serves a browser preview for local file review.                                                                                                                                                    |

## Data stored on this computer

| Data                                                               | After restarting Chista                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| Workspace definitions, repository names, and directory paths       | Restored from local storage on this device.              |
| Imported artifacts, redaction mappings, chat, and selected context | Cleared; these remain in memory during the app run.      |
| Hosted provider configuration and API token                        | Cleared; configure the provider again.                   |
| CLI sign-in and MCP configuration                                  | Managed separately by the installed CLI, outside Chista. |

Use **Session actions (⋯) → Remove session** to remove a debug conversation and its draft. This stops its active request and releases its CLI connection. Removing the last session starts a fresh one. Workspace files and mappings remain available during the same app run.

Copying an installer does not transfer workspace data or CLI credentials. Adding a repository records its folder metadata; Chista does not automatically read or upload its files.
