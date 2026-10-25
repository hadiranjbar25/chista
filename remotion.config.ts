import {Config} from '@remotion/cli/config';
Config.setVideoImageFormat('png');
Config.setCodec('h264');
Config.setCrf(18);
Config.setDisableSharedMemoryCapture(true);
// Use Remotion's managed Headless Shell for reproducible exports. An installed
// Chrome can fall back to single-tab viewport capture when surface capture tiles.
const viewportCapture=process.env.CHISTA_VIDEO_VIEWPORT_CAPTURE==='1';
Config.setConcurrency(viewportCapture?1:4);
if(viewportCapture)process.env.DISABLE_FROM_SURFACE='1';
if(process.env.CHISTA_VIDEO_BROWSER)Config.setBrowserExecutable(process.env.CHISTA_VIDEO_BROWSER);
