"use client";

export interface DecodedAudio {
  /** Mono samples at `sampleRate`, in [-1, 1]. */
  samples: Float32Array;
  sampleRate: number;
  durationS: number;
  sourceSampleRate: number;
  channels: number;
}

/** Longest recording analysed in the browser (memory stays under ~80 MB). */
export const MAX_SECONDS = 10 * 60;

/**
 * Decode any audio or video file the browser can play (wav, mp3, m4a, ogg,
 * mp4/mov video with sound) and resample it to mono at `sampleRate` with an
 * OfflineAudioContext, which downmixes channels by averaging.
 */
export async function decodeToMono(file: Blob, sampleRate: number): Promise<DecodedAudio> {
  const bytes = await file.arrayBuffer();
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(bytes);
  } catch {
    throw new Error("This file has no sound this browser can read. Try WAV, MP3, M4A or an MP4 video.");
  } finally {
    await ctx.close();
  }
  if (decoded.duration > MAX_SECONDS) {
    throw new Error(`This recording is ${Math.round(decoded.duration / 60)} minutes long. Murmur analyses up to ${MAX_SECONDS / 60} minutes at a time.`);
  }

  const frames = Math.max(1, Math.ceil(decoded.duration * sampleRate));
  const offline = new OfflineAudioContext(1, frames, sampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  return {
    samples: rendered.getChannelData(0),
    sampleRate,
    durationS: decoded.duration,
    sourceSampleRate: decoded.sampleRate,
    channels: decoded.numberOfChannels,
  };
}
