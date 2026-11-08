# Run an access investigation

Chista can stream an agent's explanation, reveal completed OpenUI blocks as they arrive, and show actual MCP tool activity. Expand a completed tool's evidence or a response's **Sources** to inspect the sanitized data behind it. Imported artifacts, messages and MCP results share a workspace redaction map; **Files & mappings → Mappings** includes values masked in tool results.

## Your own incident

Use Claude Code or Codex for MCP-backed investigations. Both provide tool approvals, sanitized results and evidence citations. Hosted providers can analyze attached sanitized evidence.

1. Configure your monitoring and identity/permissions MCP servers through your selected CLI's user configuration. Both agents support stdio, HTTPS and loopback HTTP servers. Use the Sign in button in chat for native MCP authentication.
2. Add relevant access logs and permission/policy exports in chat. Select the evidence to include and inspect the local mappings. Imported repository folders are metadata; their files are not automatically read or uploaded.
3. Ask the agent to distinguish authentication from authorization, check effective permissions and resource policy, and correlate the failure time with monitoring data.
4. Approve each tool's exact arguments. The activity list distinguishes awaiting approval, running, completed, denied, failed and cancelled calls. Returned evidence is sanitized before reaching the agent. Request preview is optional; tool approval is always required.
5. Inspect cited sources and compare their values with the generated tables and charts. Source references identify received excerpts, not a guarantee that the model's interpretation is correct. An unavailable source is labeled; an uncited table or chart is flagged when evidence exists.
6. Choose a follow-up date and send the prepared message. The agent can use that date for the next approved query. The date picker never sends or executes a tool by itself.

Remote tools receive sanitized arguments. Use non-sensitive service identifiers and time ranges, or import identity-specific evidence locally. Chista does not automatically reverse placeholders into original values for remote queries.

## Repeatable test incident

This read-only server returns **illustrative test evidence**, including Datadog-shaped counts. It does not contact Datadog or supply canned AI answers. No sample investigation runs automatically when Chista opens.

```sh
npm run test:incident-server
```

In another terminal, explicitly register the test server in your Codex configuration:

```sh
codex mcp add chista-access-test --url http://127.0.0.1:4318/mcp
```

Start a new Chista session with Codex. Attach `demo/fixtures/access-denied/access.log` and `demo/fixtures/access-denied/permissions.json`, then send:

> Investigate the access denial for doc-42 on October 22, 2026. Use the chista-access-test MCP tools to check access events and effective permissions, then query response counts from 09:55 to 10:20 UTC. Show the permission checks in a table and the observed counts in charts. Cite your sources, label the data as illustrative, and ask for the last successful access date using a date picker.

The evidence contains a valid Viewer role and `file:read` permission, but missing Finance Ops membership after an identity sync at 10:02 UTC. The monitoring window contains 14 denied and 126 allowed responses. Selecting October 21 and sending it lets the agent inspect the earlier day, which has Finance Ops membership and zero denied responses in the fixture. The actual model decides how to present the evidence; wording and layouts may vary.

To test missing permissions or a failed service, restart the fixture with `CHISTA_TEST_DATADOG=denied` or `CHISTA_TEST_DATADOG=unavailable`. Deny a tool in Chista to check the rejection path. None of these cases should produce a successful Datadog query or invented counts.

Remove the registration when finished:

```sh
codex mcp remove chista-access-test
```

## Checks

```sh
npm test
npm run test:incident-connector
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

The connector smoke check starts its own loopback fixture, uses the installed Codex CLI for MCP discovery and calls, disables inherited servers for its temporary thread, and leaves global CLI configuration unchanged. It runs no AI inference. Automated UI tests simulate agent replies; production Datadog access and model behavior still require a live configured session.

The fixture implements JSON responses over [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports). It binds to loopback and rejects browser origins.

## Debugging playbooks and task tracking

Choose a Debugging playbook above the chat, or start a message with `/investigate-error`, `/compare-traces`, or `/incident-report`. These are registered Chista workflows for error diagnosis, comparing traces and drafting incident reports. Selecting a playbook makes no model request and runs no commands. Sending includes the procedure and current checklist in the sanitized prompt. Enable Review before sending to inspect the exact expanded request. Unknown slash commands are rejected locally; Chista does not load arbitrary native skills, plugins or scripts.

The checklist shows Pending, In progress, Completed and Blocked checks. Agents may report updates only for the registered steps. A completion report without an available supporting source becomes Blocked. A matching source reference does not independently prove the agent's conclusion: entries are labelled Agent-reported and can be reviewed or confirmed manually. Changing a checklist status or playbook revokes an outstanding request preview. The task list never grants tool permissions or executes actions; the existing per-call MCP/API approvals still apply.

## Branching from message checkpoints

After a submitted message, use Branch from here to create a separate debug session in the same workspace. Up to the latest 100 message checkpoints are retained per session in memory. The new session keeps only the chosen conversation prefix, the sanitized evidence/context available at that point, its checklist/playbook, and a separate copy of its redaction settings and local mappings. Later messages, later tool activity and pending approvals are excluded. The original session stays available in the sidebar.

A branch starts a fresh native conversation when you send its next message. It inherits the review-before-sending preference, but no native thread or one-call tool approval. Its next request explicitly tells the agent not to replay earlier actions. All actions still require the current workspace permissions and fresh tool approvals. Branching makes no model/tool call by itself and cannot undo changes already made by HTTP or MCP tools.

Checkpoint evidence is frozen by default. Use current workspace evidence opts a branch into the workspace's latest reviewed context. Adding files to a branch also opts it into current workspace evidence. Its captured redaction settings stay independent, so changes to the original workspace profile do not silently change an existing branch.

Live checklist and checkpoint state remains in memory. Encrypted investigation bundles include bounded sanitized chat excerpts, including agent task reports, but do not restore live native connections or the checkpoint registry. Raw reversal mappings and private profile values are not included in shared bundles.
