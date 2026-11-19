const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
app.use(express.json());

const upload = multer({ dest: '/tmp/uploads/' });
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

app.get('/', (req, res) => res.json({ status: 'ok', message: 'FFmpeg merge server running' }));

// POST /merge
// Accepts multipart/form-data: audio (file) + video_url (string)
// OR application/json: { audio_url, video_url }
app.post('/merge', upload.single('audio'), async (req, res) => {
  const video_url = req.body.video_url;
  const audio_url = req.body.audio_url;
  const audioFile = req.file; // from multipart upload

  if (!video_url) {
    return res.status(400).json({ error: 'video_url is required' });
  }
  if (!audioFile && !audio_url) {
    return res.status(400).json({ error: 'audio file or audio_url is required' });
  }

  const id = Date.now();
  const videoPath = path.join(TMP, `video_${id}.mp4`);
  const audioPath = audioFile ? audioFile.path : path.join(TMP, `audio_${id}.mp3`);
  const outputPath = path.join(TMP, `output_${id}.mp4`);

  try {
    console.log(`[${id}] Downloading video: ${video_url}`);
    await download(video_url, videoPath);

    if (!audioFile) {
      console.log(`[${id}] Downloading audio: ${audio_url}`);
      await download(audio_url, audioPath);
    } else {
      console.log(`[${id}] Using uploaded audio: ${audioFile.originalname}`);
    }

    console.log(`[${id}] Merging with FFmpeg...`);
    const cmd = `ffmpeg -stream_loop -1 -i "${videoPath}" -i "${audioPath}" -map 0:v:0 -map 1:a:0 -c:v libx264 -preset fast -crf 23 -c:a aac -shortest -y "${outputPath}"`;

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
      if (!audioFile) fs.unlink(audioPath, () => {});
      else fs.unlink(audioFile.path, () => {});
      fs.unlink(outputPath, () => {});
    });

  } catch (err) {
    console.error(`[${id}] Error:`, err.message);
    fs.unlink(videoPath, () => {});
    if (!audioFile) fs.unlink(audioPath, () => {});
    else fs.unlink(audioFile.path, () => {});
    fs.unlink(outputPath, () => {});
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
