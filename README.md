# Chista

Chista is a Tauri 2 desktop debugging workspace using the existing React, TypeScript and OpenUI app. Safe Debug Sessions are preserved in `src/SafeSession.tsx`; the workspace shell composes them without sharing raw artifact state across sessions.

## Run

```sh
npm install --ignore-scripts
npm run dev             # browser preview; live integrations require desktop
npm test
npm run build           # TypeScript + production frontend
npm run tauri dev       # native desktop; requires Rust and Tauri platform prerequisites
npm run tauri build
```

Install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) separately. No local model, Ollama, model download or inference server is used.

## Workspace

- **Projects:** create/select projects and set their absolute directories. Project names/paths are the only persisted workspace data.
- **Sessions:** independent Safe Debug workflows and agent conversations per project/session. Navigation preserves in-memory state. Closing a session releases its app state; restarting the app clears all sessions.
- **Artifacts:** import and manage artifacts for the selected session using the existing safety workflow.
- **Settings → MCP:** configure, connect/disconnect, inspect status and discover tools separately from chat.
- **Settings → Models:** choose Claude Code, an optional hosted provider, or clearly labeled demo mode. The app starts in demo mode until an agent is selected.
- **Settings → General:** data handling and clearing saved project metadata.

## Safe Debug Sessions

1. Import header-based CSV, JSON, LOG or TXT; up to 20 artifacts, 2 MB each. Fictional sample data is available.
2. Preview local redactions, optionally reveal originals locally, and add exact custom sensitive values. Consistent placeholders preserve relationships across artifacts. The **Mappings** tab shows original → placeholder pairs, occurrence counts and source artifacts. Search the mapping or hide originals on screen. The mapping stays in the session on this device and is never included in model requests, context exports or the Claude copy action.
3. Compare sanitized artifacts by line position. OpenUI still renders interactive severity charts, searchable evidence tables and follow-up controls (500 analyzed lines, 100 displayed matching rows).
4. Select artifacts, compact them, and review the exact JSON snapshot. Duplicate lines are removed; the content budget truncates excerpts and reports omitted characters.
5. Explicitly acknowledge review before exporting or attaching the snapshot to this session's chat. Attaching opens Agent chat, where the sanitized data can be sent to the configured hosted provider after outgoing-request review. Artifact/selection/redaction changes revoke the attachment. Raw files and filenames never enter the provider interface.

Sanitization detects common secret/PII patterns and sensitive structured fields. It cannot guarantee detection of every secret; inspect the preview and add custom redactions. Chat uses a separate `CHAT_` placeholder namespace to avoid falsely associating a newly typed identity with an artifact placeholder.

## Claude Code

1. Set the selected project's absolute directory in Projects.
2. In Settings → Models, choose **Claude Code**. Check installation; optionally enter an absolute executable path. Detection checks PATH and common installation locations, including `~/.local/bin/claude`.
3. In the session's Agent chat, choose **Launch Claude Code**. On macOS it opens Terminal via AppleScript; on Linux it uses `x-terminal-emulator`. Windows launch is not implemented.

The launcher starts the installed `claude` executable in the project directory, without a prompt or credentials. Claude handles its own native sign-in, trust and tool approval flow. Chista never runs an invented login command, collects Claude credentials, injects imported debug files, or captures terminal output. Launch success means Terminal opened, not that the CLI is authenticated.

Claude runs independently and can read files already in its project directory under its native permissions. Keep raw debug files outside that directory. Chista does not copy imported artifacts into projects. Reviewed context can be copied with **Copy sanitized context for Claude** and pasted into its terminal; the mapping and originals are excluded. It is not automatically passed to Claude. See the [Claude Code quickstart](https://code.claude.com/docs/en/quickstart).

## Hosted model providers

`src/integrations/providers.ts` defines `ModelProvider`, `ModelRequest` and the provider implementations. The optional hosted adapter accepts an HTTPS chat-completions endpoint, a model identifier and optional API bearer token. It sends `{ model, stream: false, messages }` and expects `choices[0].message.content`. This is a compatible-endpoint adapter, not a universal adapter for every vendor API. Add another implementation of `ModelProvider` for a different protocol.

The exact JSON body, including instructions, sanitized history and reviewed context, is previewed before each send. No tool execution is delegated to model responses. Tokens/configuration remain in memory. Requests have cancellation and a 60-second timeout. Status distinguishes configured, connecting, last-successful and failed states. There are no background model calls. Browser preview blocks live network integrations and supports the labeled demo assistant.

## MCP

Uses the official `@modelcontextprotocol/sdk` v1 client and Streamable HTTP transport through Tauri's native HTTP bridge. The SDK handles initialization/version negotiation, initialized notification, session headers, JSON/SSE responses and JSON-RPC calls. Tool discovery is paginated and bounded. Supports HTTPS and loopback HTTP; redirects are disabled. Optional bearer tokens are memory-only. This MVP does not support stdio transport, OAuth authorization flows, resources/prompts UI, automatic tool chaining, or auto-reconnecting after a failed connection.

Create a server in Settings → MCP, then explicitly connect to discover its tools. Within the selected session's Agent chat, expand MCP tools, choose a tool and enter JSON arguments. Chista sanitizes the arguments and previews destination, tool, arguments and session. **Approve once** is bound to that exact call; altered arguments, a different session, denial, disconnect and repeated calls cannot reuse approval. Remote tools may have side effects. Input schemas are displayed; final argument validation is performed by the MCP server. No artifact is attached automatically. Tool results are displayed locally and never added to a model conversation automatically.

MCP configurations and tokens currently last for this app run. Disconnect before changing a token; remove and re-add to change an endpoint. Connection status is updated for connecting, success, transport errors and disconnect. Implementation references: [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [Tauri HTTP bridge](https://v2.tauri.app/plugin/http-client/).

## Data boundaries

Raw files, original filenames, placeholder mappings, custom terms, chat history and reviewed snapshots live in memory. Only project metadata goes into localStorage. Native code exposes narrow Claude detection/launch commands, plus scoped HTTP access; no general filesystem or shell plugin is enabled. The provider receives only the approved snapshot and sanitized chat strings. The application does not log payloads or credentials. Releasing references is not a secure memory-erasure guarantee.

## Validation and current blockers

Frontend tests cover the existing sanitizer/OpenUI renderer plus session isolation, navigation preservation, reviewed-context revocation, chat preview, exact provider payloads, one-time tool approval, and SDK initialization/discovery/call/disconnect against a mock HTTP transport. `npm run build` verifies TypeScript and bundles the frontend.

Native compilation and Rust launcher tests require Rust/Cargo, which were unavailable in the implementation environment. The Claude binary was not visible on PATH or at common install paths there; the executable override supports installations outside those paths. Live model/MCP credentials were not provided, so protocol behavior was tested with fixtures, not a real external service. Native terminal launch and the Tauri HTTP bridge still need a desktop smoke test after installing the toolchain.
