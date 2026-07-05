# Fel7o Downloader (Electron edition)

## تشغيل المشروع أول مرة (على جهازك، ويندوز)

```
cd fel7o-electron
npm install
npm start
```

هيفتح نافذة Electron فيها الواجهة الجديدة.

## محتاج قبل ما تشتغل فعليًا

1. **yt-dlp.exe** — حمّله من:
   https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe
   وحطه في مجلد جديد اسمه `bin` جوه المشروع: `fel7o-electron/bin/yt-dlp.exe`
   (البرنامج بيدور عليه هناك، أو في الـ PATH لو مثبت عالمي)

2. **ffmpeg.exe** — اختياري بس محتاج للتحويل لصيغ صوت معينة ودمج الفيديو/الصوت.
   حطه في نفس مجلد `bin/ffmpeg.exe`، أو ثبته عالميًا وحطه في الـ PATH.

## بناء نسخة exe نهائية للتوزيع

```
npm run dist
```

الناتج هيبقى في مجلد `release/win-unpacked/` — ده المجلد اللي تدّيه للمستخدمين
(فيه `Fel7o Downloader.exe` + كل ملفات Electron/Chromium المطلوبة، بالظبط
زي شكل Vidora اللي شفته).

## ملاحظات

- التصميم بيستخدم ألوان/نظام تصميم premium (ألوان، كروت، أنيميشن) حسب
  البرومبت اللي حددته.
- المنطق (queue, history, settings, progress parsing) شغال فعليًا مش mockup،
  بس محتاج اختبار حقيقي على جهازك مع رابط يوتيوب فعلي.
- لو yt-dlp مش موجود، الواجهة هتبين "yt-dlp غير موجود" في شريط الحالة تحت.
