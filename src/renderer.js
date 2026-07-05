// ── Welcome popup config ──────────────────────────────────────────
// Edit these values to customize the one-time welcome popup.
const WELCOME_CONFIG = {
  name: 'Fel7o',                                   // shown as "أهلاً، <name>"
  message: 'مبسوطين إنك بتستخدم Fel7o Downloader — حمّل فيديوهات وأغاني يوتيوب بسهولة وبجودة عالية.',
  links: [
    { text: 'فيسبوك', url: 'https://web.facebook.com/ahmed.elfalah.754' },
    { text: 'لينكدإن', url: 'https://www.linkedin.com/in/ahmed-el-falah-b771bb345?utm_source=share_via&utm_content=profile&utm_medium=member_android' },
  ],
};

const state = {
  settings: null,
  jobs: new Map(),      // id -> job object
  jobOrder: [],
  activeJobId: null,
  history: [],
  selectedMode: 'mp3',
  // Hero Preview
  previewUrl: null,      // url currently shown in the preview card
  previewData: null,     // last successful info payload for previewUrl (used when queuing)
  previewToken: 0,       // guards against out-of-order async responses
  previewDebounce: null,
  // Playlist Manager
  playlist: {
    url: null,
    data: null,          // raw payload from getPlaylistInfo
    selected: new Set(), // ids of selected videos
    searchQuery: '',
    token: 0,
  },
  // More Actions Menu
  openMoreMenuId: null,
};

const QUALITY_OPTIONS = {
  mp3: [
    { value: '128', label: '128 kbps' },
    { value: '192', label: '192 kbps' },
    { value: '320', label: '320 kbps' },
  ],
  video: [
    { value: 'best', label: 'أفضل جودة' },
    { value: '2160', label: '4K' },
    { value: '1440', label: '1440p' },
    { value: '1080', label: '1080p' },
    { value: '720', label: '720p' },
    { value: '480', label: '480p' },
  ],
};

const el = (id) => document.getElementById(id);

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function showToast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { t.hidden = true; }, 3000);
}

// ── Utility: Calculate download/remaining sizes ──────────────────
function parseSize(sizeStr) {
  if (!sizeStr) return 0;
  const match = sizeStr.match(/^([\d.]+)\s*([KMGT]?)i?B$/);
  if (!match) return 0;
  let bytes = parseFloat(match[1]);
  const unit = match[2];
  if (unit === 'K') bytes *= 1024;
  else if (unit === 'M') bytes *= 1024 * 1024;
  else if (unit === 'G') bytes *= 1024 * 1024 * 1024;
  else if (unit === 'T') bytes *= 1024 * 1024 * 1024 * 1024;
  return bytes;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

function getDownloadedSize(job) {
  if (!job.totalSize || job.percent === undefined) return '0 B';
  const totalBytes = parseSize(job.totalSize);
  const downloadedBytes = (job.percent / 100) * totalBytes;
  return formatBytes(downloadedBytes);
}

function getRemainingSize(job) {
  if (!job.totalSize || job.percent === undefined) return '—';
  const totalBytes = parseSize(job.totalSize);
  const downloadedBytes = (job.percent / 100) * totalBytes;
  const remainingBytes = totalBytes - downloadedBytes;
  return formatBytes(remainingBytes);
}

// ── Init ──────────────────────────────────────────────────────────
async function init() {
  state.settings = await window.fel7o.getSettings();
  el('folderPathLabel').textContent = state.settings.downloadFolder;
  el('concurrentInput').value = state.settings.concurrentDownloads;
  el('audioQualitySelect').value = state.settings.audioQuality;
  el('videoQualitySelect').value = state.settings.videoQuality;
  setSwitch('autoPasteSwitch', state.settings.autoPasteClipboard);
  setSwitch('thumbSwitch', state.settings.embedThumbnail);

  const [ffmpegOk, ytdlpOk] = await Promise.all([
    window.fel7o.checkFfmpeg(),
    window.fel7o.checkYtdlp(),
  ]);
  el('ffmpegStatus').textContent = ffmpegOk ? 'ffmpeg متاح ✓' : 'ffmpeg غير موجود — لازم يتحط في مجلد bin';
  el('ffmpegStatus').classList.add(ffmpegOk ? 'ok' : 'bad');
  el('ytdlpStatus').textContent = ytdlpOk ? 'yt-dlp متاح ✓' : 'yt-dlp غير موجود — لازم يتنزل';
  el('ytdlpStatus').classList.add(ytdlpOk ? 'ok' : 'bad');

  state.history = await window.fel7o.getHistory();

  setDownloadMode('mp3');
  bindEvents();
  bindPlaylistEvents();
  wireIpc();
  initWelcomePopup();
}

// ── Mode selector (mp3/video + quality) ────────────────────────────
function setDownloadMode(mode) {
  state.selectedMode = mode;
  el('modeMp3Btn').classList.toggle('active', mode === 'mp3');
  el('modeVideoBtn').classList.toggle('active', mode === 'video');

  const select = el('qualitySelect');
  const opts = QUALITY_OPTIONS[mode];
  const defaultValue = mode === 'mp3' ? state.settings.audioQuality : state.settings.videoQuality;
  select.innerHTML = opts.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
  select.value = defaultValue || opts[opts.length - 1].value;
  refreshPreviewBadgesIfShown();
}

function refreshPreviewBadgesIfShown() {
  if (state.previewUrl && state.previewData) renderPreviewCard(state.previewUrl, state.previewData);
}

// ── Welcome popup (shown once per install) ─────────────────────────
function initWelcomePopup() {
  el('welcomeName').textContent = WELCOME_CONFIG.name;
  el('welcomeMessage').textContent = WELCOME_CONFIG.message;
  const linksHtml = WELCOME_CONFIG.links.map((link) => `
    <a class="welcome-link" href="${link.url}" target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>
      <span>${escapeHtml(link.text)}</span>
    </a>
  `).join('');
  el('welcomeLinks').innerHTML = linksHtml;
  el('aboutLinks').innerHTML = linksHtml;

  if (!state.settings.hasSeenWelcome) {
    el('welcomeOverlay').hidden = false;
  }

  el('welcomeOkBtn').addEventListener('click', async () => {
    el('welcomeOverlay').hidden = true;
    state.settings = await window.fel7o.saveSettings({ hasSeenWelcome: true });
  });
}

function setSwitch(id, on) {
  const node = el(id);
  node.classList.toggle('on', !!on);
  node.dataset.on = on ? '1' : '0';
}

// ── Events ────────────────────────────────────────────────────────
function bindEvents() {
  el('addBtn').addEventListener('click', addToQueue);
  el('urlInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addToQueue(); });
  el('urlInput').addEventListener('input', () => scheduleUrlPreview(el('urlInput').value));
  el('pasteBtn').addEventListener('click', async () => {
    const text = await window.fel7o.readClipboard();
    if (text) { el('urlInput').value = text; scheduleUrlPreview(text, true); }
  });
  el('clearBtn').addEventListener('click', () => { el('urlInput').value = ''; clearUrlPreview(); });

  el('modeMp3Btn').addEventListener('click', () => setDownloadMode('mp3'));
  el('modeVideoBtn').addEventListener('click', () => setDownloadMode('video'));
  el('qualitySelect').addEventListener('change', refreshPreviewBadgesIfShown);

  el('settingsBtn').addEventListener('click', () => { el('historyOverlay').hidden = true; el('aboutOverlay').hidden = true; el('settingsOverlay').hidden = false; });
  el('closeSettings').addEventListener('click', () => { el('settingsOverlay').hidden = true; saveSettingsFromUI(); });
  el('settingsOverlay').addEventListener('click', (e) => { if (e.target.id === 'settingsOverlay') { el('settingsOverlay').hidden = true; saveSettingsFromUI(); } });

  el('historyBtn').addEventListener('click', async () => {
    el('settingsOverlay').hidden = true;
    el('aboutOverlay').hidden = true;
    state.history = await window.fel7o.getHistory();
    renderHistory();
    el('historyOverlay').hidden = false;
  });
  el('closeHistory').addEventListener('click', () => { el('historyOverlay').hidden = true; });
  el('historyOverlay').addEventListener('click', (e) => { if (e.target.id === 'historyOverlay') el('historyOverlay').hidden = true; });
  el('clearHistoryBtn').addEventListener('click', async () => {
    state.history = await window.fel7o.clearHistory();
    renderHistory();
  });
  el('historySearch').addEventListener('input', renderHistory);

  el('chooseFolderBtn').addEventListener('click', async () => {
    const folder = await window.fel7o.chooseFolder();
    if (folder) { el('folderPathLabel').textContent = folder; }
  });

  el('pauseAllBtn').addEventListener('click', async () => {
    await window.fel7o.pauseAll();
    state.jobs.forEach((job) => {
      if (job.status === 'downloading') job.status = 'paused';
    });
    renderQueue();
    renderHero();
  });

  el('resumeAllBtn').addEventListener('click', async () => {
    await window.fel7o.resumeAll();
    state.jobs.forEach((job) => {
      if (job.status === 'paused') job.status = 'downloading';
    });
    renderQueue();
    renderHero();
    maybeStartNext();
  });

  el('autoPasteSwitch').addEventListener('click', () => setSwitch('autoPasteSwitch', el('autoPasteSwitch').dataset.on !== '1'));
  el('thumbSwitch').addEventListener('click', () => setSwitch('thumbSwitch', el('thumbSwitch').dataset.on !== '1'));

  el('aboutBtn').addEventListener('click', () => {
    el('settingsOverlay').hidden = true;
    el('historyOverlay').hidden = true;
    el('aboutOverlay').hidden = false;
  });
  el('closeAbout').addEventListener('click', () => { el('aboutOverlay').hidden = true; });
  el('aboutOverlay').addEventListener('click', (e) => { if (e.target.id === 'aboutOverlay') el('aboutOverlay').hidden = true; });

  // Close more-actions menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.queue-more-menu')) {
      state.openMoreMenuId = null;
    }
  });
}

async function saveSettingsFromUI() {
  const patch = {
    downloadFolder: el('folderPathLabel').textContent,
    concurrentDownloads: parseInt(el('concurrentInput').value, 10) || 2,
    audioQuality: el('audioQualitySelect').value,
    videoQuality: el('videoQualitySelect').value,
    autoPasteClipboard: el('autoPasteSwitch').dataset.on === '1',
    embedThumbnail: el('thumbSwitch').dataset.on === '1',
  };
  state.settings = await window.fel7o.saveSettings(patch);
}

// ════════════════════════════════════════════════════════════════
// HERO PREVIEW — live metadata card shown while pasting a link
// ════════════════════════════════════════════════════════════════

function isValidYoutubeUrl(url) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//.test(url.trim());
}

function clearUrlPreview() {
  state.previewUrl = null;
  state.previewData = null;
  state.previewToken++;
  clearTimeout(state.previewDebounce);
  const section = el('urlPreviewSection');
  section.hidden = true;
  section.innerHTML = '';
  section.classList.remove('preview-animate-in');
}

function scheduleUrlPreview(rawUrl, immediate = false) {
  clearTimeout(state.previewDebounce);
  const url = (rawUrl || '').trim();

  if (!url) { clearUrlPreview(); return; }
  if (!isValidYoutubeUrl(url)) {
    if (url.length > 12 && /^https?:\/\//.test(url)) {
      renderPreviewError('الرابط ده مش رابط يوتيوب صحيح');
    } else {
      clearUrlPreview();
    }
    return;
  }

  const delay = immediate ? 0 : 500;
  state.previewDebounce = setTimeout(() => fetchUrlPreview(url), delay);
}

function renderPreviewSkeleton() {
  const section = el('urlPreviewSection');
  section.hidden = false;
  section.classList.add('preview-animate-in');
  section.innerHTML = `
    <div class="url-preview-card skeleton-card content-swap-in">
      <div class="skeleton sk-thumb"></div>
      <div class="sk-col">
        <div class="skeleton sk-title"></div>
        <div class="skeleton sk-title short"></div>
        <div class="skeleton sk-channel"></div>
        <div class="sk-row">
          <div class="skeleton sk-chip"></div>
          <div class="skeleton sk-chip"></div>
          <div class="skeleton sk-chip"></div>
        </div>
      </div>
    </div>`;
}

function renderPreviewError(message) {
  const section = el('urlPreviewSection');
  section.hidden = false;
  section.classList.add('preview-animate-in');
  section.innerHTML = `
    <div class="url-preview-card preview-error content-swap-in">
      <div class="preview-error-icon">⚠️</div>
      <div class="preview-error-body">
        <div class="preview-error-text">${escapeHtml(message)}</div>
        <div class="preview-error-sub">تأكد إن الرابط صحيح وحاول تاني</div>
      </div>
      <button type="button" class="preview-error-retry" id="previewRetryBtn">إعادة المحاولة</button>
    </div>`;
  const retryBtn = document.getElementById('previewRetryBtn');
  if (retryBtn) retryBtn.addEventListener('click', () => scheduleUrlPreview(el('urlInput').value, true));
}

const META_ICONS = {
  eye: '<svg viewBox="0 0 24 24"><path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><path d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm12 8v10H5V10h14z"/></svg>',
  resolution: '<svg viewBox="0 0 24 24"><path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v10h14V7H5zm2 2h4v2H7V9z"/></svg>',
  size: '<svg viewBox="0 0 24 24"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A6 6 0 0 0 6 20h13a5 5 0 0 0 .35-9.96zM10 17l-3-3.5h2v-3h2v3h2L10 17z"/></svg>',
};

function fetchUrlPreview(url) {
  state.previewUrl = url;
  const token = ++state.previewToken;
  renderPreviewSkeleton();

  window.fel7o.getVideoInfo(url).then((info) => {
    if (token !== state.previewToken || state.previewUrl !== url) return; // stale response
    if (!info || info.error) {
      renderPreviewError(info && info.error ? info.error : 'تعذر جلب بيانات الفيديو');
      state.previewData = null;
      return;
    }
    state.previewData = info;
    renderPreviewCard(url, info);
  }).catch(() => {
    if (token !== state.previewToken || state.previewUrl !== url) return;
    renderPreviewError('تعذر الاتصال — تأكد من اتصالك بالإنترنت');
    state.previewData = null;
  });
}

function renderPreviewCard(url, info) {
  const section = el('urlPreviewSection');
  section.hidden = false;
  section.classList.add('preview-animate-in');

  const badges = [];
  if (info.isLive) badges.push(`<span class="badge badge-live"><span class="preview-live-dot"></span> مباشر</span>`);
  if (info.isShort) badges.push(`<span class="badge badge-shorts">Shorts</span>`);
  if (info.isPlaylistLink) badges.push(`<span class="badge badge-playlist">قائمة تشغيل</span>`);
  badges.push(`<span class="badge badge-format">${state.selectedMode === 'mp3' ? 'MP3' : 'MP4'}</span>`);
  badges.push(`<span class="badge badge-quality">${escapeHtml(el('qualitySelect').value)}${state.selectedMode === 'mp3' ? 'k' : 'p'}</span>`);

  const metaItems = [];
  if (info.viewCount) metaItems.push(`<span class="preview-meta-item">${META_ICONS.eye}${escapeHtml(info.viewCount)} مشاهدة</span>`);
  if (info.uploadDate) metaItems.push(`<span class="preview-meta-item">${META_ICONS.calendar}${escapeHtml(info.uploadDate)}</span>`);
  if (info.resolution) metaItems.push(`<span class="preview-meta-item">${META_ICONS.resolution}${escapeHtml(info.resolution)}</span>`);
  if (info.estimatedSize) {
    metaItems.push(`<span class="preview-meta-item">${META_ICONS.size}${escapeHtml(info.estimatedSize)}~</span>`);
  } else {
    metaItems.push(`<span class="preview-meta-item is-placeholder">${META_ICONS.size}الحجم غير معروف</span>`);
  }

  section.innerHTML = `
    <div class="url-preview-card content-swap-in">
      <div class="preview-thumb-wrap">
        <div class="preview-thumb" id="previewThumb" title="فتح في المتصفح" ${info.thumbnail ? `style="background-image:url('${escapeHtml(info.thumbnail)}')"` : ''}></div>
      </div>
      <div class="preview-content">
        <div class="preview-title">${escapeHtml(info.title || url)}</div>
        <div class="preview-channel">${escapeHtml(info.channel || '—')}</div>
        <div class="preview-badges">${badges.join('')}</div>
        <div class="preview-meta">${metaItems.join('')}</div>
      </div>
    </div>`;

  const thumb = document.getElementById('previewThumb');
  if (thumb && info.url) {
    thumb.addEventListener('click', () => window.fel7o.openExternal(info.url));
    thumb.style.cursor = 'pointer';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Queue / jobs ──────────────────────────────────────────────────
async function addToQueue() {
  const url = el('urlInput').value.trim();
  if (!url) return;
  if (!isValidYoutubeUrl(url)) {
    showToast('رابط يوتيوب غير صالح');
    return;
  }
  await saveSettingsFromUI();

  const chosenMode = state.selectedMode;
  const chosenQuality = el('qualitySelect').value;
  const cachedInfo = (state.previewUrl === url && state.previewData) ? state.previewData : null;

  const job = {
    id: uid(),
    url,
    title: (cachedInfo && cachedInfo.title) || url,
    channel: (cachedInfo && cachedInfo.channel) || '—',
    thumbnail: (cachedInfo && cachedInfo.thumbnail) || null,
    mode: chosenMode,
    audioFormat: state.settings.audioFormat,
    audioQuality: chosenMode === 'mp3' ? chosenQuality : state.settings.audioQuality,
    videoQuality: chosenMode === 'video' ? chosenQuality : state.settings.videoQuality,
    videoContainer: state.settings.videoContainer,
    status: 'queued',
    percent: 0,
    speed: '',
    eta: '',
    totalSize: '',
  };
  state.jobs.set(job.id, job);
  state.jobOrder.push(job.id);
  el('urlInput').value = '';
  clearUrlPreview();

  renderQueue();
  maybeStartNext();
  fetchJobInfo(job.id);
}

async function fetchJobInfo(jobId) {
  const job = state.jobs.get(jobId);
  if (!job) return;
  try {
    const info = await window.fel7o.getVideoInfo(job.url);
    const stillExists = state.jobs.get(jobId);
    if (!stillExists || !info) return;
    if (info.title) stillExists.title = info.title;
    if (info.channel) stillExists.channel = info.channel;
    if (info.thumbnail) stillExists.thumbnail = info.thumbnail;
    renderQueue();
    renderHero();
  } catch (e) {
    // Silently ignore — fall back to showing the raw URL as the title.
  }
}

function activeCount() {
  return [...state.jobs.values()].filter((j) => j.status === 'downloading').length;
}

function maybeStartNext() {
  const limit = state.settings.concurrentDownloads || 2;
  if (activeCount() >= limit) return;
  const next = state.jobOrder.map((id) => state.jobs.get(id)).find((j) => j && j.status === 'queued');
  if (!next) return;
  startJob(next);
}

async function startJob(job) {
  job.status = 'downloading';
  if (!state.activeJobId) state.activeJobId = job.id;
  renderQueue();
  renderHero();
  await window.fel7o.startDownload(job);
}

async function pauseJob(id) {
  const job = state.jobs.get(id);
  if (!job) return;
  const ok = await window.fel7o.pauseDownload(id);
  if (ok) {
    job.status = 'paused';
    renderQueue();
    renderHero();
  }
}

async function resumeJob(id) {
  const job = state.jobs.get(id);
  if (!job) return;
  const ok = await window.fel7o.resumeDownload(id);
  if (ok) {
    job.status = 'downloading';
    renderQueue();
    renderHero();
    maybeStartNext();
  }
}

function retryJob(id) {
  const job = state.jobs.get(id);
  if (!job) return;
  job.status = 'queued';
  job.percent = 0;
  job.speed = '';
  job.eta = '';
  renderQueue();
  maybeStartNext();
}

function openFolder(id) {
  const job = state.jobs.get(id);
  if (!job || !state.settings) return;
  window.fel7o.openFolder(state.settings.downloadFolder);
}

function cancelJob(id) {
  const job = state.jobs.get(id);
  if (!job) return;
  if (job.status === 'downloading') {
    window.fel7o.cancelDownload(id);
  } else {
    job.status = 'cancelled';
    renderQueue();
    renderHero();
  }
}

function removeFromQueueUI(id) {
  state.jobs.delete(id);
  state.jobOrder = state.jobOrder.filter((x) => x !== id);
  if (state.activeJobId === id) {
    state.activeJobId = state.jobOrder.find((oid) => {
      const j = state.jobs.get(oid);
      return j && j.status === 'downloading';
    }) || null;
  }
  renderQueue();
  renderHero();
}

function advanceActiveJobIfNeeded(finishedId) {
  if (state.activeJobId !== finishedId) return;
  state.activeJobId = state.jobOrder.find((oid) => {
    const j = state.jobs.get(oid);
    return j && (j.status === 'downloading' || j.status === 'queued');
  }) || null;
}

// ── IPC wiring ──────────────────────────────────────────────────────
function wireIpc() {
  window.fel7o.onProgress((data) => {
    const job = state.jobs.get(data.id);
    if (!job) return;
    if (typeof data.percent === 'number') job.percent = data.percent;
    if (data.speed) job.speed = data.speed;
    if (data.eta) job.eta = data.eta;
    if (data.totalSize) job.totalSize = data.totalSize;
    renderQueue();
    renderHero();
  });

  window.fel7o.onDone(async (data) => {
    const job = state.jobs.get(data.id);
    if (!job) return;
    job.status = 'completed';
    job.percent = 100;
    advanceActiveJobIfNeeded(data.id);

    window.fel7o.notify({
      title: 'اكتمل التحميل ✅',
      body: `تم تحميل "${job.title}" بنجاح.`
    });

    await window.fel7o.addHistory({
      id: uid(), url: job.url, title: job.title, channel: job.channel,
      thumbnail: job.thumbnail || null, mode: job.mode,
      date: new Date().toISOString(), folder: state.settings.downloadFolder,
    });
    renderQueue();
    renderHero();
    maybeStartNext();
  });

  window.fel7o.onError((data) => {
    const job = state.jobs.get(data.id);
    if (!job) return;
    job.status = 'error';
    job.errorMessage = data.message;
    advanceActiveJobIfNeeded(data.id);

    window.fel7o.notify({
      title: 'فشل التحميل ⚠️',
      body: `حدث خطأ أثناء تحميل "${job.title}".`
    });

    showToast(`فشل التحميل: ${data.message || 'خطأ غير معروف'}`);
    console.error('Download error details:', data);
    renderQueue();
    renderHero();
    maybeStartNext();
  });

  window.fel7o.onCancelled((data) => {
    const job = state.jobs.get(data.id);
    if (!job) return;
    job.status = 'cancelled';
    advanceActiveJobIfNeeded(data.id);
    renderQueue();
    renderHero();
    maybeStartNext();
  });
}

// ── Rendering ────────────────────────────────────────────────────────
const STATUS_LABEL = {
  queued: 'في الانتظار', downloading: 'جاري التحميل', paused: 'متوقف',
  completed: 'مكتمل', error: 'خطأ', cancelled: 'ملغي',
};

function badgeHtml(job) {
  return `<span class="badge badge-${job.status}">${STATUS_LABEL[job.status] || job.status}</span>`;
}

function renderHero() {
  const wrap = el('heroCard');
  const job = state.activeJobId ? state.jobs.get(state.activeJobId) : null;
  if (!job) {
    wrap.innerHTML = `<div class="hero-empty" id="heroEmpty">
      <div class="hero-empty-icon">🎬</div>
      <div class="hero-empty-title">لسه مفيش تحميل شغال</div>
      <div class="hero-empty-sub">الصق رابط فوق واضغط تحميل عشان يبدأ</div>
    </div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="hero-content">
      <div class="hero-thumb" ${job.thumbnail ? `style="background-image:url('${escapeHtml(job.thumbnail)}')"` : ''}></div>
      <div class="hero-info">
        <div class="hero-title">${escapeHtml(job.title)}</div>
        <div class="hero-channel">${escapeHtml(job.channel)}</div>
        <div class="hero-badges">
          ${badgeHtml(job)}
          <span class="badge badge-format">${job.mode === 'mp3' ? 'MP3' : 'MP4'}</span>
          <span class="badge badge-quality">${job.mode === 'mp3' ? job.audioQuality + 'k' : job.videoQuality}</span>
        </div>
        <div class="progress-wrap">
          <div class="progress-track"><div class="progress-fill ${job.status === 'error' ? 'err' : ''}" style="width:${job.percent || 0}%"></div></div>
          <div class="progress-meta">
            <span>${(job.percent || 0).toFixed(1)}%</span>
            <span>${job.speed || ''} ${job.eta ? '· ETA ' + job.eta : ''}</span>
          </div>
        </div>
      </div>
    </div>`;
}

function updateQueueStats() {
  const stats = {
    downloading: 0,
    waiting: 0,
    completed: 0,
    failed: 0,
    totalPercent: 0,
    totalSpeed: 0,
  };

  let totalPercent = 0;
  let downloadingCount = 0;

  state.jobOrder.forEach((id) => {
    const job = state.jobs.get(id);
    if (!job) return;
    if (job.status === 'downloading') {
      stats.downloading++;
      totalPercent += job.percent || 0;
      downloadingCount++;
    } else if (job.status === 'queued') {
      stats.waiting++;
    } else if (job.status === 'completed') {
      stats.completed++;
    } else if (job.status === 'error' || job.status === 'cancelled') {
      stats.failed++;
    }
  });

  const hasJobs = state.jobOrder.length > 0;
  el('queueStats').hidden = !hasJobs;

  if (hasJobs) {
    el('queueStatDownloading').textContent = stats.downloading;
    el('queueStatWaiting').textContent = stats.waiting;
    el('queueStatCompleted').textContent = stats.completed;
    el('queueStatFailed').textContent = stats.failed;
    const avgPercent = downloadingCount > 0 ? Math.round(totalPercent / downloadingCount) : 0;
    el('queueStatProgress').textContent = `${avgPercent}%`;
    el('queueStatProgressBar').style.width = `${avgPercent}%`;
    // For total speed, sum all downloading jobs' speeds
    let totalSpeed = 0;
    state.jobOrder.forEach((id) => {
      const job = state.jobs.get(id);
      if (job && job.status === 'downloading' && job.speed) {
        const match = job.speed.match(/(\d+(?:\.\d+)?)\s*(MB|KB|GB)\/s/);
        if (match) {
          let speedMbs = parseFloat(match[1]);
          if (match[2] === 'KB') speedMbs /= 1024;
          else if (match[2] === 'GB') speedMbs *= 1024;
          totalSpeed += speedMbs;
        }
      }
    });
    el('queueStatSpeed').textContent = totalSpeed > 0 ? `${totalSpeed.toFixed(1)} MB/s` : '—';
  }
}

function renderQueue() {
  const list = el('queueList');
  const others = state.jobOrder.map((id) => state.jobs.get(id)).filter((j) => j && j.id !== state.activeJobId);
  el('queueCount').textContent = `${state.jobOrder.length} عناصر`;
  updateQueueStats();

  if (state.jobOrder.length === 0) {
    list.innerHTML = `<div class="queue-empty">لسه مفيش تحميلات في الطابور</div>`;
    return;
  }

  list.innerHTML = others.map((job) => {
    const progressPercent = job.percent || 0;
    const format = job.mode === 'mp3' ? 'MP3' : 'MP4';
    const quality = job.mode === 'mp3' ? job.audioQuality + 'k' : job.videoQuality;
    const statusLabel = STATUS_LABEL[job.status] || job.status;
    const statusClass = job.status === 'downloading' ? 'downloading' : job.status === 'paused' ? 'paused' : job.status === 'completed' ? 'completed' : job.status === 'error' ? 'error' : '';
    const downloadedSize = getDownloadedSize(job);
    const remainingSize = getRemainingSize(job);

    return `
      <div class="queue-card premium" data-id="${job.id}">
        <!-- Thumbnail -->
        <div class="queue-thumb" ${job.thumbnail ? `style="background-image:url('${escapeHtml(job.thumbnail)}')"` : ''}></div>
        
        <!-- Main Content -->
        <div class="queue-info">
          <!-- Title & Channel -->
          <div class="queue-header">
            <div class="queue-title">${escapeHtml(job.title)}</div>
            <div class="queue-channel">${escapeHtml(job.channel)}</div>
          </div>

          <!-- Progress Bar (only for downloading) -->
          ${job.status === 'downloading' ? `
          <div class="queue-progress-section">
            <div class="queue-progress-wrap">
              <div class="queue-progress-track">
                <div class="queue-progress-fill" style="width:${progressPercent}%"></div>
              </div>
              <div class="queue-progress-labels">
                <span class="queue-progress-percent">${progressPercent.toFixed(1)}%</span>
              </div>
            </div>
          </div>
          ` : ''}

          <!-- Stats Grid -->
          <div class="queue-stats-grid">
            <div class="queue-stat">
              <div class="queue-stat-label">تنسيق</div>
              <div class="queue-stat-value">${format}</div>
            </div>
            <div class="queue-stat">
              <div class="queue-stat-label">جودة</div>
              <div class="queue-stat-value">${quality}</div>
            </div>
            ${job.status === 'downloading' ? `
            <div class="queue-stat">
              <div class="queue-stat-label">السرعة</div>
              <div class="queue-stat-value">${job.speed || '—'}</div>
            </div>
            <div class="queue-stat">
              <div class="queue-stat-label">الوقت المتبقي</div>
              <div class="queue-stat-value">${job.eta || '—'}</div>
            </div>
            <div class="queue-stat">
              <div class="queue-stat-label">تم التحميل</div>
              <div class="queue-stat-value">${downloadedSize}</div>
            </div>
            <div class="queue-stat">
              <div class="queue-stat-label">المتبقي</div>
              <div class="queue-stat-value">${remainingSize}</div>
            </div>
            ` : `
            <div class="queue-stat">
              <div class="queue-stat-label">الحجم الكلي</div>
              <div class="queue-stat-value">${job.totalSize || '—'}</div>
            </div>
            `}
          </div>

          <!-- Badges -->
          <div class="queue-badges">
            <span class="queue-badge queue-badge-format">${format}</span>
            <span class="queue-badge queue-badge-quality">${quality}</span>
            <span class="queue-badge queue-badge-status ${statusClass}">${statusLabel}</span>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="queue-actions">
          ${job.status === 'downloading' ? `
            <button class="queue-action-btn pause-job" data-id="${job.id}" title="إيقاف مؤقت">
              <svg viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" fill="currentColor"/></svg>
            </button>
            <button class="queue-action-btn cancel-job" data-id="${job.id}" title="إلغاء">
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none"/></svg>
            </button>
          ` : job.status === 'paused' ? `
            <button class="queue-action-btn resume-job" data-id="${job.id}" title="استئناف">
              <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
            </button>
            <button class="queue-action-btn cancel-job" data-id="${job.id}" title="إلغاء">
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none"/></svg>
            </button>
          ` : job.status === 'queued' ? `
            <button class="queue-action-btn cancel-job" data-id="${job.id}" title="إلغاء">
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none"/></svg>
            </button>
          ` : job.status === 'error' ? `
            <button class="queue-action-btn retry-job" data-id="${job.id}" title="إعادة المحاولة">
              <svg viewBox="0 0 24 24"><path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" stroke-width="2" fill="none"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" stroke="currentColor" stroke-width="2" fill="none"/></svg>
            </button>
            <button class="queue-action-btn remove-job" data-id="${job.id}" title="إزالة">
              <svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>
            </button>
          ` : `
            <button class="queue-action-btn open-folder" data-id="${job.id}" title="فتح المجلد">
              <svg viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z" fill="currentColor"/></svg>
            </button>
            <button class="queue-action-btn remove-job" data-id="${job.id}" title="إزالة">
              <svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>
            </button>
          `}
          
          <!-- More Actions Menu -->
          <div class="queue-more-menu">
            <button class="queue-action-btn more-menu-btn" data-id="${job.id}" title="المزيد">
              <svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-1 2-2s-1-2-2-2-2 1-2 2 1 2 2 2zm0 2c-1.1 0-2 1-2 2s1 2 2 2 2-1 2-2-1-2-2-2zm0 6c-1.1 0-2 1-2 2s1 2 2 2 2-1 2-2-1-2-2-2z" fill="currentColor"/></svg>
            </button>
            <div class="queue-more-menu-content" ${state.openMoreMenuId === job.id ? '' : 'hidden'}>
              <button class="queue-menu-item open-folder-menu" data-id="${job.id}">
                <svg viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z" fill="currentColor"/></svg>
                <span>فتح المجلد</span>
              </button>
              <button class="queue-menu-item copy-url-menu" data-id="${job.id}" data-url="${escapeHtml(job.url)}">
                <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" fill="currentColor"/></svg>
                <span>نسخ الرابط</span>
              </button>
              <button class="queue-menu-item open-url-menu" data-id="${job.id}" data-url="${escapeHtml(job.url)}">
                <svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83l1.41 1.41L19 6.41V10h2V3h-7z" fill="currentColor"/></svg>
                <span>فتح في المتصفح</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Wire up action buttons
  list.querySelectorAll('.pause-job').forEach((btn) => btn.addEventListener('click', () => pauseJob(btn.dataset.id)));
  list.querySelectorAll('.resume-job').forEach((btn) => btn.addEventListener('click', () => resumeJob(btn.dataset.id)));
  list.querySelectorAll('.cancel-job').forEach((btn) => btn.addEventListener('click', () => cancelJob(btn.dataset.id)));
  list.querySelectorAll('.retry-job').forEach((btn) => btn.addEventListener('click', () => retryJob(btn.dataset.id)));
  list.querySelectorAll('.remove-job').forEach((btn) => btn.addEventListener('click', () => removeFromQueueUI(btn.dataset.id)));
  list.querySelectorAll('.open-folder').forEach((btn) => btn.addEventListener('click', () => openFolder(btn.dataset.id)));

  // Wire up more-actions menu
  list.querySelectorAll('.more-menu-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const jobId = btn.dataset.id;
      state.openMoreMenuId = state.openMoreMenuId === jobId ? null : jobId;
      renderQueue();
    });
  });

  list.querySelectorAll('.open-folder-menu').forEach((btn) => {
    btn.addEventListener('click', () => openFolder(btn.dataset.id));
  });

  list.querySelectorAll('.copy-url-menu').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      navigator.clipboard.writeText(url).then(() => {
        showToast('تم نسخ الرابط');
      });
    });
  });

  list.querySelectorAll('.open-url-menu').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      window.fel7o.openExternal(url);
    });
  });
}

function renderHistory() {
  const q = (el('historySearch').value || '').toLowerCase();
  const list = el('historyList');
  const items = state.history.filter((h) => !q || (h.title || h.url).toLowerCase().includes(q));
  if (items.length === 0) {
    list.innerHTML = `<div class="history-empty">لا يوجد سجل بعد</div>`;
    return;
  }
  list.innerHTML = items.map((h) => `
    <div class="queue-card">
      <div class="queue-thumb" ${h.thumbnail ? `style="background-image:url('${escapeHtml(h.thumbnail)}')"` : ''}></div>
      <div class="queue-info">
        <div class="queue-title">${escapeHtml(h.title || h.url)}</div>
        <div class="queue-sub">
          <span class="badge badge-completed">مكتمل</span>
          <span>${new Date(h.date).toLocaleString('ar-EG')}</span>
        </div>
      </div>
      <div class="queue-actions">
        <button class="mini-icon-btn open-folder" data-folder="${escapeHtml(h.folder || '')}" title="فتح المجلد">📁</button>
        <button class="mini-icon-btn delete-history" data-id="${h.id}" title="حذف">🗑</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.open-folder').forEach((btn) => btn.addEventListener('click', () => window.fel7o.openFolder(btn.dataset.folder)));
  list.querySelectorAll('.delete-history').forEach((btn) => btn.addEventListener('click', async () => {
    state.history = await window.fel7o.deleteHistory(btn.dataset.id);
    renderHistory();
  }));
}


// ── Playlist Manager ──────────────────────────────────────────────
function formatApproxSize(bytes) {
  if (!bytes || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function estimateVideoBytes(durationSecs) {
  if (!durationSecs) return 0;
  // Rough heuristic matching the single-video estimate used elsewhere in the app:
  // ~ (bitrate) * duration. Good enough for a "approximate" playlist total.
  const bitrateKbps = state.selectedMode === 'mp3' ? parseInt(el('qualitySelect').value, 10) || 192
    : { '2160': 40000, '1440': 16000, '1080': 8000, '720': 5000, '480': 2500, best: 8000 }[el('qualitySelect').value] || 8000;
  return (bitrateKbps * 1000 / 8) * durationSecs;
}

function openPlaylistManager(url) {
  state.playlist.url = url;
  state.playlist.data = null;
  state.playlist.selected = new Set();
  state.playlist.searchQuery = '';
  el('playlistSearch') && (el('playlistSearch').value = '');

  el('settingsOverlay').hidden = true;
  el('historyOverlay').hidden = true;
  el('aboutOverlay').hidden = true;
  el('playlistOverlay').hidden = false;

  el('playlistLoading').hidden = false;
  el('playlistError').hidden = true;
  el('playlistContent').hidden = true;
  el('playlistFooter').hidden = true;
  el('playlistLoadingCount').textContent = '';

  fetchPlaylistInfo(url);
}

function closePlaylistManager() {
  el('playlistOverlay').hidden = true;
  state.playlist.url = null;
  state.playlist.data = null;
  state.playlist.selected = new Set();
}

function fetchPlaylistInfo(url) {
  const token = ++state.playlist.token;
  window.fel7o.getPlaylistInfo(url).then((data) => {
    if (token !== state.playlist.token || state.playlist.url !== url) return; // stale
    if (!data || data.error) {
      renderPlaylistError(data && data.error ? data.error : 'تعذر تحميل بيانات القائمة');
      return;
    }
    if (!data.videos || data.videos.length === 0) {
      renderPlaylistError('القائمة فاضية أو خاصة — تأكد إنها عامة');
      return;
    }
    state.playlist.data = data;
    // Default: everything selected.
    state.playlist.selected = new Set(data.videos.map((v) => v.id));
    el('playlistLoading').hidden = true;
    el('playlistError').hidden = true;
    el('playlistContent').hidden = false;
    el('playlistFooter').hidden = false;
    renderPlaylistContent();
  }).catch((err) => {
    if (token !== state.playlist.token) return;
    renderPlaylistError('خطأ في الاتصال: ' + (err.message || 'حاول تاني'));
  });
}

function renderPlaylistError(message) {
  el('playlistLoading').hidden = true;
  el('playlistError').hidden = false;
  el('playlistContent').hidden = true;
  el('playlistFooter').hidden = true;
  el('playlistErrorText').textContent = message;
  el('playlistRetryBtn').addEventListener('click', () => fetchPlaylistInfo(state.playlist.url));
}

function renderPlaylistContent() {
  const data = state.playlist.data;
  if (!data) return;

  el('playlistSummaryTitle').textContent = data.title || 'قائمة تشغيل';
  el('playlistSummarySub').textContent = data.channel || '—';
  el('playlistStatCount').textContent = data.videos.length;
  el('playlistStatSelected').textContent = state.playlist.selected.size;

  let totalDuration = 0;
  data.videos.forEach((v) => { totalDuration += v.durationSecs || 0; });
  const hours = Math.floor(totalDuration / 3600);
  const mins = Math.floor((totalDuration % 3600) / 60);
  el('playlistStatDuration').textContent = `${hours}س ${mins}د`;

  const totalBytes = data.videos.reduce((sum, v) => sum + estimateVideoBytes(v.durationSecs), 0);
  el('playlistStatSize').textContent = formatApproxSize(totalBytes) || '—';

  el('playlistSelectAllBtn').addEventListener('click', () => {
    state.playlist.selected = new Set(data.videos.map((v) => v.id));
    renderPlaylistContent();
  });
  el('playlistDeselectAllBtn').addEventListener('click', () => {
    state.playlist.selected = new Set();
    renderPlaylistContent();
  });
  el('playlistInvertBtn').addEventListener('click', () => {
    const newSelected = new Set();
    data.videos.forEach((v) => {
      if (!state.playlist.selected.has(v.id)) newSelected.add(v.id);
    });
    state.playlist.selected = newSelected;
    renderPlaylistContent();
  });

  el('playlistSearch').addEventListener('input', renderPlaylistContent);
  el('playlistApplyRangeBtn').addEventListener('click', () => {
    const from = parseInt(el('playlistRangeFrom').value, 10);
    const to = parseInt(el('playlistRangeTo').value, 10);
    if (from && to && from <= to) {
      state.playlist.selected = new Set();
      data.videos.forEach((v, i) => {
        if (i + 1 >= from && i + 1 <= to) state.playlist.selected.add(v.id);
      });
      renderPlaylistContent();
    }
  });

  const q = (el('playlistSearch').value || '').toLowerCase();
  const filtered = data.videos.filter((v) => !q || (v.title || '').toLowerCase().includes(q));

  const itemsHtml = filtered.map((v, idx) => `
    <div class="playlist-item ${state.playlist.selected.has(v.id) ? 'is-selected' : ''}">
      <label class="playlist-item-check">
        <input type="checkbox" class="playlist-item-checkbox" data-id="${v.id}" ${state.playlist.selected.has(v.id) ? 'checked' : ''} />
        <div class="playlist-item-checkmark"></div>
      </label>
      <div class="playlist-item-position">${idx + 1}</div>
      <div class="playlist-item-thumb" ${v.thumbnail ? `style="background-image:url('${escapeHtml(v.thumbnail)}')"` : ''}>
        <div class="playlist-item-duration">${Math.floor((v.durationSecs || 0) / 60)}:${String((v.durationSecs || 0) % 60).padStart(2, '0')}</div>
      </div>
      <div class="playlist-item-info">
        <div class="playlist-item-title">${escapeHtml(v.title || '—')}</div>
        <div class="playlist-item-channel">${escapeHtml(v.channel || '—')}</div>
      </div>
    </div>
  `).join('');
  el('playlistItems').innerHTML = itemsHtml;

  el('playlistItems').querySelectorAll('.playlist-item-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) {
        state.playlist.selected.add(cb.dataset.id);
      } else {
        state.playlist.selected.delete(cb.dataset.id);
      }
      renderPlaylistContent();
    });
  });

  el('playlistFooterInfo').textContent = `${state.playlist.selected.size} فيديو مختار`;
  el('playlistConfirmBtn').disabled = state.playlist.selected.size === 0;
  el('playlistConfirmBtn').addEventListener('click', async () => {
    const selected = data.videos.filter((v) => state.playlist.selected.has(v.id));
    for (const video of selected) {
      const job = {
        id: uid(),
        url: video.url,
        title: video.title,
        channel: video.channel,
        thumbnail: video.thumbnail || null,
        mode: state.selectedMode,
        audioFormat: state.settings.audioFormat,
        audioQuality: state.selectedMode === 'mp3' ? el('qualitySelect').value : state.settings.audioQuality,
        videoQuality: state.selectedMode === 'video' ? el('qualitySelect').value : state.settings.videoQuality,
        videoContainer: state.settings.videoContainer,
        status: 'queued',
        percent: 0,
        speed: '',
        eta: '',
        totalSize: '',
      };
      state.jobs.set(job.id, job);
      state.jobOrder.push(job.id);
    }
    renderQueue();
    maybeStartNext();
    closePlaylistManager();
  });
  el('playlistCancelBtn').addEventListener('click', closePlaylistManager);
}

function bindPlaylistEvents() {
  // Handled in renderPlaylistContent
}

// ── Init on page load ────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);
