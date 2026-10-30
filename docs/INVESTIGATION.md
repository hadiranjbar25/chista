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
