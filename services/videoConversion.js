import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const MAX_LOG_LENGTH = 4000;

const tail = (value = '') => String(value).slice(-MAX_LOG_LENGTH);

export const convertVideoToBrowserMp4 = (inputPath, outputPath) =>
  new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', inputPath,
      '-map', '0:v:0',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath,
    ];

    const child = spawn(FFMPEG_PATH, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = tail(stderr + chunk.toString());
    });

    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error('Video conversion is unavailable on the server. Please install FFmpeg.'));
        return;
      }
      reject(new Error(`Video conversion failed: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        try {
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch {}
        reject(new Error(stderr ? `Video conversion failed: ${stderr}` : 'Video conversion failed.'));
        return;
      }

      if (!fs.existsSync(outputPath)) {
        reject(new Error('Video conversion completed without creating the output file.'));
        return;
      }

      resolve(outputPath);
    });
  });

export const buildConvertedVideoFilename = (originalFilename, userId = null) => {
  const base = path.basename(originalFilename, path.extname(originalFilename));
  const safeBase = base.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 80) || 'advertisement';
  const prefix = userId ? `${userId}_` : '';
  return `${prefix}${Date.now()}_${Math.random().toString(36).substring(2, 15)}_${safeBase}.mp4`;
};
