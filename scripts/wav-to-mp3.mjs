// Encode a 16-bit PCM mono WAV to MP3 via lamejs.
// Usage: node scripts/wav-to-mp3.mjs <input.wav> <output.mp3>

import { readFileSync, writeFileSync } from "node:fs";
import { Mp3Encoder } from "@breezystack/lamejs";

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error("usage: node scripts/wav-to-mp3.mjs input.wav output.mp3");
  process.exit(1);
}

const buf = readFileSync(input);
// Minimal RIFF/WAVE header parser (assumes PCM 16-bit, little-endian).
if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
  throw new Error("not a WAV file");
}
let p = 12;
let fmt = null;
let dataOffset = -1;
let dataLength = 0;
while (p < buf.length - 8) {
  const id = buf.toString("ascii", p, p + 4);
  const size = buf.readUInt32LE(p + 4);
  if (id === "fmt ") {
    fmt = {
      audioFormat: buf.readUInt16LE(p + 8),
      channels: buf.readUInt16LE(p + 10),
      sampleRate: buf.readUInt32LE(p + 12),
      bitsPerSample: buf.readUInt16LE(p + 22),
    };
  } else if (id === "data") {
    dataOffset = p + 8;
    dataLength = size;
    break;
  }
  p += 8 + size + (size % 2);
}
if (!fmt || dataOffset < 0) throw new Error("missing fmt/data chunk");
if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
  throw new Error("only PCM 16-bit supported");
}

const samples = new Int16Array(
  buf.buffer,
  buf.byteOffset + dataOffset,
  dataLength / 2,
);

const encoder = new Mp3Encoder(fmt.channels, fmt.sampleRate, 128);
const chunks = [];
const block = 1152 * fmt.channels;
for (let i = 0; i < samples.length; i += block) {
  const slice = samples.subarray(i, i + block);
  if (fmt.channels === 1) {
    chunks.push(encoder.encodeBuffer(slice));
  } else {
    // de-interleave
    const half = slice.length / 2;
    const left = new Int16Array(half);
    const right = new Int16Array(half);
    for (let j = 0; j < half; j++) {
      left[j] = slice[2 * j];
      right[j] = slice[2 * j + 1];
    }
    chunks.push(encoder.encodeBuffer(left, right));
  }
}
chunks.push(encoder.flush());

const total = chunks.reduce((n, c) => n + c.length, 0);
const mp3 = new Uint8Array(total);
let off = 0;
for (const c of chunks) {
  mp3.set(c, off);
  off += c.length;
}
writeFileSync(output, mp3);
console.log(
  `wrote ${output} (${mp3.length} bytes, ${fmt.sampleRate} Hz, ${fmt.channels}ch)`,
);
