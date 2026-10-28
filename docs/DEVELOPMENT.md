# Developing Chista

Start with the [installation prerequisites](INSTALL.md#prerequisites), then run these commands from the repository root:

```sh
npm ci --ignore-scripts
npm run tauri dev
```

For a browser preview, use `npm run dev`. The browser supports local file review; repository selection and live agent connections require the desktop app.

## Source layout

| Location              | Responsibility                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `src/main.tsx`        | React entry point and global styles.                                                              |
| `src/app/`            | Desktop shell, navigation, and application integration tests.                                     |
| `src/app/settings/`   | General and model settings; `useAgentSettings` keeps configuration in memory across page changes. |
| `src/app/workspaces/` | Repository catalog, workspace metadata, folder selection, and local metadata persistence.         |
| `src/app/sessions/`   | Session navigation and toolbar controls.                                                          |
| `src/chat/`           | Agent chat, response rendering, widgets, scrolling, and response validation.                      |
| `src/evidence/`       | Artifact import, sanitization, redaction review, mappings, and evidence helpers.                  |
| `src/components/`     | Shared UI primitives, including fullscreen sections.                                              |
| `src/integrations/`   | Agent transports, hosted requests, CLI sessions, MCP approvals, and model instructions.           |
| `src/styles/`         | Global and workspace styles.                                                                      |
| `src/testing/`        | Shared artifact test fixtures.                                                                    |
| `src-tauri/src/`      | Rust desktop commands, native CLI processes, and MCP bridge.                                      |
| `scripts/`            | Loopback incident fixture and connector smoke check.                                              |
| `video/`              | Remotion demo; see its [guide](../video/README.md).                                               |

Tests live beside the feature they exercise. Application integration tests live in `src/app/`.

## Feature modules and constants

Keep a component focused on one view or interaction. `AgentChat.tsx` composes the conversation, composer, MCP connection status, and approval dialogs; `useAgentChat.ts` owns request execution and session lifecycle. `SafeSession.tsx` composes artifact overview, redaction review, comparison, mappings, and export; `useEvidenceSession.ts` owns imports, selection, and reviewed snapshots. Their state hooks stay mounted while users switch between views.

Response rendering lives in `src/chat/rendering/`. Individual form, date-range, and code widgets live in `src/chat/widgets/`; their validation is independent of React. Chat tests are grouped into lifecycle, responses, and MCP behavior, with shared native mocks in `src/chat/testing/`.

Constants stay beside the feature that uses them:

| File                                    | Configuration                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/evidence/artifactConfig.ts`        | Supported import formats, picker extensions, artifact count, and size limits.              |
| `src/evidence/contextConfig.ts`         | Export budgets, download filename, and object URL lifetime.                                |
| `src/evidence/navigationConfig.ts`      | Evidence tabs, icons, and workflow steps.                                                  |
| `src/evidence/sanitizerRules.ts`        | Sensitive field names, identifier matching, credential patterns, and placeholder patterns. |
| `src/chat/chatConfig.ts`                | Request timeout and the attachment-only prompt.                                            |
| `src/chat/responseConfig.ts`            | Follow-up input limit and response control defaults.                                       |
| `src/app/workspaces/workspaceConfig.ts` | Metadata storage keys, workspace name limit, and default workspace name.                   |

Add shared feature configuration to the relevant module rather than creating an application-wide constants file. Keep values used only by a small local implementation with that implementation unless they represent configurable policy.

## State and data boundaries

`App.tsx` coordinates navigation and owns mounted chat sessions and workspace evidence. Evidence components stay mounted while hidden so changing pages does not discard files. Each workspace has one sanitizer and one evidence store; each debug session has its own conversation. Closing a session releases its chat while preserving workspace evidence.

`useWorkspaceCatalog` manages repository membership and saves workspace definitions, repository names, and paths locally. `useAgentSettings` owns agent selection, executable paths, and hosted configuration for the app run. It stays mounted in the shell so opening another page does not reset settings. Artifacts, mappings, chat, and hosted tokens remain in memory; see [data storage](INSTALL.md#data-stored-on-this-computer).

The sanitizer is `src/evidence/safety.ts`. Outgoing chat preparation lives in `src/integrations/providers.ts`; MCP result sanitization and approvals live in `src/integrations/cliTools.ts`. Keep raw artifact contents and redaction mappings out of provider requests.

Identifier fields named `id` or ending in `_id` are sensitive, regardless of case (for example, `ID`, `user_id`, and `ACCOUNT_ID`). Their values are masked in JSON, CSV/TSV columns, and key-value assignments in text. Repeated values use the same workspace placeholder so evidence can still be correlated. Null identifiers remain null; unrelated fields such as `valid` and `grid` retain their normal treatment.

Response schemas and parsing live in `src/chat/response.ts` and `widgetSchema.ts`, separate from React renderers. Provider instructions live in `src/integrations/uiInstructions.ts`. When changing the response format, update the schemas, instructions, rendering, and relevant tests together.

## Formatting

```sh
npm run format
npm run format:check
```

Prettier formats supported source, styles, configuration, and Markdown files. Generated output, fixtures, and lockfiles are excluded in `.prettierignore`. Its version is pinned in `package.json` and the npm lockfile. VS Code recommends the Prettier extension and formats on save when it is installed.

Rust uses its native formatter:

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml
```

## Verification

```sh
npm run format:check
npm test
npm run build
npm run video:check
```

The test suite includes a fixture server that binds to loopback; run it in an environment that permits local networking. The build checks TypeScript and bundles the frontend. The video check catches broken imports in the demo, which reuses app components.

For native code changes, also run:

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```

For MCP changes, follow the [connector checks](INVESTIGATION.md#checks). To create a distributable desktop installer, follow [Build an installer](INSTALL.md#build-an-installer).
