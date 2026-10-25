# Chista product animation

90 seconds · 1920 × 1080 · 60 fps · silent MP4.

A continuous opening leads into masked panel reveals, sequential evidence highlights, animated charts, and a connected finding. Reading holds and an unhurried calendar selection keep each step clear. The log finding has a reserved region above the composer.

The incident is illustrative and labeled on every frame. It follows an access denial through logs, roles and permissions, an approved Datadog lookup, two charts, and a date-picker follow-up. The OpenUI cards reuse Chista's response renderer. The app shell and cursor are animated presentation layers; the calendar popup is drawn for deterministic rendering.

```sh
npm run video:studio   # Edit and preview the timeline
npm run video:render   # Render video/out/chista-access-debugging.mp4
npm run video:still -- --frame=1750
npx remotion still video/index.tsx ChistaEndCard video/out/chista-end-card.png
npm run video:check
npm run video:verify -- video/out/chista-access-debugging.mp4
```

Edit `incident.ts` for the sanitized evidence and responses, and `AccessDebugging.tsx` for the scene timing. Nothing contacts an agent, Datadog, or an MCP server during rendering. Generated media stays in `video/out/` and is excluded from Git.

Exports use Remotion's managed Headless Shell and PNG capture. The frame audit decodes the whole MP4 and rejects isolated screen-wide flashes; visual review is still needed for pacing and motion.

Prefer the managed browser (`npx remotion browser ensure`). To use an installed browser, set `CHISTA_VIDEO_BROWSER` to its executable path. If its surface capture produces tiled frames, `CHISTA_VIDEO_VIEWPORT_CAPTURE=1` enables a slower, single-tab fallback.

All Remotion packages are pinned to one version. Zod uses Chista's patched version through an npm override; Remotion may print a Zod version warning. Rendering is validated with that override. See [Remotion's documentation](https://www.remotion.dev/docs/) for renderer setup and licensing.
