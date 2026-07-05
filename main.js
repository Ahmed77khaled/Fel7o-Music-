const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

const APP_DATA_DIR = path.join(app.getPath('appData'), 'Fel7o');
const SETTINGS_PATH = path.join(APP_DATA_DIR, 'settings.json');
const HISTORY_PATH = path.join(APP_DATA_DIR, 'history.json');

function ensureAppDataDir() {
  if (!fs.existsSync(APP_DATA_DIR)) fs.mkdirSync(APP_DATA_DIR, { recursive: true });
}

const DEFAULT_SETTINGS = {
  downloadFolder: path.join(app.getPath('downloads'), 'Fel7o'),
  theme: 'dark',
  mode: 'mp3',
  audioFormat: 'mp3',
  audioQuality: '192',
  videoQuality: '1080',
  videoContainer: 'mp4',
  concurrentDownloads: 2,
  embedThumbnail: true,
  embedMetadata: true,
  autoPasteClipboard: true,
  windowWidth: 1180,
  windowHeight: 780,
  welcomeShown: false,
  userName: '',
};

function loadJSON(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return { ...fallback, ...JSON.parse(fs.readFileSync(filePath, 'utf-8')) };
    }
  } catch (e) { console.error('loadJSON failed', filePath, e); }
  return { ...fallback };
}

function saveJSON(filePath, data) {
  ensureAppDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

let mainWindow;
// jobId -> { proc, cancelled, paused, url, settings, job }
const activeJobs = new Map();

function bundledBinPath(filename) {
  // In a packaged app, extra resources live under process.resourcesPath.
  // In dev (`npm start`), process.resourcesPath points inside the desktop
  // runtime's own install dir, NOT the project folder — so we must also
  // check the project's own bin/ folder next to main.js.
  const candidates = [];
  if (app.isPackaged && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'bin', filename));
  }
  candidates.push(path.join(__dirname, 'bin', filename));
  return candidates;
}

function ytdlpBinaryCandidates() {
  return [...bundledBinPath('yt-dlp.exe'), 'yt-dlp.exe', 'yt-dlp'];
}

function findWorkingBinary(candidates, cb, versionArg = '--version') {
  const tryNext = (i) => {
    if (i >= candidates.length) return cb(null);
    const bin = candidates[i];
    execFile(bin, [versionArg], (err) => {
      if (!err) return cb(bin);
      tryNext(i + 1);
    });
  };
  tryNext(0);
}

function createWindow() {
  const settings = loadJSON(SETTINGS_PATH, DEFAULT_SETTINGS);
  mainWindow = new BrowserWindow({
    width: settings.windowWidth,
    height: settings.windowHeight,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#0B0F17',
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('close', () => {
    const [w, h] = [mainWindow.getBounds().width, mainWindow.getBounds().height];
    const s = loadJSON(SETTINGS_PATH, DEFAULT_SETTINGS);
    saveJSON(SETTINGS_PATH, { ...s, windowWidth: w, windowHeight: h });
  });
}

app.whenReady().then(() => {
  ensureAppDataDir();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Settings ────────────────────────────────────────────────────────
ipcMain.handle('settings:get', () => loadJSON(SETTINGS_PATH, DEFAULT_SETTINGS));
ipcMain.handle('settings:save', (_e, patch) => {
  const merged = { ...loadJSON(SETTINGS_PATH, DEFAULT_SETTINGS), ...patch };
  saveJSON(SETTINGS_PATH, merged);
  return merged;
});

// ── History ─────────────────────────────────────────────────────────
ipcMain.handle('history:get', () => loadJSON(HISTORY_PATH, { items: [] }).items || []);
ipcMain.handle('history:add', (_e, entry) => {
  const data = loadJSON(HISTORY_PATH, { items: [] });
  data.items = data.items || [];
  data.items.unshift(entry);
  data.items = data.items.slice(0, 500);
  saveJSON(HISTORY_PATH, data);
  return data.items;
});
ipcMain.handle('history:clear', () => {
  saveJSON(HISTORY_PATH, { items: [] });
  return [];
});
ipcMain.handle('history:delete', (_e, id) => {
  const data = loadJSON(HISTORY_PATH, { items: [] });
  data.items = (data.items || []).filter((it) => it.id !== id);
  saveJSON(HISTORY_PATH, data);
  return data.items;
});

// ── Filesystem helpers ──────────────────────────────────────────────
ipcMain.handle('dialog:chooseFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});
ipcMain.handle('shell:openFolder', (_e, folderPath) => {
  if (folderPath && fs.existsSync(folderPath)) shell.openPath(folderPath);
});
ipcMain.handle('shell:openJobFolder', (_e, { downloadFolder, playlistFolder }) => {
  const folderName = sanitizeFolderName(playlistFolder);
  const targetDir = folderName ? path.join(downloadFolder, folderName) : downloadFolder;
  const finalDir = fs.existsSync(targetDir) ? targetDir : downloadFolder;
  if (fs.existsSync(finalDir)) shell.openPath(finalDir);
});
ipcMain.handle('clipboard:read', () => require('electron').clipboard.readText());
ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));

// ── ffmpeg / yt-dlp detection ──────────────────────────────────────
ipcMain.handle('tools:checkFfmpeg', () => new Promise((resolve) => {
  findWorkingBinary([...bundledBinPath('ffmpeg.exe'), 'ffmpeg.exe', 'ffmpeg'], (bin) => resolve(!!bin), '-version');
}));
ipcMain.handle('tools:checkYtdlp', () => new Promise((resolve) => {
  findWorkingBinary(ytdlpBinaryCandidates(), (bin) => resolve(!!bin));
}));

// Only accept youtube.com / youtu.be links. Not a hard security boundary
// (spawn/execFile are called with an args array, never a shell, so command
// injection isn't possible regardless) — this is about failing fast with a
// clear Arabic message instead of silently spawning yt-dlp on garbage input.
function isValidYoutubeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    return ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host);
  } catch {
    return false;
  }
}

function sanitizeFolderName(name) {
  if (!name) return null;
  // Remove characters that are invalid in Windows folder names, trim trailing dots/spaces.
  const cleaned = name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return cleaned || null;
}

// ── Download engine ─────────────────────────────────────────────────
async function buildArgs(job, settings) {
  const playlistFolder = sanitizeFolderName(job.playlistFolder);
  const targetDir = playlistFolder
    ? path.join(settings.downloadFolder, playlistFolder)
    : settings.downloadFolder;
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const outTemplate = path.join(targetDir, '%(title)s.%(ext)s');
  // --windows-filenames: guarantees titles with characters invalid on
  // Windows (| : * ? " < > etc., common in music titles with "Artist |
  // Song" style names) never break the output path, regardless of which OS
  // yt-dlp thinks it's running on.
  const args = ['--newline', '--no-mtime', '--no-playlist', '--windows-filenames', '-o', outTemplate];

  // Try to find ffmpeg to ensure post-processing works
  const ffmpegPath = await new Promise(resolve => {
    findWorkingBinary([...bundledBinPath('ffmpeg.exe'), 'ffmpeg.exe', 'ffmpeg'], (bin) => resolve(bin), '-version');
  });

  if (ffmpegPath) {
    args.push('--ffmpeg-location', ffmpegPath);
  }

  if (job.mode === 'mp3') {
    args.push('-x', '--audio-format', job.audioFormat || settings.audioFormat,
               '--audio-quality', `${job.audioQuality || settings.audioQuality}K`);
  } else {
    const q = job.videoQuality || settings.videoQuality;
    const heightFilter = q === 'best' ? '' : `[height<=${q}]`;
    // Add --fixup for better container compatibility
    args.push('-f', `bestvideo${heightFilter}+bestaudio/best${heightFilter}`,
               '--merge-output-format', job.videoContainer || settings.videoContainer,
               '--fixup', 'warn');
  }
  
  if (settings.embedThumbnail) args.push('--embed-thumbnail');
  if (settings.embedMetadata) args.push('--add-metadata');
  
  // Ignore metadata/thumbnail embedding errors only — NOT download errors.
  // (Each job is now a single video, so we want real failures to surface
  // properly via a non-zero exit code, not be silently swallowed.)
  args.push('--no-abort-on-error');
  
  args.push(job.url);
  return args;
}

function parseProgressLine(line) {
  // yt-dlp --newline progress format, e.g.:
  // [download]  42.3% of 10.00MiB at 2.50MiB/s ETA 00:03
  const m = line.match(/\[download\]\s+([\d.]+)% of\s+~?([\d.]+\w+)\s+at\s+([\d.]+\w+\/s)\s+ETA\s+([\d:]+)/);
  if (!m) return null;
  return { percent: parseFloat(m[1]), totalSize: m[2], speed: m[3], eta: m[4] };
}

// ── Helper: format seconds → "M:SS" / "H:MM:SS" ─────────────────────
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Helper: format bytes → "12.3 MB" ────────────────────────────────
function formatFileSize(bytes) {
  if (!bytes || isNaN(bytes)) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// ── Helper: format upload date "YYYYMMDD" → "DD/MM/YYYY" ────────────
function formatUploadDate(yyyymmdd) {
  if (!yyyymmdd || String(yyyymmdd).length !== 8) return null;
  const s = String(yyyymmdd);
  return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
}

// ── Helper: format view count → "1.2M" / "340K" ─────────────────────
function formatViewCount(n) {
  if (n === null || n === undefined || isNaN(n)) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

// ── Video metadata (rich — powers the Hero Preview) ─────────────────
ipcMain.handle('ytdlp:getInfo', (_e, url) => new Promise((resolve) => {
  if (!isValidYoutubeUrl(url)) return resolve({ error: 'الرابط لازم يكون رابط يوتيوب صحيح' });
  findWorkingBinary(ytdlpBinaryCandidates(), (bin) => {
    if (!bin) return resolve({ error: 'yt-dlp غير موجود' });
    execFile(bin, ['--dump-single-json', '--no-warnings', '--skip-download', '--no-playlist', url],
      { maxBuffer: 1024 * 1024 * 10 },
      (err, stdout) => {
        if (err || !stdout) return resolve({ error: 'تعذر جلب بيانات الفيديو' });
        try {
          const data = JSON.parse(stdout);

          // Estimated size: prefer direct fields, fall back to best format with a known size.
          let estimatedSizeBytes = data.filesize || data.filesize_approx || null;
          if (!estimatedSizeBytes && Array.isArray(data.formats)) {
            const withSize = data.formats.filter((f) => f.filesize || f.filesize_approx);
            if (withSize.length) {
              const best = withSize[withSize.length - 1];
              estimatedSizeBytes = best.filesize || best.filesize_approx;
            }
          }

          const isLive = !!(data.is_live || data.live_status === 'is_live' || data.live_status === 'is_upcoming');
          const isShort = !isLive && (
            (typeof data.webpage_url === 'string' && data.webpage_url.includes('/shorts/')) ||
            (!!data.duration && data.duration <= 60 && !!data.height && !!data.width && data.height > data.width)
          );
          const isPlaylistLink = /[?&]list=/.test(url);

          resolve({
            title: data.title || null,
            channel: data.uploader || data.channel || null,
            channelAvatar: data.uploader_thumbnail || data.channel_thumbnail ||
              ((Array.isArray(data.uploader_thumbnails) && data.uploader_thumbnails.length)
                ? data.uploader_thumbnails[data.uploader_thumbnails.length - 1].url : null),
            thumbnail: data.thumbnail || (Array.isArray(data.thumbnails) && data.thumbnails.length
              ? data.thumbnails[data.thumbnails.length - 1].url : null),
            duration: formatDuration(data.duration),
            durationSecs: data.duration || null,
            uploadDate: formatUploadDate(data.upload_date),
            viewCount: formatViewCount(data.view_count),
            resolution: data.resolution || (data.width && data.height ? `${data.width}x${data.height}` : null),
            estimatedSize: formatFileSize(estimatedSizeBytes),
            isLive,
            isShort,
            isPlaylistLink,
          });
        } catch (e) {
          resolve({ error: 'تعذر تحليل بيانات الفيديو' });
        }
      });
  });
}));

// ── Playlist metadata (powers the Playlist Manager dialog) ──────────
ipcMain.handle('ytdlp:getPlaylistInfo', (_e, url) => new Promise((resolve) => {
  if (!isValidYoutubeUrl(url)) return resolve({ error: 'الرابط لازم يكون رابط يوتيوب صحيح' });
  findWorkingBinary(ytdlpBinaryCandidates(), (bin) => {
    if (!bin) return resolve({ error: 'yt-dlp غير موجود' });
    execFile(bin, ['--flat-playlist', '--dump-single-json', '--no-warnings', '--ignore-errors', url],
      { maxBuffer: 1024 * 1024 * 40, timeout: 60000 },
      (err, stdout, stderr) => {
        if (!stdout) {
          if (err && err.killed) {
            return resolve({ error: 'استغرق تحميل القائمة وقت طويل جدًا (قد تكون قائمة Mix/Radio تلقائية غير مدعومة) — جرّب رابط قائمة تشغيل عادية' });
          }
          const errLine = (stderr || '').split('\n').find((l) => l.trim().startsWith('ERROR:'));
          return resolve({ error: errLine ? errLine.replace(/^ERROR:\s*/, '').trim() : 'تعذر جلب بيانات القائمة — تأكد إنها متاحة للعامة' });
        }
        try {
          const data = JSON.parse(stdout);
          const rawEntries = Array.isArray(data.entries) ? data.entries : [];

          let totalDurationSecs = 0;
          let knownDurationCount = 0;
          const videos = rawEntries.map((e, i) => {
            if (!e) return null;
            const durationSecs = e.duration || null;
            if (durationSecs) { totalDurationSecs += durationSecs; knownDurationCount++; }
            const thumb = e.thumbnail || (Array.isArray(e.thumbnails) && e.thumbnails.length
              ? e.thumbnails[e.thumbnails.length - 1].url : null);
            const videoUrl = e.url && /^https?:\/\//.test(e.url) ? e.url
              : (e.id ? `https://www.youtube.com/watch?v=${e.id}` : null);
            if (!videoUrl) return null;
            return {
              id: e.id || String(i),
              url: videoUrl,
              title: e.title || 'بدون عنوان',
              channel: e.uploader || e.channel || data.uploader || null,
              duration: formatDuration(durationSecs),
              durationSecs: durationSecs || 0,
              thumbnail: thumb,
              position: i + 1,
            };
          }).filter(Boolean);

          resolve({
            playlistTitle: data.title || 'قائمة تشغيل بدون اسم',
            channel: data.uploader || data.channel || null,
            videoCount: videos.length,
            totalDuration: totalDurationSecs ? formatDuration(totalDurationSecs) : null,
            hasPartialDurations: knownDurationCount > 0 && knownDurationCount < videos.length,
            videos,
          });
        } catch (e) {
          resolve({ error: 'تعذر تحليل بيانات القائمة' });
        }
      });
  });
}));

// Attaches stdout/stderr/close handlers to a running yt-dlp process for a
// given jobId. Used by download:start, download:resume, and
// download:resumeAll so all three paths behave identically — in particular,
// this ensures the stderr "ERROR:" capture (used for meaningful error
// messages) is never accidentally skipped on resume.
function attachProcessHandlers(proc, jobId) {
  proc.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      const progress = parseProgressLine(line);
      if (progress) {
        mainWindow.webContents.send('download:progress', { id: jobId, ...progress });
      }
      if (line.includes('has already been downloaded')) {
        mainWindow.webContents.send('download:progress', { id: jobId, percent: 100 });
      }
    }
  });
  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    const jobState = activeJobs.get(jobId);
    if (jobState) {
      const errorLine = text.split('\n').find((l) => l.trim().startsWith('ERROR:'));
      if (errorLine) jobState.lastError = errorLine.replace(/^ERROR:\s*/, '').trim();
    }
    mainWindow.webContents.send('download:log', { id: jobId, message: text });
  });
  proc.on('close', (code) => {
    const state = activeJobs.get(jobId);
    if (state && state.paused) return; // Ignore close if it's just paused
    activeJobs.delete(jobId);
    if (state && state.cancelled) {
      mainWindow.webContents.send('download:cancelled', { id: jobId });
    } else if (code === 0) {
      mainWindow.webContents.send('download:done', { id: jobId });
    } else {
      const reason = (state && state.lastError) || `yt-dlp exited with code ${code}`;
      mainWindow.webContents.send('download:error', { id: jobId, message: reason });
    }
  });
}

ipcMain.handle('download:start', async (event, job) => {
  if (!isValidYoutubeUrl(job.url)) {
    mainWindow.webContents.send('download:error', { id: job.id, message: 'الرابط لازم يكون رابط يوتيوب صحيح' });
    return { started: false };
  }
  const settings = loadJSON(SETTINGS_PATH, DEFAULT_SETTINGS);
  ensureAppDataDir();
  if (!fs.existsSync(settings.downloadFolder)) fs.mkdirSync(settings.downloadFolder, { recursive: true });

  const binaries = ytdlpBinaryCandidates();
  findWorkingBinary(binaries, async (bin) => {
    if (!bin) {
      mainWindow.webContents.send('download:error', { id: job.id, message: 'yt-dlp not found' });
      return;
    }
    const args = await buildArgs(job, settings);
    const proc = spawn(bin, args, { windowsHide: true });
    activeJobs.set(job.id, { proc, paused: false, cancelled: false, bin, args, job, settings, lastError: null });
    attachProcessHandlers(proc, job.id);
  });
  return { started: true };
});

ipcMain.handle('download:pause', (_e, jobId) => {
  const state = activeJobs.get(jobId);
  if (state && state.proc) {
    state.paused = true;
    // On Windows, we can't easily SIGSTOP. So we kill and we'll resume by restarting with --continue
    state.proc.kill();
    return true;
  }
  return false;
});

ipcMain.handle('download:resume', (_e, jobId) => {
  const state = activeJobs.get(jobId);
  if (state && state.paused) {
    state.paused = false;
    state.lastError = null;
    const newProc = spawn(state.bin, state.args, { windowsHide: true });
    state.proc = newProc;
    attachProcessHandlers(newProc, jobId);
    return true;
  }
  return false;
});

ipcMain.handle('download:cancel', (_e, jobId) => {
  const state = activeJobs.get(jobId);
  if (state) {
    state.cancelled = true;
    if (state.proc) state.proc.kill();
    activeJobs.delete(jobId);
    return true;
  }
  return false;
});

ipcMain.handle('download:pauseAll', () => {
  let count = 0;
  for (const [id, state] of activeJobs.entries()) {
    if (state.proc && !state.paused && !state.cancelled) {
      state.paused = true;
      state.proc.kill();
      count++;
    }
  }
  return count;
});

ipcMain.handle('download:resumeAll', () => {
  let count = 0;
  for (const [id, state] of activeJobs.entries()) {
    if (state.paused && !state.cancelled) {
      state.paused = false;
      state.lastError = null;
      const newProc = spawn(state.bin, state.args, { windowsHide: true });
      state.proc = newProc;
      attachProcessHandlers(newProc, id);
      count++;
    }
  }
  return count;
});

ipcMain.handle('notify', (_e, { title, body, silent }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: !!silent }).show();
  }
});
