(function() {
  'use strict';

  // ── STATE ──
  let currentFile = null, origFile = null;
  let origWidth = 0, origHeight = 0, aspectRatio = 1;
  let lockAspect = true;
  let compressFmt = 'jpeg', resizeFmt = 'jpeg';
  let compressMode = 'quality', targetUnit = 'KB';
  let selectedPreset = null;
  let activePresetCategory = 'all';
  let presetSearchTerm = '';
  let activeSocialPlatform = 'all';
  let socialSearchTerm = '';
  let hasCropped = false;

  // Crop state
  let cropScale = 1, cropImgNatW = 0, cropImgNatH = 0;
  let cropRatioW = 0, cropRatioH = 0;
  let box = { x:0, y:0, w:0, h:0 };
  let dragMode = null, dragStart = {x:0,y:0}, boxSnap = {x:0,y:0,w:0,h:0};
  let cropRenderQueued = false;
  let pageScrollY = 0;

  // ── THEME ──
  const themeToggle = document.getElementById('themeToggle');
  themeToggle.addEventListener('click', function() {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('proresize-theme', next);
  });
  const savedTheme = localStorage.getItem('proresize-theme');
  if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
  // Default is already dark from HTML attribute

  // ── TABS ──
  document.getElementById('tabBar').addEventListener('click', function(e) {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('sec-compress').classList.toggle('active', tab === 'compress');
    document.getElementById('sec-resize').classList.toggle('active', tab === 'resize');
    document.getElementById('sec-presets').classList.toggle('active', tab === 'presets');
    document.getElementById('sec-social').classList.toggle('active', tab === 'social');
    if (tab === 'presets') renderPresets();
    if (tab === 'social') renderSocial();
  });

  // ── FILE INPUT ──
  const fileInput = document.getElementById('fileInput');
  const dropZone = document.getElementById('dropZone');

  // File input change handler
  fileInput.addEventListener('change', function() {
    if (this.files[0]) handleFile(this.files[0]);
  });

  // Browse button is the ONLY trigger — no dropZone click listener
  document.getElementById('browseBtn').addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    fileInput.click();
  });

  // Drag and drop only (no click)
  dropZone.addEventListener('dragover', function(e) { e.preventDefault(); this.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', function() { this.classList.remove('drag-over'); });
  dropZone.addEventListener('drop', function(e) {
    e.preventDefault(); this.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  const SUPPORTED_IMAGE_TYPES = {
    'image/jpeg': 'JPEG/JPG',
    'image/png': 'PNG',
    'image/webp': 'WebP',
    'image/gif': 'GIF',
    'image/bmp': 'BMP',
    'image/svg+xml': 'SVG',
    'image/x-icon': 'ICO'
  };

  const noticeModal = document.getElementById('noticeModal');
  const noticeTitle = document.getElementById('noticeTitle');
  const noticeMessage = document.getElementById('noticeMessage');
  const noticeCloseBtn = document.getElementById('noticeCloseBtn');

  function showNotice(title, message) {
    if (!noticeModal || !noticeTitle || !noticeMessage) {
      alert(title + '\n\n' + message);
      return;
    }
    noticeTitle.textContent = title;
    noticeMessage.textContent = message;
    noticeModal.classList.add('show');
    noticeModal.setAttribute('aria-hidden', 'false');
    if (noticeCloseBtn) noticeCloseBtn.focus();
  }

  function hideNotice() {
    if (!noticeModal) return;
    noticeModal.classList.remove('show');
    noticeModal.setAttribute('aria-hidden', 'true');
  }

  if (noticeCloseBtn) {
    noticeCloseBtn.addEventListener('click', hideNotice);
  }

  if (noticeModal) {
    noticeModal.addEventListener('click', function(e) {
      if (e.target === noticeModal) hideNotice();
    });
  }

  const previewModal = document.getElementById('previewModal');
  const previewModalImage = document.getElementById('previewModalImage');
  const previewModalClose = document.getElementById('previewModalClose');
  const previewModalTitle = document.getElementById('previewModalTitle');

  function openPreviewModal(targetId) {
    const img = document.getElementById(targetId);
    if (!img || !img.src) return;
    if (previewModalImage) {
      previewModalImage.src = img.src;
      previewModalImage.alt = img.alt || 'Large preview';
    }
    if (previewModalTitle) {
      previewModalTitle.textContent = targetId === 'previewOut' ? 'Output Preview' : 'Original Preview';
    }
    if (previewModal) {
      previewModal.classList.add('show');
      previewModal.setAttribute('aria-hidden', 'false');
    }
  }

  function closePreviewModal() {
    if (!previewModal) return;
    previewModal.classList.remove('show');
    previewModal.setAttribute('aria-hidden', 'true');
    if (previewModalImage) previewModalImage.src = '';
  }

  document.querySelectorAll('.preview-zoom-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      openPreviewModal(this.dataset.previewTarget);
    });
  });

  ['previewOrig', 'previewOut'].forEach(function(id) {
    const img = document.getElementById(id);
    if (!img) return;
    img.addEventListener('click', function() {
      openPreviewModal(id);
    });
  });

  if (previewModalClose) {
    previewModalClose.addEventListener('click', closePreviewModal);
  }

  if (previewModal) {
    previewModal.addEventListener('click', function(e) {
      if (e.target === previewModal) closePreviewModal();
    });
  }

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && noticeModal && noticeModal.classList.contains('show')) {
      hideNotice();
      return;
    }
    if (e.key === 'Escape' && previewModal && previewModal.classList.contains('show')) {
      closePreviewModal();
    }
  });

  function getFileExtension(fileName) {
    const match = /\.([a-z0-9]+)$/i.exec(fileName || '');
    return match ? match[1].toUpperCase() : 'Unknown';
  }

  function getUnsupportedFormatReason(file) {
    if (!file) return 'No file was selected.';
    if (!file.type) {
      return 'This file has no detectable format. Please use JPG, PNG, WebP, GIF, BMP, SVG, or ICO.';
    }
    if (!file.type.startsWith('image/')) {
      return 'This file is not an image. Please upload an image file only.';
    }
    if (!SUPPORTED_IMAGE_TYPES[file.type]) {
      return 'The .' + getFileExtension(file.name) + ' format is not supported. Please use JPG, PNG, WebP, GIF, BMP, SVG, or ICO.';
    }
    return '';
  }

  function handleFile(file) {
    const formatError = getUnsupportedFormatReason(file);
    if (formatError) {
      showNotice('Unsupported Upload', formatError);
      fileInput.value = '';
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      showNotice('File Too Large', 'The maximum allowed file size is 20MB. Please choose a smaller image and try again.');
      fileInput.value = '';
      return;
    }
    currentFile = file; origFile = null; hasCropped = false;
    document.getElementById('undoBtn').style.display = 'none';
    const reader = new FileReader();
    reader.onerror = function() {
      showNotice('File Could Not Be Read', 'Your browser could not read this file. The file may be corrupted, incomplete, or blocked.');
      fileInput.value = '';
    };
    reader.onload = function(ev) {
      const img = new Image();
      img.onerror = function() {
        showNotice('Image Could Not Be Opened', 'This image could not be opened by your browser. Try converting it to JPG, PNG, or WebP and upload it again.');
        fileInput.value = '';
      };
      img.onload = function() {
        origWidth = img.naturalWidth; origHeight = img.naturalHeight;
        aspectRatio = origWidth / origHeight;
        dropZone.classList.add('hidden');
        document.getElementById('previewOrig').src = ev.target.result;
        document.getElementById('previewOut').src = ev.target.result;
        document.getElementById('previewOut').style.opacity = '0.35';
        const kb = (file.size / 1024).toFixed(1);
        document.getElementById('origSize').textContent = kb > 1024 ? (kb/1024).toFixed(2)+' MB' : kb+' KB';
        document.getElementById('origDim').textContent = origWidth + '×' + origHeight;
        document.getElementById('outSize').textContent = '—';
        document.getElementById('outDim').textContent = '—';
        document.getElementById('rWidth').value = origWidth;
        document.getElementById('rHeight').value = origHeight;
        document.getElementById('panel').classList.add('show');
        document.getElementById('compressResult').classList.remove('show');
        document.getElementById('resizeResult').classList.remove('show');
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ── COMPRESS MODE ──
  document.getElementById('modeQuality').addEventListener('click', function() {
    compressMode = 'quality';
    this.classList.add('active'); document.getElementById('modeTarget').classList.remove('active');
    document.getElementById('qualityPanel').style.display = 'block';
    document.getElementById('targetPanel').style.display = 'none';
  });
  document.getElementById('modeTarget').addEventListener('click', function() {
    compressMode = 'target';
    this.classList.add('active'); document.getElementById('modeQuality').classList.remove('active');
    document.getElementById('qualityPanel').style.display = 'none';
    document.getElementById('targetPanel').style.display = 'block';
  });
  document.getElementById('qualityRange').addEventListener('input', function() {
    document.getElementById('qualityVal').textContent = this.value + '%';
  });
  document.getElementById('unitKB').addEventListener('click', function() {
    targetUnit = 'KB'; this.classList.add('active'); document.getElementById('unitMB').classList.remove('active');
  });
  document.getElementById('unitMB').addEventListener('click', function() {
    targetUnit = 'MB'; this.classList.add('active'); document.getElementById('unitKB').classList.remove('active');
  });

  // ── FORMAT BUTTONS ──
  document.getElementById('cmpFmtRow').addEventListener('click', function(e) {
    const btn = e.target.closest('.fmt-btn'); if (!btn) return;
    this.querySelectorAll('.fmt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); compressFmt = btn.dataset.fmt;
  });
  document.getElementById('rszFmtRow').addEventListener('click', function(e) {
    const btn = e.target.closest('.fmt-btn'); if (!btn) return;
    this.querySelectorAll('.fmt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); resizeFmt = btn.dataset.fmt;
  });

  // ── LOCK ASPECT ──
  document.getElementById('lockToggle').addEventListener('click', function() {
    lockAspect = !lockAspect;
    this.classList.toggle('on', lockAspect);
    this.setAttribute('aria-checked', lockAspect);
  });
  document.getElementById('rWidth').addEventListener('input', function() {
    if (!lockAspect) return;
    const w = parseInt(this.value);
    if (w) document.getElementById('rHeight').value = Math.round(w / aspectRatio);
  });
  document.getElementById('rHeight').addEventListener('input', function() {
    if (!lockAspect) return;
    const h = parseInt(this.value);
    if (h) document.getElementById('rWidth').value = Math.round(h * aspectRatio);
  });

  // ── HELPERS ──
  function compressToBlob(canvas, fmt, quality) {
    return new Promise(function(resolve) { canvas.toBlob(resolve, fmt, quality); });
  }

  async function findBestQuality(canvas, fmt, targetBytes) {
    let lo = 0.01, hi = 1.0, bestBlob = null;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      const blob = await compressToBlob(canvas, fmt, mid);
      if (blob.size <= targetBytes) { bestBlob = blob; lo = mid; } else { hi = mid; }
      const pct = Math.round(((i + 1) / 12) * 100);
      document.getElementById('progressFill').style.width = pct + '%';
      document.getElementById('progressLabel').textContent = 'Finding best quality... (' + pct + '%)';
    }
    return bestBlob;
  }

  function triggerDownload(blobURL, filename) {
    const a = document.createElement('a');
    a.href = blobURL; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  // ── COMPRESS ──
  document.getElementById('compressBtn').addEventListener('click', async function() {
    if (!currentFile) return;
    const fmt = 'image/' + compressFmt;
    const ext = compressFmt === 'jpeg' ? 'jpg' : compressFmt;
    const pw = document.getElementById('progressWrap');
    pw.classList.add('show'); this.disabled = true;
    document.getElementById('compressResult').classList.remove('show');
    document.getElementById('progressFill').style.width = '0%';

    const img = new Image();
    img.src = URL.createObjectURL(currentFile);
    await new Promise(function(r) { img.onload = r; });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);

    let blob;
    if (compressMode === 'target') {
      const targetVal = parseFloat(document.getElementById('targetSize').value);
      if (!targetVal || targetVal <= 0) { alert('Please enter a valid target size.'); pw.classList.remove('show'); this.disabled = false; return; }
      const targetBytes = targetUnit === 'MB' ? targetVal * 1024 * 1024 : targetVal * 1024;
      if (targetBytes >= currentFile.size) { alert('Image is already smaller than ' + targetVal + ' ' + targetUnit + '!'); pw.classList.remove('show'); this.disabled = false; return; }
      blob = await findBestQuality(canvas, fmt, targetBytes);
      if (!blob) { blob = await compressToBlob(canvas, fmt, 0.01); alert('Could not reach target. Best: ' + (blob.size/1024).toFixed(1) + ' KB'); }
    } else {
      const quality = parseInt(document.getElementById('qualityRange').value) / 100;
      document.getElementById('progressLabel').textContent = 'Compressing...';
      let p = 0;
      const iv = setInterval(function() { p = Math.min(p + Math.random() * 25, 90); document.getElementById('progressFill').style.width = p + '%'; }, 80);
      blob = await compressToBlob(canvas, fmt, compressFmt === 'png' ? undefined : quality);
      clearInterval(iv);
      document.getElementById('progressFill').style.width = '100%';
    }

    if (window._compressURL) URL.revokeObjectURL(window._compressURL);
    const blobURL = URL.createObjectURL(blob);
    window._compressURL = blobURL;

    const savedKB = ((currentFile.size - blob.size) / 1024).toFixed(1);
    const newKB = (blob.size / 1024).toFixed(1);
    const pct = Math.max(0, ((currentFile.size - blob.size) / currentFile.size * 100)).toFixed(0);

    document.getElementById('previewOut').src = blobURL;
    document.getElementById('previewOut').style.opacity = '1';
    document.getElementById('outSize').textContent = newKB > 1024 ? (newKB/1024).toFixed(2)+' MB' : newKB+' KB';
    document.getElementById('outDim').textContent = img.naturalWidth + '×' + img.naturalHeight;
    document.getElementById('dlCompress').onclick = function(e) { e.preventDefault(); triggerDownload(blobURL, 'proresize-compressed.' + ext); };
    document.getElementById('compressSummary').textContent = 'Reduced by ' + pct + '% — saved ' + (savedKB > 0 ? savedKB + ' KB' : 'optimized');
    document.getElementById('compressResult').classList.add('show');
    pw.classList.remove('show'); this.disabled = false;
  });

  // ── RESIZE ──
  document.getElementById('resizeBtn').addEventListener('click', function() {
    if (!currentFile) return;
    const w = parseInt(document.getElementById('rWidth').value);
    const h = parseInt(document.getElementById('rHeight').value);
    if (!w || !h || w < 1 || h < 1) { alert('Please enter valid dimensions.'); return; }
    const fmt = 'image/' + resizeFmt;
    const ext = resizeFmt === 'jpeg' ? 'jpg' : resizeFmt;
    const pw = document.getElementById('progressWrapR');
    const btn = this;
    pw.classList.add('show'); btn.disabled = true;
    document.getElementById('resizeResult').classList.remove('show');

    let p = 0;
    document.getElementById('progressFillR').style.width = '0%';
    document.getElementById('progressLabelR').textContent = 'Resizing...';
    const iv = setInterval(function() { p = Math.min(p + Math.random() * 28, 90); document.getElementById('progressFillR').style.width = p + '%'; }, 70);

    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(function(blob) {
        clearInterval(iv);
        document.getElementById('progressFillR').style.width = '100%';
        if (window._resizeURL) URL.revokeObjectURL(window._resizeURL);
        const blobURL = URL.createObjectURL(blob);
        window._resizeURL = blobURL;
        const newKB = (blob.size / 1024).toFixed(1);
        document.getElementById('previewOut').src = blobURL;
        document.getElementById('previewOut').style.opacity = '1';
        document.getElementById('outSize').textContent = newKB > 1024 ? (newKB/1024).toFixed(2)+' MB' : newKB+' KB';
        document.getElementById('outDim').textContent = w + '×' + h;
        document.getElementById('dlResize').onclick = function(e) { e.preventDefault(); triggerDownload(blobURL, 'proresize-' + w + 'x' + h + '.' + ext); };
        document.getElementById('resizeSummary').textContent = 'Resized to ' + w + '×' + h + ' pixels';
        document.getElementById('resizeResult').classList.add('show');
        pw.classList.remove('show'); btn.disabled = false;
      }, fmt, 0.92);
    };
    img.src = URL.createObjectURL(currentFile);
  });

  // ── PRESETS DATA ──
  const GOV_PRESETS = [
    {cat:'upsc',exam:'UPSC',name:'Civil Services (IAS/IPS) — Photo',w:350,h:350,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'upsc',exam:'UPSC',name:'Civil Services — Signature',w:350,h:150,maxKB:20,fmt:'jpeg',type:'Signature'},
    {cat:'upsc',exam:'UPSC',name:'CAPF AC — Photo',w:200,h:230,maxKB:40,fmt:'jpeg',type:'Photo'},
    {cat:'upsc',exam:'UPSC',name:'CDS / NDA — Photo',w:150,h:200,maxKB:40,fmt:'jpeg',type:'Photo'},
    {cat:'upsc',exam:'UPSC',name:'CDS / NDA — Signature',w:300,h:80,maxKB:20,fmt:'jpeg',type:'Signature'},
    {cat:'ssc',exam:'SSC',name:'SSC CGL / CHSL — Photo',w:100,h:120,maxKB:20,fmt:'jpeg',type:'Photo'},
    {cat:'ssc',exam:'SSC',name:'SSC CGL / CHSL — Signature',w:200,h:70,maxKB:10,fmt:'jpeg',type:'Signature'},
    {cat:'ssc',exam:'SSC',name:'SSC GD Constable — Photo',w:200,h:230,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'ssc',exam:'SSC',name:'SSC GD Constable — Signature',w:140,h:60,maxKB:20,fmt:'jpeg',type:'Signature'},
    {cat:'ssc',exam:'SSC',name:'SSC CPO SI — Photo',w:100,h:120,maxKB:20,fmt:'jpeg',type:'Photo'},
    {cat:'ssc',exam:'SSC',name:'SSC MTS — Photo',w:100,h:120,maxKB:20,fmt:'jpeg',type:'Photo'},
    {cat:'banking',exam:'IBPS',name:'IBPS PO / Clerk — Photo',w:200,h:230,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'banking',exam:'IBPS',name:'IBPS PO / Clerk — Signature',w:140,h:60,maxKB:20,fmt:'jpeg',type:'Signature'},
    {cat:'banking',exam:'SBI',name:'SBI PO / Clerk — Photo',w:200,h:200,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'banking',exam:'SBI',name:'SBI PO / Clerk — Signature',w:200,h:80,maxKB:20,fmt:'jpeg',type:'Signature'},
    {cat:'banking',exam:'RBI',name:'RBI Grade B — Photo',w:200,h:230,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'banking',exam:'RBI',name:'RBI Grade B — Signature',w:140,h:60,maxKB:20,fmt:'jpeg',type:'Signature'},
    {cat:'banking',exam:'NABARD',name:'NABARD Grade A/B — Photo',w:200,h:230,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'state',exam:'State PSC',name:'BPSC — Photo',w:213,h:177,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'state',exam:'State PSC',name:'MPSC — Photo',w:200,h:230,maxKB:30,fmt:'jpeg',type:'Photo'},
    {cat:'state',exam:'State PSC',name:'RPSC RAS — Photo',w:200,h:230,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'state',exam:'State PSC',name:'TNPSC — Photo',w:150,h:200,maxKB:30,fmt:'jpeg',type:'Photo'},
    {cat:'state',exam:'State PSC',name:'KPSC — Photo',w:200,h:230,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'state',exam:'State PSC',name:'WBPSC — Photo',w:150,h:200,maxKB:40,fmt:'jpeg',type:'Photo'},
    {cat:'defence',exam:'Indian Army',name:'Army Agniveer — Photo',w:200,h:200,maxKB:30,fmt:'jpeg',type:'Photo'},
    {cat:'defence',exam:'Indian Army',name:'Army Agniveer — Signature',w:140,h:60,maxKB:20,fmt:'jpeg',type:'Signature'},
    {cat:'defence',exam:'Indian Navy',name:'Navy Agniveer SSR/MR — Photo',w:200,h:230,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'defence',exam:'Indian Air Force',name:'AFCAT — Photo',w:200,h:240,maxKB:40,fmt:'jpeg',type:'Photo'},
    {cat:'defence',exam:'Indian Air Force',name:'AFCAT — Signature',w:140,h:60,maxKB:20,fmt:'jpeg',type:'Signature'},
    {cat:'defence',exam:'Indian Coast Guard',name:'Coast Guard Navik — Photo',w:200,h:230,maxKB:40,fmt:'jpeg',type:'Photo'},
    {cat:'railway',exam:'RRB',name:'RRB NTPC — Photo',w:150,h:200,maxKB:40,fmt:'jpeg',type:'Photo'},
    {cat:'railway',exam:'RRB',name:'RRB NTPC — Signature',w:200,h:70,maxKB:20,fmt:'jpeg',type:'Signature'},
    {cat:'railway',exam:'RRB',name:'RRB Group D — Photo',w:150,h:200,maxKB:40,fmt:'jpeg',type:'Photo'},
    {cat:'railway',exam:'RRB',name:'RRB ALP / Technician — Photo',w:150,h:200,maxKB:40,fmt:'jpeg',type:'Photo'},
    {cat:'railway',exam:'RRC',name:'RRC Level-1 Group D — Photo',w:200,h:230,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'assam',exam:'APSC',name:'APSC CCE (Civil Services) — Photo',w:350,h:350,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'assam',exam:'APSC',name:'APSC CCE — Signature',w:350,h:150,maxKB:20,fmt:'jpeg',type:'Signature'},
    {cat:'assam',exam:'APSC',name:'APSC ACS / APS — Photo',w:200,h:230,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'assam',exam:'SLPRB',name:'SLPRB Constable / SI — Photo',w:200,h:230,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'assam',exam:'SLPRB',name:'SLPRB Constable / SI — Signature',w:140,h:60,maxKB:20,fmt:'jpeg',type:'Signature'},
    {cat:'assam',exam:'Assam Police',name:'Assam Police AB/UB — Photo',w:200,h:230,maxKB:40,fmt:'jpeg',type:'Photo'},
    {cat:'assam',exam:'Assam Police',name:'Assam Police AB/UB — Signature',w:140,h:60,maxKB:20,fmt:'jpeg',type:'Signature'},
    {cat:'assam',exam:'DEE Assam',name:'DEE Assam LP/UP Teacher — Photo',w:200,h:230,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'assam',exam:'Assam TET',name:'Assam TET (LP/UP) — Photo',w:200,h:230,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'assam',exam:'APDCL',name:'APDCL (Power Dept) — Photo',w:200,h:230,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'assam',exam:'GMCH',name:'GMCH / NHM Assam — Photo',w:200,h:230,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'assam',exam:'Gauhati HC',name:'Gauhati High Court — Photo',w:200,h:230,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'assam',exam:'Gauhati HC',name:'Gauhati High Court — Signature',w:140,h:60,maxKB:20,fmt:'jpeg',type:'Signature'},
    {cat:'assam',exam:'PNRD',name:'PNRD Assam — Photo',w:200,h:230,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'assam',exam:'SEBA',name:'SEBA Recruitment — Photo',w:150,h:200,maxKB:40,fmt:'jpeg',type:'Photo'},
    {cat:'cuet',exam:'CUET UG/PG',name:'CUET UG/PG — Photo',w:200,h:230,maxKB:50,fmt:'jpeg',type:'Photo'},
    {cat:'cuet',exam:'CUET UG/PG',name:'CUET UG/PG — Signature',w:140,h:60,maxKB:20,fmt:'jpeg',type:'Signature'},
    {cat:'cuet',exam:'CUET UG/PG',name:'CUET UG/PG — Left Thumb Impression',w:140,h:60,maxKB:20,fmt:'jpeg',type:'Thumb'},
  ];

  // ── PRESET UI ──
  document.getElementById('presetSearch').addEventListener('input', function() {
    presetSearchTerm = this.value.trim().toLowerCase();
    renderPresets();
  });

  document.getElementById('catFilter').addEventListener('click', function(e) {
    const btn = e.target.closest('.fmt-btn'); if (!btn) return;
    this.querySelectorAll('.fmt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderPresets(btn.dataset.cat);
  });

  document.getElementById('presetGrid').addEventListener('click', function(e) {
    const card = e.target.closest('.preset-card'); if (!card) return;
    selectPreset(parseInt(card.dataset.idx, 10));
  });

  function renderPresets(cat) {
    const grid = document.getElementById('presetGrid');
    if (cat) activePresetCategory = cat;
    const list = GOV_PRESETS.filter(function(p) {
      const matchesCategory = activePresetCategory === 'all' || p.cat === activePresetCategory;
      const haystack = [p.exam, p.name, p.type, p.cat].join(' ').toLowerCase();
      const matchesSearch = !presetSearchTerm || haystack.indexOf(presetSearchTerm) !== -1;
      return matchesCategory && matchesSearch;
    });

    if (!list.length) {
      grid.innerHTML = '<div class="preset-empty">No presets matched your search. Try a different keyword or category.</div>';
      return;
    }

    grid.innerHTML = list.map(function(p) {
      const idx = GOV_PRESETS.indexOf(p);
      const isSelected = selectedPreset === p ? ' selected' : '';
      return '<div class="preset-card' + isSelected + '" id="pc-' + idx + '" data-idx="' + idx + '">' +
        '<div class="pc-exam">' + p.exam + '</div>' +
        '<div class="pc-name">' + p.name + '</div>' +
        '<div class="pc-tags">' +
        '<span class="pc-tag hi">' + p.maxKB + ' KB max</span>' +
        '<span class="pc-tag">' + p.w + '×' + p.h + ' px</span>' +
        '<span class="pc-tag">' + p.type + '</span>' +
        '</div></div>';
    }).join('');
  }

  function selectPreset(idx) {
    selectedPreset = GOV_PRESETS[idx];
    document.querySelectorAll('.preset-card').forEach(function(c) { c.classList.remove('selected'); });
    const card = document.getElementById('pc-' + idx);
    if (card) { card.classList.add('selected'); card.scrollIntoView({behavior:'smooth',block:'nearest'}); }
    document.getElementById('appliedName').textContent = selectedPreset.name;
    document.getElementById('appliedW').textContent = selectedPreset.w + ' px';
    document.getElementById('appliedH').textContent = selectedPreset.h + ' px';
    document.getElementById('appliedSize').textContent = selectedPreset.maxKB + ' KB';
    document.getElementById('btnCompressMeta').textContent = selectedPreset.maxKB + ' KB';
    document.getElementById('btnResizeMeta').textContent = selectedPreset.w + '×' + selectedPreset.h + ' px';
    document.getElementById('btnBothMeta').textContent = selectedPreset.w + '×' + selectedPreset.h + ' • ' + selectedPreset.maxKB + ' KB';
    document.getElementById('presetApplied').style.display = 'block';
    document.getElementById('presetResult').style.display = 'none';
  }

  function setPresetButtonsLoading(isLoading, mode) {
    document.getElementById('btnCompress').disabled = isLoading;
    document.getElementById('btnResize').disabled = isLoading;
    document.getElementById('btnBoth').disabled = isLoading;
    document.getElementById('btnCompressLabel').textContent = isLoading && mode === 'compress' ? '⏳ Compressing...' : '🗜️ Compress Only';
    document.getElementById('btnResizeLabel').textContent = isLoading && mode === 'resize' ? '⏳ Resizing...' : '📐 Resize Only';
    document.getElementById('btnBothLabel').textContent = isLoading && mode === 'both' ? '⏳ Processing...' : '✨ Resize + Compress';
  }

  async function applyPreset(mode) {
    if (!currentFile) { alert('Please upload an image first.'); return; }
    if (!selectedPreset) return;
    const p = selectedPreset;
    const fmt = 'image/' + p.fmt;
    const ext = p.fmt === 'jpeg' ? 'jpg' : p.fmt;
    setPresetButtonsLoading(true, mode);

    try {
      const img = new Image();
      const sourceURL = URL.createObjectURL(currentFile);
      img.src = sourceURL;
      await new Promise(function(resolve, reject) {
        img.onload = resolve;
        img.onerror = function() { reject(new Error('Could not load the selected image.')); };
      });

      const canvas = document.createElement('canvas');
      let blob;

      if (mode === 'compress') {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        blob = await findBestQuality(canvas, fmt, p.maxKB * 1024);
        if (!blob) blob = await compressToBlob(canvas, fmt, 0.05);
      } else if (mode === 'resize') {
        canvas.width = p.w;
        canvas.height = p.h;
        canvas.getContext('2d').drawImage(img, 0, 0, p.w, p.h);
        blob = await compressToBlob(canvas, fmt, 0.92);
      } else {
        canvas.width = p.w;
        canvas.height = p.h;
        canvas.getContext('2d').drawImage(img, 0, 0, p.w, p.h);
        blob = await findBestQuality(canvas, fmt, p.maxKB * 1024);
        if (!blob) blob = await compressToBlob(canvas, fmt, 0.05);
      }

      URL.revokeObjectURL(sourceURL);

      if (!blob) {
        throw new Error('Could not generate the preset output.');
      }

      if (window._presetURL) URL.revokeObjectURL(window._presetURL);
      const blobURL = URL.createObjectURL(blob);
      window._presetURL = blobURL;

      const outWidth = mode === 'compress' ? img.naturalWidth : p.w;
      const outHeight = mode === 'compress' ? img.naturalHeight : p.h;
      const newKB = (blob.size / 1024).toFixed(1);
      const originalKB = (currentFile.size / 1024).toFixed(1);
      const savedPct = Math.max(0, ((currentFile.size - blob.size) / currentFile.size) * 100).toFixed(0);

      document.getElementById('previewOut').src = blobURL;
      document.getElementById('previewOut').style.opacity = '1';
      document.getElementById('outSize').textContent = newKB > 1024 ? (newKB / 1024).toFixed(2) + ' MB' : newKB + ' KB';
      document.getElementById('outDim').textContent = outWidth + '×' + outHeight;

      if (mode === 'compress') {
        document.getElementById('presetSummary').textContent = 'Compressed from ' + originalKB + ' KB to ' + newKB + ' KB (' + savedPct + '% smaller)';
      } else if (mode === 'resize') {
        document.getElementById('presetSummary').textContent = 'Resized to ' + outWidth + '×' + outHeight + ' px (' + newKB + ' KB)';
      } else {
        document.getElementById('presetSummary').textContent = 'Resized to ' + outWidth + '×' + outHeight + ' px and compressed to ' + newKB + ' KB';
      }

      document.getElementById('dlPreset').onclick = function(e) {
        e.preventDefault();
        triggerDownload(blobURL, 'proresize-' + p.exam.toLowerCase().replace(/\s/g,'-') + '-' + mode + '.' + ext);
      };
      document.getElementById('presetResult').style.display = 'block';
    } catch (err) {
      alert(err.message || 'Something went wrong while applying the preset.');
    } finally {
      setPresetButtonsLoading(false);
    }
  }

  document.getElementById('btnCompress').addEventListener('click', function() { applyPreset('compress'); });
  document.getElementById('btnResize').addEventListener('click', function() { applyPreset('resize'); });
  document.getElementById('btnBoth').addEventListener('click', function() { applyPreset('both'); });

  // ── CROP ENGINE ──
  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: Math.max(0, Math.min((clientX - rect.left) * scaleX, canvas.width)),
      y: Math.max(0, Math.min((clientY - rect.top) * scaleY, canvas.height))
    };
  }

  function clampBox(b, cW, cH) {
    const w = Math.max(10, Math.min(b.w, cW));
    const h = Math.max(10, Math.min(b.h, cH));
    const x = Math.max(0, Math.min(b.x, cW - w));
    const y = Math.max(0, Math.min(b.y, cH - h));
    return {x:x, y:y, w:w, h:h};
  }

  function renderCropBox() {
    const canvas = document.getElementById('cropCanvas');
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width / canvas.width;
    const sy = rect.height / canvas.height;
    const dx = box.x * sx, dy = box.y * sy, dw = box.w * sx, dh = box.h * sy;
    const el = document.getElementById('cropBox');
    el.style.display = 'block';
    el.style.left = dx + 'px'; el.style.top = dy + 'px';
    el.style.width = dw + 'px'; el.style.height = dh + 'px';
    // Draw dark overlay on overlay canvas
    const oc = document.getElementById('overlayCanvas');
    oc.width = rect.width; oc.height = rect.height;
    const ctx = oc.getContext('2d');
    ctx.clearRect(0, 0, oc.width, oc.height);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, oc.width, oc.height);
    ctx.clearRect(dx, dy, dw, dh);
    // Info
    document.getElementById('cropXY').textContent = Math.round(box.x/cropScale) + ', ' + Math.round(box.y/cropScale);
    document.getElementById('cropW').textContent = Math.round(box.w/cropScale) + ' px';
    document.getElementById('cropH').textContent = Math.round(box.h/cropScale) + ' px';
  }

  function queueCropRender() {
    if (cropRenderQueued) return;
    cropRenderQueued = true;
    window.requestAnimationFrame(function() {
      cropRenderQueued = false;
      renderCropBox();
    });
  }

  function setActiveCropQuickButton(name) {
    document.querySelectorAll('.crop-quick-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.cropPreset === name);
    });
  }

  function setCropBoxByRatio(rw, rh) {
    const canvas = document.getElementById('cropCanvas');
    if (!canvas.width || !canvas.height) return;
    if (!rw || !rh) {
      box = {x:0, y:0, w:canvas.width, h:canvas.height};
      queueCropRender();
      return;
    }
    const margin = Math.max(12, Math.min(canvas.width, canvas.height) * 0.05);
    const availW = Math.max(10, canvas.width - margin * 2);
    const availH = Math.max(10, canvas.height - margin * 2);
    let w = availW;
    let h = w * rh / rw;
    if (h > availH) {
      h = availH;
      w = h * rw / rh;
    }
    box = {x:(canvas.width - w) / 2, y:(canvas.height - h) / 2, w:w, h:h};
    queueCropRender();
  }

  function setInitialMobileCropBox() {
    const canvas = document.getElementById('cropCanvas');
    if (!canvas.width || !canvas.height) return;
    const insetX = Math.max(14, canvas.width * 0.08);
    const insetY = Math.max(14, canvas.height * 0.08);
    box = {
      x: insetX,
      y: insetY,
      w: Math.max(20, canvas.width - insetX * 2),
      h: Math.max(20, canvas.height - insetY * 2)
    };
    queueCropRender();
  }

  function nudgeCropBox(action) {
    const canvas = document.getElementById('cropCanvas');
    if (!canvas.width || !canvas.height) return;
    const moveStep = Math.max(10, Math.round(Math.min(canvas.width, canvas.height) * 0.035));
    const scaleStep = 0.08;
    let next = Object.assign({}, box);
    if (action === 'up') next.y -= moveStep;
    if (action === 'down') next.y += moveStep;
    if (action === 'left') next.x -= moveStep;
    if (action === 'right') next.x += moveStep;
    if (action === 'bigger' || action === 'smaller') {
      const factor = action === 'bigger' ? 1 + scaleStep : 1 - scaleStep;
      const centerX = box.x + box.w / 2;
      const centerY = box.y + box.h / 2;
      let nextW = Math.max(30, box.w * factor);
      let nextH = Math.max(30, box.h * factor);
      if (cropRatioW && cropRatioH) {
        nextH = nextW * cropRatioH / cropRatioW;
      }
      next = {
        x: centerX - nextW / 2,
        y: centerY - nextH / 2,
        w: nextW,
        h: nextH
      };
    }
    box = clampBox(next, canvas.width, canvas.height);
    queueCropRender();
  }

  function openCrop() {
    if (!currentFile) return;
    pageScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.classList.add('crop-lock');
    document.body.style.top = '-' + pageScrollY + 'px';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.getElementById('cropModal').style.display = 'flex';
    const canvas = document.getElementById('cropCanvas');
    const img = new Image();
    img.onload = function() {
      cropImgNatW = img.naturalWidth; cropImgNatH = img.naturalHeight;
      const isMobileCrop = window.innerWidth <= 600;
      const maxW = Math.min(isMobileCrop ? window.innerWidth - 24 : 700, window.innerWidth * 0.96);
      const maxH = Math.min(window.innerHeight * (isMobileCrop ? 0.62 : 0.55), isMobileCrop ? 620 : 560);
      cropScale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
      canvas.width  = Math.round(img.naturalWidth  * cropScale);
      canvas.height = Math.round(img.naturalHeight * cropScale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      box = {x:0, y:0, w:canvas.width, h:canvas.height};
      setActiveCropQuickButton('full');
      if (isMobileCrop) {
        setInitialMobileCropBox();
      } else {
        queueCropRender();
      }
    };
    img.src = URL.createObjectURL(currentFile);
  }

  function closeCrop() {
    document.getElementById('cropModal').style.display = 'none';
    document.body.classList.remove('crop-lock');
    document.body.style.top = '';
    document.body.style.position = '';
    document.body.style.width = '';
    window.scrollTo(0, pageScrollY);
    dragMode = null;
  }

  document.getElementById('cropModal').addEventListener('wheel', function(e) {
    e.preventDefault();
  }, {passive:false});

  // Ratio buttons
  document.getElementById('ratioRow').addEventListener('click', function(e) {
    const btn = e.target.closest('.fmt-btn'); if (!btn) return;
    this.querySelectorAll('.fmt-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    cropRatioW = parseInt(btn.dataset.rw); cropRatioH = parseInt(btn.dataset.rh);
    if (cropRatioW && cropRatioH) {
      const canvas = document.getElementById('cropCanvas');
      const newH = Math.min(box.w * cropRatioH / cropRatioW, canvas.height);
      const newW = newH * cropRatioW / cropRatioH;
      box = clampBox({x:box.x, y:box.y, w:newW, h:newH}, canvas.width, canvas.height);
      queueCropRender();
    }
  });

  // Reset
  document.getElementById('resetCropBtn').addEventListener('click', function() {
    const canvas = document.getElementById('cropCanvas');
    box = {x:0, y:0, w:canvas.width, h:canvas.height};
    setActiveCropQuickButton('full');
    queueCropRender();
  });

  document.querySelectorAll('.crop-quick-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const preset = this.dataset.cropPreset;
      if (preset === 'full') {
        cropRatioW = 0; cropRatioH = 0;
        document.querySelectorAll('#ratioRow .fmt-btn').forEach(function(ratioBtn) {
          ratioBtn.classList.toggle('active', ratioBtn.dataset.rw === '0' && ratioBtn.dataset.rh === '0');
        });
        setCropBoxByRatio(0, 0);
      } else if (preset === 'square') {
        cropRatioW = 1; cropRatioH = 1;
        setCropBoxByRatio(1, 1);
      } else if (preset === 'portrait') {
        cropRatioW = 3; cropRatioH = 4;
        setCropBoxByRatio(3, 4);
      } else if (preset === 'story') {
        cropRatioW = 9; cropRatioH = 16;
        setCropBoxByRatio(9, 16);
      }
      setActiveCropQuickButton(preset);
    });
  });

  document.querySelectorAll('.crop-adjust-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      nudgeCropBox(this.dataset.cropAdjust);
    });
  });

  // Drag on canvas = draw new box
  const cropCanvas = document.getElementById('cropCanvas');
  function startCropInteraction(mode, e, stopPropagation) {
    if (stopPropagation) e.stopPropagation();
    e.preventDefault();
    dragMode = mode;
    dragStart = getPos(e, cropCanvas);
    if (mode === 'draw') {
      box = {x:dragStart.x, y:dragStart.y, w:1, h:1};
    } else {
      boxSnap = Object.assign({}, box);
    }
  }

  cropCanvas.addEventListener('mousedown', function(e) {
    startCropInteraction('draw', e, false);
  });
  cropCanvas.addEventListener('touchstart', function(e) {
    startCropInteraction('draw', e, false);
  }, {passive:false});

  // Move box
  document.getElementById('cropBoxMove').addEventListener('mousedown', function(e) {
    startCropInteraction('move', e, true);
  });
  document.getElementById('cropBoxMove').addEventListener('touchstart', function(e) {
    startCropInteraction('move', e, true);
  }, {passive:false});

  // Resize handles
  document.querySelectorAll('.ch[data-h]').forEach(function(h) {
    h.addEventListener('mousedown', function(e) {
      startCropInteraction(this.dataset.h, e, true);
    });
    h.addEventListener('touchstart', function(e) {
      startCropInteraction(this.dataset.h, e, true);
    }, {passive:false});
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragMode) return;
    const canvas = document.getElementById('cropCanvas');
    const pos = getPos(e, canvas);
    const dx = pos.x - dragStart.x, dy = pos.y - dragStart.y;
    let b = Object.assign({}, box);

    if (dragMode === 'draw') {
      let x = Math.min(dragStart.x, pos.x);
      let y = Math.min(dragStart.y, pos.y);
      let w = Math.abs(pos.x - dragStart.x);
      let h = Math.abs(pos.y - dragStart.y);
      if (cropRatioW && cropRatioH) { h = w * cropRatioH / cropRatioW; if (pos.y < dragStart.y) y = dragStart.y - h; }
      b = {x:x, y:y, w:w, h:h};
    } else if (dragMode === 'move') {
      b = {x:boxSnap.x+dx, y:boxSnap.y+dy, w:boxSnap.w, h:boxSnap.h};
    } else {
      let {x,y,w,h} = boxSnap;
      if (dragMode.includes('r')) w = Math.max(10, boxSnap.w + dx);
      if (dragMode.includes('l')) { x = boxSnap.x+dx; w = Math.max(10, boxSnap.w-dx); }
      if (dragMode.includes('b')) h = Math.max(10, boxSnap.h + dy);
      if (dragMode.includes('t')) { y = boxSnap.y+dy; h = Math.max(10, boxSnap.h-dy); }
      if (cropRatioW && cropRatioH) h = w * cropRatioH / cropRatioW;
      b = {x:x, y:y, w:w, h:h};
    }
    box = clampBox(b, canvas.width, canvas.height);
    queueCropRender();
  });

  document.addEventListener('mouseup', function(e) {
    if (!dragMode) return;
    if (dragMode === 'draw' && (box.w < 8 || box.h < 8)) {
      const canvas = document.getElementById('cropCanvas');
      box = {x:0, y:0, w:canvas.width, h:canvas.height};
      queueCropRender();
    }
    dragMode = null;
  });

  // Touch support
  document.addEventListener('touchmove', function(e) { if(dragMode){e.preventDefault();document.dispatchEvent(new MouseEvent('mousemove', {clientX:e.touches[0].clientX,clientY:e.touches[0].clientY}));} }, {passive:false});
  document.addEventListener('touchend', function(e) { if(dragMode)document.dispatchEvent(new MouseEvent('mouseup')); });

  // Apply crop
  document.getElementById('applyCropBtn').addEventListener('click', async function() {
    const canvas = document.getElementById('cropCanvas');
    const natX = Math.max(0, Math.round(box.x / cropScale));
    const natY = Math.max(0, Math.round(box.y / cropScale));
    const natW = Math.min(cropImgNatW - natX, Math.round(box.w / cropScale));
    const natH = Math.min(cropImgNatH - natY, Math.round(box.h / cropScale));
    if (natW < 2 || natH < 2) { alert('Crop area too small.'); return; }

    if (!hasCropped) { origFile = currentFile; hasCropped = true; }

    const img = new Image();
    img.src = URL.createObjectURL(currentFile);
    await new Promise(function(r) { img.onload = r; });
    const out = document.createElement('canvas');
    out.width = natW; out.height = natH;
    out.getContext('2d').drawImage(img, natX, natY, natW, natH, 0, 0, natW, natH);

    out.toBlob(function(blob) {
      currentFile = new File([blob], 'cropped.jpg', {type:'image/jpeg'});
      origWidth = natW; origHeight = natH; aspectRatio = natW / natH;
      const url = URL.createObjectURL(blob);
      document.getElementById('previewOrig').src = url;
      document.getElementById('previewOut').src = url;
      document.getElementById('previewOut').style.opacity = '0.35';
      const kb = (blob.size/1024).toFixed(1);
      document.getElementById('origSize').textContent = kb>1024?(kb/1024).toFixed(2)+' MB':kb+' KB';
      document.getElementById('origDim').textContent = natW + '×' + natH;
      document.getElementById('outSize').textContent = '—';
      document.getElementById('outDim').textContent = '—';
      document.getElementById('rWidth').value = natW;
      document.getElementById('rHeight').value = natH;
      document.getElementById('compressResult').classList.remove('show');
      document.getElementById('resizeResult').classList.remove('show');
      document.getElementById('undoBtn').style.display = 'inline-block';
      closeCrop();
    }, 'image/jpeg', 0.95);
  });

  // Undo crop
  document.getElementById('undoBtn').addEventListener('click', function() {
    if (!origFile) return;
    currentFile = origFile; origFile = null; hasCropped = false;
    const url = URL.createObjectURL(currentFile);
    const img = new Image();
    img.onload = function() {
      origWidth = img.naturalWidth; origHeight = img.naturalHeight; aspectRatio = origWidth / origHeight;
      document.getElementById('previewOrig').src = url;
      document.getElementById('previewOut').src = url;
      document.getElementById('previewOut').style.opacity = '0.35';
      const kb = (currentFile.size/1024).toFixed(1);
      document.getElementById('origSize').textContent = kb>1024?(kb/1024).toFixed(2)+' MB':kb+' KB';
      document.getElementById('origDim').textContent = origWidth + '×' + origHeight;
      document.getElementById('outSize').textContent = '—';
      document.getElementById('outDim').textContent = '—';
      document.getElementById('rWidth').value = origWidth;
      document.getElementById('rHeight').value = origHeight;
      document.getElementById('compressResult').classList.remove('show');
      document.getElementById('resizeResult').classList.remove('show');
    };
    img.src = url;
    this.style.display = 'none';
  });

  document.getElementById('changeFileBtn').addEventListener('click', function() {
    fileInput.click();
  });
  document.getElementById('openCropBtn').addEventListener('click', openCrop);
  document.getElementById('closeCropBtn').addEventListener('click', closeCrop);
  document.getElementById('cancelCropBtn').addEventListener('click', closeCrop);

  // ── SOCIAL MEDIA PRESETS ──
  const SOCIAL_PRESETS = [
    // YouTube
    {plat:'youtube', name:'Channel Profile Picture', w:800, h:800, ratio:'1:1', fmt:'jpeg', tip:'Displays as a circle. Use a clear logo or face shot. Minimum 98×98px.'},
    {plat:'youtube', name:'Channel Banner (Desktop)', w:2560, h:1440, ratio:'16:9', fmt:'jpeg', tip:'Safe zone for all devices is the center 1546×423px area.'},
    {plat:'youtube', name:'Channel Banner (TV)', w:2560, h:1440, ratio:'16:9', fmt:'jpeg', tip:'Full banner shown on TV screens. Keep key content centered.'},
    {plat:'youtube', name:'Video Thumbnail', w:1280, h:720, ratio:'16:9', fmt:'jpeg', tip:'Max 2MB. Use bold text and high contrast for better CTR.'},
    {plat:'youtube', name:'Community Post Image', w:1080, h:1080, ratio:'1:1', fmt:'jpeg', tip:'Square format works best for community posts.'},
    {plat:'youtube', name:'End Screen Element', w:1280, h:720, ratio:'16:9', fmt:'jpeg', tip:'End screens appear in the last 20 seconds of a video.'},
    {plat:'youtube', name:'Shorts Cover', w:1080, h:1920, ratio:'9:16', fmt:'jpeg', tip:'Vertical format. Keep title/text in center safe zone.'},

    // Instagram
    {plat:'instagram', name:'Profile Picture', w:320, h:320, ratio:'1:1', fmt:'jpeg', tip:'Displays as circle. Minimum 110×110px. Use simple, clear image.'},
    {plat:'instagram', name:'Feed Post – Square', w:1080, h:1080, ratio:'1:1', fmt:'jpeg', tip:'Most common format. Works great for product and portrait shots.'},
    {plat:'instagram', name:'Feed Post – Portrait', w:1080, h:1350, ratio:'4:5', fmt:'jpeg', tip:'Takes up more screen space in feed — better engagement.'},
    {plat:'instagram', name:'Feed Post – Landscape', w:1080, h:566, ratio:'1.91:1', fmt:'jpeg', tip:'Great for wide panoramic shots and landscape photography.'},
    {plat:'instagram', name:'Story / Reel', w:1080, h:1920, ratio:'9:16', fmt:'jpeg', tip:'Keep key content in center 1080×1420px safe zone.'},
    {plat:'instagram', name:'Carousel Post', w:1080, h:1080, ratio:'1:1', fmt:'jpeg', tip:'All slides should be same size. Square works best.'},
    {plat:'instagram', name:'Reel Cover', w:1080, h:1920, ratio:'9:16', fmt:'jpeg', tip:'Vertical cover thumbnail shown on your profile grid.'},
    {plat:'instagram', name:'IGTV Cover', w:420, h:654, ratio:'1:1.55', fmt:'jpeg', tip:'Shown as thumbnail on your profile page.'},

    // Facebook
    {plat:'facebook', name:'Profile Picture', w:170, h:170, ratio:'1:1', fmt:'jpeg', tip:'Displays at 170×170 on desktop, 128×128 on mobile.'},
    {plat:'facebook', name:'Cover Photo (Page)', w:820, h:312, ratio:'2.63:1', fmt:'jpeg', tip:'Displays at 820×312 on desktop, 640×360 on mobile.'},
    {plat:'facebook', name:'Cover Photo (Personal)', w:851, h:315, ratio:'2.7:1', fmt:'jpeg', tip:'Must be at least 400×150px. PNG for logos/text.'},
    {plat:'facebook', name:'Shared Post Image', w:1200, h:630, ratio:'1.91:1', fmt:'jpeg', tip:'Optimal size for link previews and shared images.'},
    {plat:'facebook', name:'Story', w:1080, h:1920, ratio:'9:16', fmt:'jpeg', tip:'Vertical format. Safe zone: center 1080×1420px.'},
    {plat:'facebook', name:'Event Cover Photo', w:1920, h:1005, ratio:'1.91:1', fmt:'jpeg', tip:'Large banner displayed at top of event page.'},
    {plat:'facebook', name:'Group Cover Photo', w:1640, h:856, ratio:'1.91:1', fmt:'jpeg', tip:'Shown at top of Facebook group page.'},
    {plat:'facebook', name:'Ad Image', w:1200, h:628, ratio:'1.91:1', fmt:'jpeg', tip:'Standard Facebook ad. Keep text under 20% of image.'},

    // Twitter / X
    {plat:'twitter', name:'Profile Picture', w:400, h:400, ratio:'1:1', fmt:'jpeg', tip:'Displays as circle. Minimum 200×200px recommended.'},
    {plat:'twitter', name:'Header / Banner', w:1500, h:500, ratio:'3:1', fmt:'jpeg', tip:'Center content — edges may be cropped on some devices.'},
    {plat:'twitter', name:'In-Feed Image (Single)', w:1600, h:900, ratio:'16:9', fmt:'jpeg', tip:'Max 5MB for images. Shown inline in timeline.'},
    {plat:'twitter', name:'In-Feed – 2 Images', w:1200, h:600, ratio:'2:1', fmt:'jpeg', tip:'Both images shown side by side in feed.'},
    {plat:'twitter', name:'Card Image', w:800, h:418, ratio:'1.91:1', fmt:'jpeg', tip:'Shown in Twitter summary card preview links.'},

    // LinkedIn
    {plat:'linkedin', name:'Personal Profile Picture', w:400, h:400, ratio:'1:1', fmt:'jpeg', tip:'Displays as circle. Minimum 200×200px. Professional headshot.'},
    {plat:'linkedin', name:'Personal Background Photo', w:1584, h:396, ratio:'4:1', fmt:'jpeg', tip:'Wide banner behind your profile picture.'},
    {plat:'linkedin', name:'Company Logo', w:300, h:300, ratio:'1:1', fmt:'png', tip:'PNG recommended for clean logo with transparent background.'},
    {plat:'linkedin', name:'Company Cover Photo', w:1128, h:191, ratio:'5.9:1', fmt:'jpeg', tip:'Very wide banner. Keep important content centered.'},
    {plat:'linkedin', name:'Shared Post Image', w:1200, h:627, ratio:'1.91:1', fmt:'jpeg', tip:'Standard image post in LinkedIn feed.'},
    {plat:'linkedin', name:'Article Cover Image', w:1920, h:1080, ratio:'16:9', fmt:'jpeg', tip:'Large header image for LinkedIn articles/posts.'},
    {plat:'linkedin', name:'Story', w:1080, h:1920, ratio:'9:16', fmt:'jpeg', tip:'Vertical format for LinkedIn Stories.'},

    // WhatsApp
    {plat:'whatsapp', name:'Profile Picture', w:500, h:500, ratio:'1:1', fmt:'jpeg', tip:'Displays as circle. Keep subject centered.'},
    {plat:'whatsapp', name:'Status Image', w:1080, h:1920, ratio:'9:16', fmt:'jpeg', tip:'Full vertical screen. Status visible for 24 hours.'},
    {plat:'whatsapp', name:'Shared Image', w:1600, h:900, ratio:'16:9', fmt:'jpeg', tip:'WhatsApp compresses images — use PNG for quality.'},
    {plat:'whatsapp', name:'Sticker', w:512, h:512, ratio:'1:1', fmt:'png', tip:'Must be PNG with transparent background. Max 100KB.'},
    {plat:'whatsapp', name:'Channel / Group Icon', w:500, h:500, ratio:'1:1', fmt:'jpeg', tip:'Square image that appears as group/channel icon.'},

    // Pinterest
    {plat:'pinterest', name:'Standard Pin', w:1000, h:1500, ratio:'2:3', fmt:'jpeg', tip:'Most popular ratio. Taller pins get more engagement.'},
    {plat:'pinterest', name:'Square Pin', w:1000, h:1000, ratio:'1:1', fmt:'jpeg', tip:'Square pins work well for product images.'},
    {plat:'pinterest', name:'Long Pin', w:1000, h:2100, ratio:'1:2.1', fmt:'jpeg', tip:'Infographics and step-by-step guides work great here.'},
    {plat:'pinterest', name:'Profile Picture', w:165, h:165, ratio:'1:1', fmt:'jpeg', tip:'Displays as circle on Pinterest profile.'},
    {plat:'pinterest', name:'Board Cover', w:800, h:450, ratio:'16:9', fmt:'jpeg', tip:'Cover image shown at top of a Pinterest board.'},

    // TikTok
    {plat:'tiktok', name:'Profile Picture', w:200, h:200, ratio:'1:1', fmt:'jpeg', tip:'Displays as circle. Keep subject well-centered.'},
    {plat:'tiktok', name:'Video Cover / Thumbnail', w:1080, h:1920, ratio:'9:16', fmt:'jpeg', tip:'Vertical thumbnail shown on your profile grid.'},
    {plat:'tiktok', name:'Video Frame', w:1080, h:1920, ratio:'9:16', fmt:'jpeg', tip:'Full vertical video frame. Safe zone: center 1080×1420px.'},
    {plat:'tiktok', name:'Horizontal Video', w:1920, h:1080, ratio:'16:9', fmt:'jpeg', tip:'TikTok also supports horizontal format since 2023.'},
    {plat:'tiktok', name:'Live Stream Cover', w:1080, h:1920, ratio:'9:16', fmt:'jpeg', tip:'Thumbnail shown before and during live streams.'},
  ];

  let selectedSocial = null;

  document.getElementById('socialSearch').addEventListener('input', function() {
    socialSearchTerm = this.value.trim().toLowerCase();
    renderSocial();
  });

  document.getElementById('socialFilter').addEventListener('click', function(e) {
    const btn = e.target.closest('.fmt-btn'); if (!btn) return;
    this.querySelectorAll('.fmt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderSocial(btn.dataset.plat);
  });

  document.getElementById('socialGrid').addEventListener('click', function(e) {
    const card = e.target.closest('[data-sidx]'); if (!card) return;
    selectSocial(parseInt(card.dataset.sidx, 10));
  });

  function renderSocial(plat) {
    const grid = document.getElementById('socialGrid');
    if (plat) activeSocialPlatform = plat;
    const list = SOCIAL_PRESETS.filter(function(p) {
      const matchesPlatform = activeSocialPlatform === 'all' || p.plat === activeSocialPlatform;
      const haystack = [p.plat, p.name, p.ratio, p.fmt, p.tip].join(' ').toLowerCase();
      const matchesSearch = !socialSearchTerm || haystack.indexOf(socialSearchTerm) !== -1;
      return matchesPlatform && matchesSearch;
    });
    const icons = {youtube:'▶', instagram:'📸', facebook:'👤', twitter:'𝕏', linkedin:'💼', whatsapp:'💬', pinterest:'📌', tiktok:'🎵'};

    if (!list.length) {
      grid.innerHTML = '<div class="preset-empty">No social presets matched your search. Try a different platform or keyword.</div>';
      return;
    }

    grid.innerHTML = list.map(function(p) {
      const idx = SOCIAL_PRESETS.indexOf(p);
      const icon = icons[p.plat] || '📱';
      const isSelected = selectedSocial === p ? ' selected' : '';
      return '<div class="preset-card' + isSelected + '" id="sp-' + idx + '" data-sidx="' + idx + '">' +
        '<div class="pc-exam">' + icon + ' ' + p.plat.charAt(0).toUpperCase() + p.plat.slice(1) + '</div>' +
        '<div class="pc-name">' + p.name + '</div>' +
        '<div class="pc-tags">' +
        '<span class="pc-tag hi">' + p.w + '×' + p.h + '</span>' +
        '<span class="pc-tag">' + p.ratio + '</span>' +
        '<span class="pc-tag">' + p.fmt.toUpperCase() + '</span>' +
        '</div></div>';
    }).join('');
  }

  function selectSocial(idx) {
    selectedSocial = SOCIAL_PRESETS[idx];
    document.querySelectorAll('#socialGrid .preset-card').forEach(function(c) { c.classList.remove('selected'); });
    const card = document.getElementById('sp-' + idx);
    if (card) { card.classList.add('selected'); card.scrollIntoView({behavior:'smooth',block:'nearest'}); }
    document.getElementById('socialName').textContent = selectedSocial.name;
    document.getElementById('socialW').textContent = selectedSocial.w + ' px';
    document.getElementById('socialH').textContent = selectedSocial.h + ' px';
    document.getElementById('socialRatio').textContent = selectedSocial.ratio;
    document.getElementById('socialTip').textContent = '💡 ' + selectedSocial.tip;
    document.getElementById('btnSocialLabel').textContent = selectedSocial.plat.charAt(0).toUpperCase() + selectedSocial.plat.slice(1);
    document.getElementById('socialApplied').style.display = 'block';
    document.getElementById('socialResult').style.display = 'none';
  }

  document.getElementById('btnSocial').addEventListener('click', async function() {
    if (!currentFile) { alert('Please upload an image first.'); return; }
    if (!selectedSocial) return;
    const p = selectedSocial;
    const fmt = 'image/' + p.fmt;
    const ext = p.fmt;
    this.disabled = true; this.textContent = '⏳ Resizing...';

    const img = new Image();
    img.src = URL.createObjectURL(currentFile);
    await new Promise(function(r) { img.onload = r; });

    const canvas = document.createElement('canvas');
    canvas.width = p.w; canvas.height = p.h;
    canvas.getContext('2d').drawImage(img, 0, 0, p.w, p.h);

    canvas.toBlob(function(blob) {
      if (window._socialURL) URL.revokeObjectURL(window._socialURL);
      const blobURL = URL.createObjectURL(blob);
      window._socialURL = blobURL;
      const newKB = (blob.size / 1024).toFixed(1);
      document.getElementById('socialSummary').textContent = p.name + ' — ' + p.w + '×' + p.h + ' px (' + newKB + ' KB)';
      document.getElementById('dlSocial').onclick = function(e) {
        e.preventDefault();
        const a = document.createElement('a');
        a.href = blobURL;
        a.download = 'proresize-' + p.plat + '-' + p.name.toLowerCase().replace(/[^a-z0-9]+/g,'-') + '.' + ext;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      };
      document.getElementById('socialResult').style.display = 'block';
      const btn = document.getElementById('btnSocial');
      btn.disabled = false;
      btn.innerHTML = '📐 Resize for <span id="btnSocialLabel">' + p.plat.charAt(0).toUpperCase() + p.plat.slice(1) + '</span>';
    }, fmt, p.fmt === 'png' ? undefined : 0.92);
  });
})();

