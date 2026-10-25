# Chista product animation

90 seconds · 1920 × 1080 · 30 fps · silent MP4.

The pacing uses one-second overlapping transitions, deliberate reading holds, sequential log and permission checks, a separate query/retrieval step, staggered charts, and an unhurried calendar selection.

The incident is illustrative and labeled on every frame. It follows an access denial through logs, roles and permissions, an approved Datadog lookup, two charts, and a date-picker follow-up. The OpenUI cards reuse Chista's response renderer. The app shell and cursor are animated presentation layers; the calendar popup is drawn for deterministic rendering.

```sh
npm run video:studio   # Edit and preview the timeline
npm run video:render   # Render video/out/chista-access-debugging.mp4
npm run video:still -- --frame=1750
npm run video:check
```

Edit `incident.ts` for the sanitized evidence and responses, and `AccessDebugging.tsx` for the scene timing. Nothing contacts an agent, Datadog, or an MCP server during rendering. Generated media stays in `video/out/` and is excluded from Git.

To use an installed browser, set `CHISTA_VIDEO_BROWSER` to its executable path. Otherwise Remotion manages its rendering browser.

All Remotion packages are pinned to one version. Zod uses Chista's patched version through an npm override; Remotion may print a Zod version warning. Rendering is validated with that override. See [Remotion's documentation](https://www.remotion.dev/docs/) for renderer setup and licensing.
