import {Config} from '@remotion/cli/config';
Config.setVideoImageFormat('png');
Config.setCodec('h264');
Config.setCrf(18);
Config.setConcurrency(4);
if(process.env.CHISTA_VIDEO_BROWSER)Config.setBrowserExecutable(process.env.CHISTA_VIDEO_BROWSER);
