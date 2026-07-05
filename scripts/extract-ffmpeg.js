// scripts/extract-ffmpeg.js
// بيتشغل تلقائي بعد "npm install" (postinstall).
// بيفك bin/ffmpeg.zip ويحط ffmpeg.exe جنبه في نفس مجلد bin.
// لو ffmpeg.exe موجود بالفعل، بيتخطى العملية (مفيش داعي يفك تاني).

const fs = require('fs');
const path = require('path');

async function main() {
  const binDir = path.join(__dirname, '..', 'bin');
  const zipPath = path.join(binDir, 'ffmpeg.zip');
  const exePath = path.join(binDir, 'ffmpeg.exe');

  if (fs.existsSync(exePath)) {
    console.log('✅ ffmpeg.exe موجود بالفعل — مفيش داعي لفك الضغط.');
    return;
  }

  if (!fs.existsSync(zipPath)) {
    console.warn('⚠️  bin/ffmpeg.zip مش موجود — تأكد إنه موجود في المشروع.');
    return;
  }

  let extract;
  try {
    extract = require('extract-zip');
  } catch (e) {
    console.warn('⚠️  حزمة extract-zip مش متثبتة. شغّل: npm install extract-zip --save-dev');
    return;
  }

  try {
    await extract(zipPath, { dir: binDir });
    if (fs.existsSync(exePath)) {
      console.log('✅ تم فك ضغط ffmpeg.exe بنجاح داخل bin/.');
    } else {
      console.warn('⚠️  اتفك الضغط بس ffmpeg.exe مش في المكان المتوقع، افحص محتوى bin/.');
    }
  } catch (err) {
    console.error('❌ فشل فك ضغط ffmpeg.zip:', err.message);
  }
}

main();
