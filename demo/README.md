# Chista demos

This folder contains the product video and illustrative incident fixtures. These are development and demonstration resources; they are not loaded automatically by the desktop app.

| Folder                    | Contents                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `video/`                  | Remotion scenes, example responses, rendering configuration, TypeScript configuration, and render verification. See the [video guide](video/README.md). |
| `fixtures/access-denied/` | Sample access logs and permission data for the [investigation walkthrough](../docs/INVESTIGATION.md).                                                   |
| `scripts/`                | Loopback MCP fixture server, its tests, and the installed-connector smoke check.                                                                        |

Run commands from the repository root:

```sh
npm run video:studio
npm run video:check
npm run test:incident-server
```

The fixture server serves illustrative evidence and does not contact production services. Follow the investigation guide to register it explicitly with your agent. Stop it when finished.

Generated video output goes in `demo/video/out/` and is excluded from Git. Unit-test data used only by application tests remains in `src/testing/`.
