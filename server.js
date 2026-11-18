const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TMP = '/tmp';

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', message: 'FFmpeg merge server running' }));

// POST /merge
// Body: { video_url, audio_url }
// Returns: MP4 binary
app.post('/merge', async (req, res) => {
  const { video_url, audio_url } = req.body;

  if (!video_url || !audio_url) {
    return res.status(400).json({ error: 'video_url and audio_url are required' });
  }

  const id = Date.now();
  const videoPath = path.join(TMP, `video_${id}.mp4`);
  const audioPath = path.join(TMP, `audio_${id}.mp3`);
  const outputPath = path.join(TMP, `output_${id}.mp4`);

  try {
    console.log(`[${id}] Downloading video: ${video_url}`);
    await download(video_url, videoPath);

    console.log(`[${id}] Downloading audio: ${audio_url}`);
    await download(audio_url, audioPath);

    console.log(`[${id}] Merging with FFmpeg...`);

    // Loop video to match audio length, replace audio track
    const cmd = `ffmpeg -stream_loop -1 -i "${videoPath}" -i "${audioPath}" -shortest -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -y "${outputPath}"`;

    await new Promise((resolve, reject) => {
      exec(cmd, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr));
        resolve();
      });
    });

    console.log(`[${id}] Done. Sending output...`);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="merged.mp4"');
    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);
    stream.on('end', () => {
      fs.unlink(videoPath, () => {});
      fs.unlink(audioPath, () => {});
      fs.unlink(outputPath, () => {});
    });

  } catch (err) {
    console.error(`[${id}] Error:`, err.message);
    fs.unlink(videoPath, () => {});
    fs.unlink(audioPath, () => {});
    fs.unlink(outputPath, () => {});
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
