// Decode every video frame and detect isolated screen-wide capture flashes.
// This supplements visual motion review; it is not a video-quality score.
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { inflateSync } from 'node:zlib';
import { RenderInternals } from '@remotion/renderer';
const input = process.argv[2];
if (!input) throw new Error('Usage: node demo/video/scripts/verify-render.mjs <video.mp4>');
// Resolve the binary through the pinned Remotion package, including Linux
// libc variants and Windows suffixes. Its working directory supplies dylibs.
const executable = RenderInternals.getExecutablePath({
  type: 'ffmpeg',
  indent: false,
  logLevel: 'error',
  binariesDirectory: null,
});
const binaryDir = dirname(executable);
function pixels(png) {
  let offset = 8,
    width,
    height,
    channels;
  const chunks = [];
  while (offset < png.length) {
    const size = png.readUInt32BE(offset),
      type = png.toString('ascii', offset + 4, offset + 8),
      data = png.subarray(offset + 8, offset + 8 + size);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = data[9] === 2 ? 3 : data[9] === 6 ? 4 : 0;
      if (data[8] !== 8 || !channels || data[12] !== 0)
        throw new Error('Expected noninterlaced 8-bit RGB PNG frames.');
    }
    if (type === 'IDAT') chunks.push(data);
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)),
    stride = width * channels,
    out = Buffer.alloc(width * height * channels);
  let at = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[at++];
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[y * stride + x - channels] : 0,
        above = y ? out[(y - 1) * stride + x] : 0,
        diagonal = y && x >= channels ? out[(y - 1) * stride + x - channels] : 0;
      let value = raw[at++];
      if (filter === 1) value += left;
      else if (filter === 2) value += above;
      else if (filter === 3) value += Math.floor((left + above) / 2);
      else if (filter === 4) {
        const predictor = left + above - diagonal,
          a = Math.abs(predictor - left),
          b = Math.abs(predictor - above),
          c = Math.abs(predictor - diagonal);
        value += a <= b && a <= c ? left : b <= c ? above : diagonal;
      } else if (filter !== 0) throw new Error('Unexpected PNG filter.');
      out[y * stride + x] = value;
    }
  }
  const gray = Buffer.alloc(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = out[i * channels];
  return gray;
}
function difference(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}
let pending = Buffer.alloc(0),
  frame = 0,
  previous,
  beforePrevious,
  previousDelta = 0,
  maxDelta = 0;
const flashes = [];
const decoder = spawn(
  executable,
  [
    '-v',
    'error',
    '-i',
    resolve(input),
    '-vf',
    'scale=320:180',
    '-pix_fmt',
    'rgb24',
    '-f',
    'image2pipe',
    '-vcodec',
    'png',
    '-',
  ],
  { cwd: binaryDir, stdio: ['ignore', 'pipe', 'pipe'] },
);
const exitCode = new Promise((resolve, reject) => {
  decoder.on('error', reject);
  decoder.on('close', resolve);
});
let stderr = '';
decoder.stderr.on('data', (chunk) => {
  stderr += chunk;
});
for await (const chunk of decoder.stdout) {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 8) {
    let end = 8,
      complete = false;
    while (end + 12 <= pending.length) {
      const size = pending.readUInt32BE(end),
        type = pending.toString('ascii', end + 4, end + 8);
      if (end + size + 12 > pending.length) break;
      end += size + 12;
      if (type === 'IEND') {
        complete = true;
        break;
      }
    }
    if (!complete) break;
    const current = pixels(pending.subarray(0, end));
    pending = pending.subarray(end);
    if (previous) {
      const delta = difference(previous, current);
      maxDelta = Math.max(maxDelta, delta);
      // A damaged frame departs from its neighbors then immediately returns.
      if (
        beforePrevious &&
        previousDelta > 3 &&
        delta > 3 &&
        difference(beforePrevious, current) < 0.8
      )
        flashes.push(frame - 1);
      previousDelta = delta;
    }
    beforePrevious = previous;
    previous = current;
    frame++;
  }
}
const code = await exitCode;
if (code !== 0) throw new Error(stderr || `Decoder exited ${code}`);
if (!frame || pending.length) throw new Error('Incomplete frame stream.');
console.log(
  JSON.stringify(
    {
      frames: frame,
      isolatedCaptureFlashes: flashes.length,
      flashFrames: flashes,
      maxMeanPixelDelta: Number(maxDelta.toFixed(3)),
    },
    null,
    2,
  ),
);
if (flashes.length) process.exitCode = 1;
