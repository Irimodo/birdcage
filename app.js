/* 鸟笼 · 界面逻辑（无框架、无 CDN、断网可用） */

const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const inputEl = $('#input');
const btnSend = $('#btnSend');
const audio = $('#bgm');
const keepAlive = $('#keepAlive');

const S = {
  cfg: null,
  manifest: null,
  state: null,
  busy: false,
  typing: false,
  skip: false,
  attachNotes: [],
  bgIndex: 0,
  bgmStarted: false,
  povJudgeSeq: 0,
  lastCgAt: 0,
  mode: 'offline',
  histOffline: [],
  histOnline: [],
  histView: 'offline',
  memory: [],
  queue: [],
  queueTimer: null,
};

const FACE_ORDER = ['normal', 'smile', 'sulk', 'down', 'closed_smile', 'surprised', 'angry',
  'grin', 'grin_blush', 'laugh', 'laugh_blush', 'hurt', 'awkward', 'threat', 'silhouette'];

function enc(u) { return String(u).split('/').map(encodeURIComponent).join('/'); }
function assetUrl(file) {
  // manifest.meta.rev 一变，浏览器就会重新抓图，避免旧立绘缓存
  const v = (S.manifest && S.manifest.meta && S.manifest.meta.rev) || 1;
  return 'assets/' + enc(file) + '?v=' + v;
}

/* ---------------- 缩放舞台（816×624 等比，原包 scWidth/scHeight） ---------------- */
const MOBILE_UA = /iPhone|iPad|iPod|Android|Mobile|HarmonyOS/i.test(navigator.userAgent);

/* iOS/PWA 的刘海与底部横条：env() 必须在真实元素上取，不能在 JS 里直接读 */
function safeInsets() {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);';
  document.body.appendChild(d);
  const cs = getComputedStyle(d);
  const top = parseFloat(cs.paddingTop) || 0;
  const bottom = parseFloat(cs.paddingBottom) || 0;
  d.remove();
  return { top, bottom };
}

function fitStage() {
  const w = window.innerWidth, h = window.innerHeight;
  const s = Math.min(w / 816, h / 624);
  const portrait = h > w * 1.2;
  const touch = matchMedia('(pointer: coarse)').matches || MOBILE_UA || Math.min(w, h) < 640;
  const safe = safeInsets();
  // 主屏幕 PWA 里 iOS 有时会把 safe-area-inset-top 报成 0，
  // 这时按刘海屏常见高度留出至少 64px，避免顶栏和系统状态栏重叠。
  const standalone = navigator.standalone === true ||
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches;
  const safeTop = (standalone && touch && safe.top < 40) ? 64 : safe.top;
  const safeBottom = (standalone && touch && safe.bottom < 10) ? 24 : safe.bottom;
  // 舞台整体是 scale(s) 的，安全区要换成舞台内坐标，否则会被一起缩小
  stage.style.setProperty('--safe-top-local', (safeTop / s).toFixed(1) + 'px');
  stage.style.setProperty('--safe-bottom-local', (safeBottom / s).toFixed(1) + 'px');
  stage.style.setProperty('--scale', s.toFixed(4));
  document.body.classList.toggle('standalone', standalone);
  document.body.classList.toggle('portrait', portrait);
  document.body.classList.toggle('touch', touch);
  if (portrait) {
    // 竖屏：舞台只负责容纳 UI（顶栏/对话框/输入行），画面本身放进一个严格 4:3 的窗口里。
    stage.style.height = Math.round(h / s) + 'px';
    stage.style.marginTop = '0px';
    stage.style.top = '0px';
    stage.style.transformOrigin = 'top center';
    const topbarH = (touch ? 62 : 46) + safeTop;
    const bottomH = (touch ? 72 : 56) + safeBottom;
    const avail = Math.max(200, h - topbarH - bottomH);
    // 4:3 窗口：高度最多占「顶栏以下、输入行以上」的 94%，宽度可以超出屏幕、左右裁一点
    const picPx = Math.min(Math.round((h - topbarH) * 0.78), Math.round(avail * 0.94));
    const topPx = topbarH;
    stage.style.setProperty('--pich', (picPx / s).toFixed(1) + 'px');
    stage.style.setProperty('--picw', (picPx * 4 / 3 / s).toFixed(1) + 'px');
    stage.style.setProperty('--pictop', (topPx / s).toFixed(1) + 'px');
  } else {
    stage.style.height = '624px';
    stage.style.marginTop = '-312px';
    stage.style.top = '50%';
    stage.style.transformOrigin = 'center center';
  }
}
function ambient(src) {
  const el = $('#ambient');
  if (el && src) el.style.backgroundImage = 'url("' + src + '")';
}
window.addEventListener('resize', fitStage);
window.addEventListener('orientationchange', () => setTimeout(fitStage, 260));

/* ---------------- 数据加载 ---------------- */
async function getJSON(url, opt) {
  return PureAPI.request(url, opt);
}

async function boot() {
  fitStage();
  const [cfgRes, manRes, stRes, hisRes, hisOn] = await Promise.all([
    getJSON('/api/config'), getJSON('/api/manifest'), getJSON('/api/state'),
    getJSON('/api/history?channel=offline'), getJSON('/api/history?channel=online'),
  ]);
  S.cfg = cfgRes.config;
  S.manifest = manRes.manifest;
  S.state = stRes.state;
  // 重开时回到当前视角自己的地点，而不是另一边的背景
  const bootBg = (S.state.pov === 'char' ? S.state.bg_char : S.state.bg_user);
  if (bootBg && bgItem(bootBg)) S.state.background = bootBg;

  buildSelects();
  await applyState(S.state, true);
  const hist = hisRes.history || [];      // 线下说过的话
  S.histOffline = hist;
  S.histOnline = hisOn.history || [];     // 线上发过的消息（另一条线，不互相复制）
  renderHistory(hist, $('#histLog'));
  renderOnlineHistory(S.histOnline);
  showLastLine(hist);

  const ui = S.cfg.ui || {};
  setSpeed(ui.typing_speed ?? 30);
  setFont(ui.font_size ?? 24);
  audio.volume = (ui.bgm_volume ?? 0.6);

  $('#splash').classList.add('hide');
  setTimeout(() => $('#splash').remove(), 700);

  const hasHistory = hist.length > 0;
  try {
    if (!localStorage.getItem('tobari_pat_hint')) {
      localStorage.setItem('tobari_pat_hint', '1');
      setTimeout(() => toast('点他的头、脸或衣角，他会有反应'), 6000);
    }
  } catch (e) { /* 隐私模式不给存就算了 */ }
  if (!hasHistory && !S.histOnline.length) {
    if ((S.cfg.api || {}).has_key) {
      opening();
    } else {
      toast('接口还没填：右上角「设置」里填 Base URL / Key / 模型名');
      setSpeaker('');
      typeText('（这是第一次打开。填好接口后，他会先说话。）', 'inner');
    }
  }
}
document.addEventListener('DOMContentLoaded', boot);

/* ---------------- 素材下拉 ---------------- */
function buildSelects() {
  const bgSel = $('#fBg');
  const curated = (S.manifest.bg || []).filter((x) => x.curated);
  const rest = (S.manifest.bg || []).filter((x) => !x.curated);
  bgSel.innerHTML = '';
  [...curated, ...rest].forEach((it) => {
    const o = document.createElement('option');
    o.value = it.id;
    o.textContent = (it.curated ? '' : '· ') + it.label + '  [' + it.id + ']';
    bgSel.appendChild(o);
  });

  fillFaceSelect((S.state && S.state.expression) || 'normal');

  const bgmSel = $('#fBgm');
  bgmSel.innerHTML = '';
  (S.manifest.bgm || []).forEach((it) => {
    const o = document.createElement('option');
    o.value = it.id;
    o.textContent = it.label + '  [' + it.id + ']';
    bgmSel.appendChild(o);
  });

  const ui = S.cfg.ui || {};
  bgSel.value = ui.background || 'bg_010';
  $('#fFace').value = ui.expression || 'normal';
  bgmSel.value = ui.bgm || 'bgm_01';
}

/* ---------------- 画面状态 ---------------- */
function bgItem(id) { return (S.manifest.bg || []).find((x) => x.id === id); }
function bgmItem(id) { return (S.manifest.bgm || []).find((x) => x.id === id); }
function cgItem(id) { return (S.manifest.cg || []).find((x) => x.id === id); }

function setBackground(id, instant) {
  const it = bgItem(id);
  if (!it) return;
  const layers = [$('#bg'), $('#bgNext')];
  const front = layers[S.bgIndex % 2];
  const back = layers[(S.bgIndex + 1) % 2];
  back.style.backgroundImage = 'url("' + assetUrl(it.file) + '")';
  ambient(assetUrl(it.file));
  if (instant) {
    front.style.transition = 'none';
    back.style.transition = 'none';
    back.style.opacity = 1;
    front.style.opacity = 0;
    S.bgIndex++;
    void back.offsetWidth;
    requestAnimationFrame(() => {
      front.style.transition = '';
      back.style.transition = '';
    });
    return;
  }
  back.style.opacity = 1;
  front.style.opacity = 0;
  S.bgIndex++;
}

function spriteGroupForTimeline(timeline) {
  const base = (S.manifest || {}).sprite || {};
  if (String(timeline || '').toUpperCase() === 'E' && base.child) return base.child;
  return base;
}
function activeSpriteGroup() {
  return spriteGroupForTimeline((S.cfg || {}).timeline);
}
function fillFaceSelect(preferred, timeline) {
  const faceSel = $('#fFace');
  if (!faceSel) return;
  const prev = preferred || faceSel.value;
  const tl = (timeline === undefined || timeline === null) ? (S.cfg || {}).timeline : timeline;
  const bust = (spriteGroupForTimeline(tl).bust) || {};
  faceSel.innerHTML = '';
  Object.keys(bust).forEach((k) => {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = bust[k].label || k;
    faceSel.appendChild(o);
  });
  if (prev && bust[prev]) faceSel.value = prev;
}
function setSprite(key, instant) {
  const bust = activeSpriteGroup().bust || {};
  const item = bust[key] || bust.normal;
  if (!item) return;
  const el = $('#sprite');
  if (instant) {
    el.style.backgroundImage = 'url("' + assetUrl(item.file) + '")';
    return;
  }
  el.classList.add('swap');
  setTimeout(() => {
    el.style.backgroundImage = 'url("' + assetUrl(item.file) + '")';
    el.classList.remove('swap');
  }, 180);
}

function setBgm(id) {
  const it = bgmItem(id);
  if (!it) return;
  const url = assetUrl(it.file);
  if (audio.dataset.src === url && audio.src) return;
  audio.dataset.src = url;
  // 静音时只记地址，不把 7～8MB 的 BGM 拉下来；等真的取消静音再加载。
  if (audio.muted) return;
  audio.src = url;
  audio.play().catch(() => { /* 等第一次点击 */ });
}

function showCg(id) {
  const it = cgItem(id);
  const el = $('#cg');
  if (!it) { el.classList.remove('show'); el.style.backgroundImage = ''; return; }
  el.style.backgroundImage = 'url("' + assetUrl(it.file) + '")';
  el.classList.add('show');
  S.lastCgAt = Date.now();
  el.onclick = () => el.classList.remove('show');
}

/* 配角立绘（平井鏡太郎）：他出场时站在画面右侧，帳自动退到左侧给他让位（不变暗） */
function setGuest(id, faceKey, instant) {
  const el = $('#sprite2');
  const img = $('#sprite2img');
  const bust = $('#sprite');
  const g = (S.manifest.guests || {})[id];
  if (!g) {
    el.classList.remove('show');
    if (img) img.removeAttribute('src');
    bust.classList.remove('dim', 'shift');
    return null;
  }
  const key = (g.bust || {})[faceKey] ? faceKey : (g.order || ['calm'])[0];
  const item = (g.bust || {})[key];
  img.src = assetUrl(item.file);
  el.classList.add('show');
  bust.classList.add('shift');
  // 有配角在画面里时不能再切整屏近景，否则会把他盖掉
  $('#near').classList.remove('show');
  bust.classList.remove('away');
  return { id: id, src: item.file, label: (item.label || ''), name: g.name || id };
}

function setNear(dist, faceKey, instant) {
  const el = $('#near');
  const bust = $('#sprite');
  const near = activeSpriteGroup().near || {};
  if (String((S.cfg || {}).timeline || '').toUpperCase() === 'E' || currentPov() === 'char' || dist !== 'near' || S.state.guest) {
    el.classList.remove('show');
    bust.classList.remove('away');
    return;
  }
  const item = near[faceKey] || near.normal;
  if (!item) { el.classList.remove('show'); bust.classList.remove('away'); return; }
  if (instant) el.style.transition = 'none';
  el.style.backgroundImage = 'url("' + assetUrl(item.file) + '")';
  el.classList.add('show');
  bust.classList.add('away');
  if (instant) requestAnimationFrame(() => { el.style.transition = ''; });
}

function pushState(patch, opt) {
  return getJSON('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ state: patch }, opt || {})),
  }).catch(() => null);
}
function bgPatchForCurrent(id) {
  const pov = currentPov();
  const patch = { background: id, apart: !!(S.state && S.state.apart) };
  if (S.state && S.state.apart) patch[pov === 'char' ? 'bg_char' : 'bg_user'] = id;
  else { patch.bg_user = id; patch.bg_char = id; }
  return patch;
}

const IMG_CACHE = new Map();
function preloadImage(url) {
  if (!url) return Promise.resolve();
  if (IMG_CACHE.has(url)) return IMG_CACHE.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(); };
    img.onload = finish;
    img.onerror = finish;
    img.src = url;
    setTimeout(finish, 8000);
  });
  IMG_CACHE.set(url, p);
  return p;
}
function currentPov() { return (S.state && S.state.pov) === 'char' ? 'char' : 'user'; }
function syncPovUi(pov) {
  const isChar = pov === 'char';
  document.body.classList.toggle('pov-char', isChar);
  document.body.classList.toggle('pov-user', !isChar);
  document.body.classList.toggle('apart', !!(S.state && S.state.apart));
  document.body.classList.toggle('timeline-e', String((S.cfg || {}).timeline || '').toUpperCase() === 'E');
  const b = $('#btnPov');
  if (b) {
    b.textContent = isChar ? '帳' : '我';
    b.title = isChar ? '当前：帳视角（我方输入为旁白）' : '当前：我方视角（実雪第一人称）';
    b.classList.toggle('on', isChar);
  }
  const flag = $('#povFlag');
  if (flag) flag.classList.toggle('show', isChar);
  if (isChar) {
    $('#near').classList.remove('show');
    $('#sprite').classList.remove('pat');
  }
}
async function preloadStateImages(patch) {
  const pov = patch.pov === 'char' ? 'char' : (patch.pov === 'user' ? 'user' : currentPov());
  const apart = patch.apart === undefined ? !!(S.state && S.state.apart) : !!patch.apart;
  const group = activeSpriteGroup();
  const urls = [];
  if (patch.background) { const it = bgItem(patch.background); if (it) urls.push(assetUrl(it.file)); }
  if (pov === 'char' || !apart) {
    if (patch.expression) {
      const bust = group.bust || {};
      const it = bust[patch.expression] || bust.normal;
      if (it) urls.push(assetUrl(it.file));
    }
    if (pov === 'user' && !apart && patch.dist === 'near' && !patch.guest) {
      const near = group.near || {};
      const it = near[patch.expression] || near.normal;
      if (it) urls.push(assetUrl(it.file));
    }
  }
  if (patch.guest) {
    const gg = ((S.manifest || {}).guests || {})[patch.guest];
    if (gg) {
      const key = (gg.bust || {})[S.guestFace] ? S.guestFace : (gg.order || ['calm'])[0];
      const it = (gg.bust || {})[key];
      if (it) urls.push(assetUrl(it.file));
    }
  }
  await Promise.all(urls.map(preloadImage));
}
async function applyState(patch, instant) {
  if (!patch) return;
  await preloadStateImages(patch);
  // 先把静音状态放好，再决定要不要加载 BGM
  if (patch.muted !== undefined) {
    audio.muted = !!patch.muted;
  }
  if (patch.background) setBackground(patch.background, instant);
  const nextApart = patch.apart === undefined ? !!(S.state && S.state.apart) : !!patch.apart;
  if (patch.expression && !(currentPov() === 'user' && nextApart)) setSprite(patch.expression, instant);
  if (patch.bgm) setBgm(patch.bgm);
  if (patch.cg !== undefined) showCg(patch.cg);
  if (patch.muted !== undefined && !patch.muted && S.bgmStarted) {
    audio.play().catch(() => {});
  }
  S.state = Object.assign({}, S.state, patch);
  if (patch.apart === false) { S.state.bg_user = S.state.background; S.state.bg_char = S.state.background; }
  if (patch.guest !== undefined) setGuest(S.state.guest, S.guestFace || 'calm', instant);
  syncPovUi(S.state.pov || 'user');
  document.body.classList.toggle('apart', !!S.state.apart);
  setNear(S.state.dist || 'far', S.state.expression || 'normal', instant);
  if (S.mode === 'online') paintAvatar();
}

async function refreshPovScene(pov) {
  const seq = ++S.povJudgeSeq;
  try {
    const res = await getJSON('/api/scene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pov }),
    });
    if (!res || !res.ok || seq !== S.povJudgeSeq || currentPov() !== pov) return;
    const patch = {
      bg_user: res.bg_user, bg_char: res.bg_char, apart: !!res.apart,
    };
    const target = pov === 'char' ? res.bg_char : res.bg_user;
    const changed = target && target !== S.state.background;
    S.state = Object.assign({}, S.state, patch);
    if (target) patch.background = target;
    if (changed) {
      await applyState(patch, false);
      const label = pov === 'char' ? res.char_label : res.user_label;
      if (label) toast('地点：' + label);
    } else {
      syncPovUi(currentPov());
      document.body.classList.toggle('apart', !!S.state.apart);
    }
  } catch (e) { /* 判断失败就维持当前画面，不打断 */ }
}

async function setPov(pov) {
  if (S.mode === 'online') { toast('线上模式不切视角'); return; }
  const next = pov === 'char' ? 'char' : 'user';
  S.state.pov = next;
  // 先把各自记住的地点换上去；模型判断回来后再校正
  const target = next === 'char' ? S.state.bg_char : S.state.bg_user;
  if (target && bgItem(target) && target !== S.state.background) {
    S.state.background = target;
    setBackground(target, false);
  }
  syncPovUi(next);
  setSprite(S.state.expression || 'normal', true);
  setNear(S.state.dist || 'far', S.state.expression || 'normal', true);
  if (next === 'char') $('#near').classList.remove('show');
  await pushState({ pov: next, background: S.state.background }, { silent: true, keep_bg_slots: true });
  refreshPovScene(next);
}


/* ---------------- 文本：名牌 + 一句台词 ---------------- */
const sayEl = () => $('#say');
const speakerEl = () => $('#speaker');
const nextDot = () => $('#nextDot');

const NAME_HIM = '雅楽代 帳';
const NAME_ME = '九重 実雪';
const GUEST_NAMES = {
  kagami: '平井 鏡太郎',
  father: '雅樂代 暁',
  mother: '雅樂代 香穗留',
};

/* 路人/环境声的说话人：有名字就用名字，没有名字就用具体身份 */
function isAmbientName(name) {
  const n = String(name || '').trim();
  if (!n || n.length > 16) return false;
  if (/^(帳|实雪|実雪|雅楽代|九重|平井|鏡太郎|镜太郎|暁|香[穗穂]留|かほる|我|你|他|她|旁白|旁白者|叙述|时间|地点|备注|控制|场景|画面)$/.test(n)) return false;
  if (/^(客人|路人|店員|店员|店長|店长|店主|老板|同學|同学|同級生|同级生|学生|學生|老师|教師|教师|前辈|前輩|后辈|後輩|阿姨|大叔|婆婆|爷爷|爺爺|奶奶|小姐|女士|先生|常客|服务员|服務員|收银员|收銀員|邻桌|鄰桌)/.test(n)) return true;
  if (/^[\u4e00-\u9fffぁ-んァ-ヶー]{2,6}$/.test(n)) return true;
  if (/^[A-Za-z][A-Za-z\-]{1,11}$/.test(n)) return true;
  return false;
}
function ambientSpeaker(scan) {
  const known = scan.match(/^(客人\s*[0-9０-９一二三四五六七八九十A-Za-z]+|路人(?:\s*[甲乙丙丁A-Za-z0-9０-９]*)?|店員|店员|常客)\s*[：:]\s*/);
  if (known) return { name: known[1].replace(/\s+/g, ''), length: known[0].length };
  const m = scan.match(/^([^\s：:，。！？、；「」『』（）()]{1,16})\s*[：:]\s*/);
  if (!m || !isAmbientName(m[1])) return null;
  return { name: m[1], length: m[0].length };
}

/* 一行是谁说的：`鏡太郎[cold]：「…」` 归配角；「…」归帳；括号里是心声；其余是旁白/动作（不显示名字） */
function parseLine(line) {
  const raw = String(line);
  const m = raw.match(/^(?:(?:平井|雅[樂乐]代)\s*)?(鏡太郎|镜太郎|暁|香[穗穂]留|かほる)\s*(?:\[([A-Za-z_]+)\])?\s*[：:]\s*/);
  if (m) {
    const n = m[2];
    const gid = (n === '鏡太郎' || n === '镜太郎') ? 'kagami' : (n === '暁' ? 'father' : 'mother');
    return { who: GUEST_NAMES[gid], guest: gid, face: (m[3] || 'calm').toLowerCase(),
      text: raw.slice(m[0].length), kind: 'say' };
  }
  const wrapped = raw.trim().match(/^[「『]([\s\S]*)[」』]$/);
  const scan = wrapped ? wrapped[1] : raw;
  const amb = ambientSpeaker(scan);
  if (amb) {
    const txt = scan.slice(amb.length).trim().replace(/^[「『]/, '').replace(/[」』]$/, '');
    return { who: amb.name, guest: '', face: null, text: txt, kind: 'say', ambient: true };
  }
  const t = raw.trim();
  if (/^[「『]/.test(t)) return { who: NAME_HIM, guest: '', face: null, text: t, kind: 'say' };
  if (/^[（(]/.test(t)) return { who: NAME_HIM, guest: '', face: null, text: t, kind: 'inner' };
  return { who: '', guest: '', face: null, text: t, kind: 'nar' };
}

function setSpeaker(name) { speakerEl().textContent = name; }

/* 历史：照原版的样子，一行「名字：内容」，不用气泡；他发来的一串也按行拆 */
function renderHistory(pairs, target) {
  target.innerHTML = '';
  if (!pairs || !pairs.length) {
    const d = document.createElement('div');
    d.className = 'hempty';
    d.textContent = '（这条线还没有记录）';
    target.appendChild(d);
    return;
  }
  pairs.forEach((p) => {
    const isUser = p.role === 'user';
    String(p.content || '').split('\n').map((s) => s.trim()).filter(Boolean).forEach((s) => {
      const charPov = isUser && p.pov === 'char';
      const act = isUser && (/^[（(]/.test(s) || charPov); // 她自己的动作 / 帳视角旁白都不挂名字
      const pl = act ? { who: '', text: s } : (isUser ? { who: NAME_ME, text: s } : parseLine(s));
      const d = document.createElement('div');
      d.className = 'hrow ' + (isUser ? (pl.who ? 'me' : 'nar') : (pl.ambient ? 'npc' : (pl.who ? 'him' : 'nar')));
      d.textContent = (pl.who ? pl.who + '：' : '') + pl.text;
      target.appendChild(d);
    });
  });
  target.scrollTop = target.scrollHeight;
}

/* 本地也记一笔，抽屉才不会停在打开那一刻的旧内容 */
function pushHist(channel, role, content, extra) {
  const arr = channel === 'online' ? S.histOnline : S.histOffline;
  arr.push(Object.assign({ role, content }, extra || {}));
  if ($('#drawer').classList.contains('open') && (S.histView || 'offline') === channel) {
    paintHistView(true);
  }
}

/* ---------------- 历史抽屉：线下 / 线上两条线分开看，打开就重抓一次 ---------------- */
function drawerTabPaint() {
  document.querySelectorAll('.dtab').forEach((b) => {
    b.classList.toggle('on', b.dataset.ch === (S.histView || 'offline'));
  });
}
function scrollHistBottom() {
  const el = $('#histLog');
  if (!el) return;
  el.style.scrollBehavior = 'auto';
  el.scrollTop = el.scrollHeight;
  requestAnimationFrame(() => { el.style.scrollBehavior = ''; });
}
function paintHistView(keepBottom) {
  const ch = S.histView || 'offline';
  const arr = ch === 'online' ? S.histOnline : S.histOffline;
  renderHistory(arr, $('#histLog'));
  if (keepBottom !== false) {
    scrollHistBottom();
    setTimeout(scrollHistBottom, 120);
  }
}
async function loadDrawer(ch) {
  S.histView = ch;
  drawerTabPaint();
  paintHistView();
  $('#histLog').classList.add('loading');
  try {
    const r = await getJSON('/api/history?channel=' + ch + '&t=' + Date.now());
    const h = r.history || [];
    if (ch === 'online') S.histOnline = h; else S.histOffline = h;
    if ((S.histView || 'offline') === ch && $('#drawer').classList.contains('open')) {
      paintHistView(true);
      requestAnimationFrame(scrollHistBottom);
      setTimeout(scrollHistBottom, 260);
    }
  } catch (e) { /* 抓失败就先用本地的 */ }
  finally {
    $('#histLog').classList.remove('loading');
    setTimeout(scrollHistBottom, 160);
  }
}
function openDrawer() {
  closePanel();
  closeMemory();
  $('#drawer').classList.add('open');
  syncScrim();
  loadDrawer(S.mode === 'online' ? 'online' : 'offline');
  requestAnimationFrame(scrollHistBottom);
}
document.querySelectorAll('.dtab').forEach((b) => {
  b.onclick = () => loadDrawer(b.dataset.ch);
});

function setSpeed(ms) {
  S.cfg.ui.typing_speed = Number(ms);
  $('#fSpeed').value = ms;
  $('#speedHint').textContent = ms + 'ms / 字';
}
function setFont(px) {
  S.cfg.ui.font_size = Number(px);
  sayEl().style.fontSize = px + 'px';
  $('#fFont').value = px;
  $('#fontHint').textContent = px + 'px';
}

/* 一句一句打出来；点框内任意处 = 立刻显示完 */
function typeText(text, cls) {
  return new Promise((resolve) => {
    const el = sayEl();
    el.className = 'say ' + (cls || '') + (text.length > 55 ? ' long' : '');
    el.textContent = '';
    S.typing = true;
    S.skip = false;
    nextDot().classList.remove('on');
    const ms = Math.max(5, Number(S.cfg.ui.typing_speed || 30));
    let i = 0;
    const timer = setInterval(() => {
      if (S.skip) {
        el.textContent = text;
        clearInterval(timer);
        S.typing = false;
        resolve();
        return;
      }
      i++;
      el.textContent = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(timer);
        S.typing = false;
        nextDot().classList.add('on');
        resolve();
      }
    }, ms);
  });
}

/* 停顿：到点自己继续；他说话时点一下也能提前翻下一句 */
function pause(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { S.waitFn = null; resolve(); }, ms);
    S.waitFn = () => { clearTimeout(t); S.waitFn = null; resolve(); };
  });
}

/* 一行是什么类型：他说出口的「」／心声（括号）／其他（当成心声处理） */
function lineKind(s) {
  if (/^[「『]/.test(s)) return 'say';
  if (/^[（(]/.test(s)) return 'inner';
  if (/^[＊*]/.test(s)) return 'inner'; // 旧格式兜底：＊动作 也当心声
  return 'inner';
}

/* 自动 / 手动播放 */
function manualMode() {
  const v = (S.cfg && S.cfg.ui) ? S.cfg.ui.autoplay : 1;
  return Number(v === undefined ? 1 : v) === 0;
}
function waitClick(ms) {
  return new Promise((resolve) => {
    S.waitFn = () => { S.waitFn = null; resolve(); };
    if (ms) setTimeout(() => { if (S.waitFn) { const f = S.waitFn; S.waitFn = null; f(); } }, ms);
  });
}

async function playLines(lines, speaker, gap) {
  setSpeaker(speaker);
  const manual = manualMode();
  for (let i = 0; i < lines.length; i++) {
    await typeText(lines[i], lineKind(lines[i]));
    if (i < lines.length - 1) {
      if (manual) await waitClick();          // 手动：等点对话框
      else await pause(gap === undefined ? 900 : gap);
    }
  }
  if (!manual) nextDot().classList.remove('on');
}

async function playReply(reply) {
  const items = reply.replace(/\r/g, '').split('\n').map((s) => s.trim()).filter(Boolean).map(parseLine);
  const manual = manualMode();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.guest) {
      S.state.guest = it.guest;
      S.guestFace = it.face;
      setGuest(it.guest, it.face);
      setSpeaker(it.who);
    } else if (it.ambient) {
      setSpeaker(it.who);
    } else {
      if (S.state.guest) setGuest(S.state.guest, S.guestFace || 'calm');
      setSpeaker(it.kind === 'say' || it.kind === 'inner' ? NAME_HIM : '');
    }
    await typeText(it.text, it.ambient ? 'env' : (it.kind === 'say' ? 'say' : (it.kind === 'nar' ? 'nar' : 'inner')));
    if (i < items.length - 1) {
      if (manual) await waitClick();
      else await pause(900);
    }
  }
  if (!manual) nextDot().classList.remove('on');
}

/* ---------------- 点他一下：摸摸头 / 碰脸 / 拍肩膀 ---------------- */
const TOUCH_ACT = {
  head: '摸了摸帐的头',
  face: '碰了碰帐的脸',
  arm: '拍了拍帐的肩膀',
};

/* 点击落在立绘的哪一块：头（最上）/ 脸 / 衣角肩膀 */
function hitZone(e, el, kind) {
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  if (x < 0.14 || x > 0.86) return null;
  if (kind === 'near') return y < 0.62 ? 'head' : 'face';
  if (y < 0.30) return 'head';
  if (y < 0.46) return 'face';
  return 'arm';
}

async function pat(zone) {
  if (currentPov() === 'char' || S.busy || S.typing || S.waitFn || !zone) return;
  const act = '我' + TOUCH_ACT[zone];
  const bust = $('#sprite');
  bust.classList.remove('pat');
  void bust.offsetWidth;
  bust.classList.add('pat');

  // 先把“我的动作”放进对话框；不挂名字，因为这是実雪自己的视角
  setSpeaker('');
  const el = sayEl();
  el.className = 'say me';
  el.textContent = act;
  pushHist('offline', 'user', act);

  S.busy = true;
  btnSend.disabled = true;
  btnSend.textContent = '…';
  try {
    const res = await getJSON('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: act,
        channel: 'offline',
        extra_system:
          '【她刚刚只是做了动作，没有说话】\n' +
          '她刚才的动作是：' + TOUCH_ACT[zone] + '。这是身体接触，不是一条文字消息。不要复述她这句话，' +
          '直接以帳的身份回应：可以有台词、心声或动作，也可以只有一句；句数看他想说多少。',
      }),
    });
    if (!res.ok) {
      const raw = res.error || '出错了';
      toast(raw + '（再点他一下试试）');
      setSpeaker('');
      await typeText('（……刚才那一下，他没有接上。）', 'inner');
      return;
    }
    if (res.state) await applyState(res.state, false);
    pushHist('offline', 'assistant', res.reply || '', { pov: currentPov() });
    await playReply(res.reply || '');
  } catch (e) {
    toast('请求失败：' + e.message);
    setSpeaker('');
    await typeText('（……刚才那一下，他没有接上。）', 'inner');
  } finally {
    S.busy = false;
    btnSend.disabled = false;
    btnSend.textContent = '发送';
  }
}

/* 双击才算“拍一拍”：单击、误触直接忽略 */
let patTapAt = 0, patTapZone = '', patTapTimer = null;
function tapPat(zone) {
  if (!zone) return;
  const now = Date.now();
  if (now - patTapAt <= 420 && patTapZone === zone) {
    patTapAt = 0; patTapZone = '';
    if (patTapTimer) { clearTimeout(patTapTimer); patTapTimer = null; }
    pat(zone);
    return;
  }
  patTapAt = now; patTapZone = zone;
  if (patTapTimer) clearTimeout(patTapTimer);
  patTapTimer = setTimeout(() => { patTapAt = 0; patTapZone = ''; patTapTimer = null; }, 420);
}
$('#sprite').addEventListener('click', (e) => tapPat(hitZone(e, $('#sprite'), 'bust')));
$('#near').addEventListener('click', (e) => { if ($('#near').classList.contains('show')) tapPat(hitZone(e, $('#near'), 'near')); });

/* 点对话框 = 跳过打字 / 直接下一句 */
$('#dialog').addEventListener('click', () => {
  if (S.typing) { S.skip = true; return; }
  if (S.waitFn) S.waitFn();
});
document.addEventListener('keydown', (e) => {
  if (e.key === ' ' && S.waitFn) { e.preventDefault(); S.waitFn(); }
});

/* ---------------- 对话（支持连发：先攒几条，再让他一次回） ---------------- */
const flushBtn = $('#btnFlush');

function queueLabel() {
  const n = S.queue.length;
  flushBtn.classList.toggle('show', n > 0);
  flushBtn.textContent = n > 0 ? '回复（' + n + '）' : '回复';
  const hint = $('#lineHint');
  if (hint) {
    hint.classList.toggle('on', n > 0);
    hint.textContent = n > 0 ? '已排队 ' + n + ' 条 · 点这里立刻回复' : '';
  }
}

function enqueue() {
  if (S.busy) return;
  const text = inputEl.value.trim();
  const notes = S.attachNotes.slice();
  if (!text && !notes.length) return;

  inputEl.value = '';
  clearAttach();
  const pov = currentPov();
  S.queue.push({ text, notes, pov });

  const shown = text || '（发来一个文件）';
  if (S.mode === 'online') addBubble('me', shown);
  else if (pov === 'char') {
    setSpeaker('');
    const el = sayEl();
    el.className = 'say nar';
    el.textContent = shown;
  } else {
    setSpeaker(NAME_ME);
    const el = sayEl();
    el.className = 'say me';
    el.textContent = shown;
  }
  queueLabel();

  const delay = Number((S.cfg.ui || {}).multi_send_delay ?? 8) * 1000;
  if (delay <= 0) { flushQueue(); return; }
  clearTimeout(S.queueTimer);
  S.queueTimer = setTimeout(flushQueue, delay);
}

const retryBtn = $('#btnRetry');
function showRetry(on) { retryBtn.classList.toggle('show', !!on); }

async function sendChat(payload) {
  const channel = payload.channel || S.mode;
  if (S.waitFn) S.waitFn();          // 手动模式卡在等点击时，新消息直接放行
  S.busy = true;
  btnSend.disabled = true;
  btnSend.textContent = '…';
  if (channel === 'online') typingBubble(true);

  try {
    const res = await getJSON('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: payload.text, attach_note: payload.notes, channel, pov: payload.pov || currentPov() }),
    });
    typingBubble(false);
    if (!res.ok) {
      S.retry = payload;              // 留着，点「重试」原样再发一次
      showRetry(true);
      if (res.need_key) {
        toast('接口还没填。右上角「设置」→ 填 Base URL / Key / 模型名');
        if (channel === 'online') addBubble('him', '（接口还没接上。去设置里填 Base URL / Key / 模型名。）');
        else { setSpeaker(''); await typeText('（接口还没接上。去设置里填 Base URL / Key / 模型名，我才能开口。）', 'inner'); }
      } else {
        const raw = res.error || '出错了';
        const plain = /10061|10060|actively refused|Connection|timed out|timeout/i.test(raw)
          ? '连不上接口（检查 Base URL / 网络 / 代理）'
          : raw;
        toast(plain + '　·点「重试」再发一次');
        if (channel === 'online') addBubble('him', '（' + plain + '）');
        else { setSpeaker(''); await typeText('（' + plain + '）', 'inner'); }
      }
      return;
    }
    S.retry = null;
    showRetry(false);
    pushHist(channel, 'user', payload.text || '（发来一个文件）', { pov: payload.pov || currentPov() });
    if (res.state && channel === 'offline') await applyState(res.state, false);
    pushHist(channel, 'assistant', res.reply || '', { pov: payload.pov || currentPov() });
    if (channel === 'online') await playOnlineReply(res.reply || '');
    else await playReply(res.reply || '');
  } catch (e) {
    typingBubble(false);
    S.retry = payload;
    showRetry(true);
    toast('请求失败：' + e.message + '　·点「重试」再发一次');
  } finally {
    S.busy = false;
    btnSend.disabled = false;
    btnSend.textContent = '发送';
    if (S.mode === 'online') $('#lineInput').focus(); else inputEl.focus();
  }
}

async function flushQueue() {
  clearTimeout(S.queueTimer);
  S.queueTimer = null;
  if (S.busy || !S.queue.length) return;

  const items = S.queue.slice();
  S.queue = [];
  queueLabel();
  const text = items.map((x) => x.text).filter(Boolean).join('\n');
  const notes = items.reduce((a, x) => a.concat(x.notes), []).join('\n');
  await sendChat({ text, notes, channel: S.mode });
}

retryBtn.onclick = () => {
  if (!S.retry) return;
  const p = S.retry;
  S.retry = null;
  showRetry(false);
  S.mode = p.channel || S.mode;
  sendChat(p);
};

/* 首次打开：让模型演一个开场（只在没历史且已配置接口时） */
async function opening() {
  try {
    const res = await getJSON('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '（她没有说话，只是推门进来了。你想先开口。）',
        extra_system: '这是程序第一次打开。不要写任何欢迎语或说明，直接演一个他在待宵亭等你、看到你进来的一瞬间。一两句就好。',
      }),
    });
    if (res.ok) {
      if (res.state) await applyState(res.state, false);
      await playReply(res.reply || '');
    }
  } catch (e) { /* 静默 */ }
}

/* ---------------- 附件 ---------------- */
function clearAttach() {
  S.attachNotes = [];
  const chip = $('#chip');
  chip.classList.remove('on');
  chip.innerHTML = '';
}

$('#btnAttach').onclick = () => $('#file').click();
$('#file').onchange = async (ev) => {
  const files = [...(ev.target.files || [])];
  ev.target.value = '';
  for (const f of files) {
    if (f.size > 26 * 1024 * 1024) { toast('文件太大（上限 26MB）：' + f.name); continue; }
    const b64 = await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.readAsDataURL(f);
    });
    const r = await getJSON('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: f.name, data: b64, size: f.size }),
    });
    if (r.ok) {
      S.attachNotes.push(r.note);
      const chip = $('#chip');
      chip.classList.add('on');
      chip.textContent = '📎 ' + f.name;
      const x = document.createElement('span');
      x.textContent = ' ×';
      x.onclick = (e) => { e.stopPropagation(); clearAttach(); };
      chip.appendChild(x);
    } else {
      toast(r.error || '上传失败');
    }
  }
};

/* ---------------- 发送 / 键盘 ---------------- */
btnSend.onclick = enqueue;
flushBtn.onclick = flushQueue;
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enqueue(); }
});

/* ---------------- 线上模式（LINE 风格的聊天页） ---------------- */
function bustUrl(face) {
  const bust = activeSpriteGroup().bust || {};
  const item = bust[face] || bust.normal;
  return item ? assetUrl(item.file) : '';
}

function paintAvatar() {
  const face = (S.state && S.state.expression) || 'normal';
  const u = bustUrl(face);
  if (!u) return;
  const head = $('#lineAva');
  if (head) head.style.backgroundImage = 'url("' + u + '")';
}

/* 框里只留最近一句：有历史就接着上一次他的话 */
function showLastLine(hist) {
  const lastAssistant = [...(hist || [])].reverse().find((x) => x.role === 'assistant');
  if (!lastAssistant) {
    setSpeaker('');
    sayEl().className = 'say';
    sayEl().textContent = '';
    return;
  }
  const lines = String(lastAssistant.content).split('\n').map((s) => s.trim()).filter(Boolean);
  const last = parseLine(lines[lines.length - 1] || '');
  setSpeaker(last.who);
  if (last.guest) {
    S.state.guest = last.guest;
    S.guestFace = last.face;
    setGuest(last.guest, last.face);
  }
  const el = sayEl();
  el.className = 'say ' + (last.ambient ? 'env' : (last.kind === 'say' ? 'say' : (last.kind === 'nar' ? 'nar' : 'inner')));
  el.textContent = last.text || '';
}

/* 切模式时把那条线自己的记录摆出来：线下的话不会出现在线上，反之亦然 */
async function loadChannel(m) {
  try {
    const r = await getJSON('/api/history?channel=' + m);
    const hist = r.history || [];
    if (m === 'online') { S.histOnline = hist; renderOnlineHistory(hist); }
    else { S.histOffline = hist; showLastLine(hist); }
  } catch (e) { /* 静默 */ }
}

function setMode(m) {
  S.mode = m;
  $('#online').classList.toggle('show', m === 'online');
  $('#btnMode').textContent = m === 'online' ? '线下' : '线上';
  const pb = $('#btnPov'); if (pb) pb.classList.toggle('hide', m === 'online');
  const pf = $('#povFlag'); if (pf) pf.classList.toggle('show', m !== 'online' && currentPov() === 'char');
  if (m === 'online') {
    paintAvatar();
    loadChannel('online');
    setTimeout(() => $('#lineInput').focus(), 60);
  } else {
    loadChannel('offline');
    inputEl.focus();
  }
}

function addBubble(who, text, kind) {
  const body = $('#lineBody');
  const row = document.createElement('div');
  row.className = 'brow ' + who;
  if (who === 'him') {
    const av = document.createElement('div');
    av.className = 'bava';
    const face = (S.state && S.state.expression) || 'normal';
    const u = bustUrl(face);
    if (u) av.style.backgroundImage = 'url("' + u + '")';
    row.appendChild(av);
  }
  const b = document.createElement('div');
  b.className = 'bubble ' + (kind || '');
  b.textContent = text;
  row.appendChild(b);
  body.appendChild(row);
  body.scrollTop = body.scrollHeight;
  return row;
}

let typingRow = null;
function typingBubble(on) {
  if (on) {
    if (typingRow) return;
    typingRow = addBubble('him', '···');
    typingRow.classList.add('typing');
  } else if (typingRow) {
    typingRow.remove();
    typingRow = null;
  }
}

/* 线上是聊天软件：动作/心声一律不出现，书名号也去掉 */
function onlineText(ln) {
  if (/^[（(]/.test(ln)) return '';
  return String(ln).replace(/^[「『]+/, '').replace(/[」』]+$/, '').trim();
}

async function playOnlineReply(reply) {
  const lines = String(reply).replace(/\r/g, '').split('\n').map((s) => s.trim()).filter(Boolean);
  let shown = 0;
  for (const ln of lines) {
    const t = onlineText(ln);
    if (!t) continue;
    addBubble('him', t, 'say');
    shown += 1;
    await new Promise((r) => setTimeout(r, 420));
  }
  if (!shown) addBubble('him', '……', '');
  $('#lineBody').scrollTop = $('#lineBody').scrollHeight;
}

function renderOnlineHistory(hist) {
  const body = $('#lineBody');
  body.innerHTML = '';
  typingRow = null;
  hist.forEach((m) => {
    if (m.role === 'user') addBubble('me', m.content);
    else String(m.content).split('\n').map((s) => s.trim()).filter(Boolean)
      .forEach((ln) => { const t = onlineText(ln); if (t) addBubble('him', t, 'say'); });
  });
  body.scrollTop = body.scrollHeight;
}

$('#btnPov').onclick = () => setPov(currentPov() === 'char' ? 'user' : 'char');
$('#btnMode').onclick = () => setMode(S.mode === 'online' ? 'offline' : 'online');
$('#lineBack').onclick = () => setMode('offline');
$('#lineSend').onclick = () => {
  const t = $('#lineInput').value.trim();
  if (!t) return;
  inputEl.value = t;          // 复用同一套连发逻辑
  $('#lineInput').value = '';
  enqueue();
};
$('#linePlus').onclick = () => $('#file').click();
$('#lineHint').onclick = () => flushQueue();
$('#lineInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#lineSend').click(); }
});

/* 重置：把画面拨回默认背景 / 表情 / 距离，避免卡在奇怪的状态 */
$('#btnReset').onclick = async () => {
  const r = await getJSON('/api/reset', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  if (!r.ok) { toast('重置失败'); return; }
  S.state = r.state;
  await applyState(r.state, true);
  toast('已回到默认画面');
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePanel(); closeDrawer(); closeMemory(); }
});

/* ---------------- 面板 / 抽屉 ---------------- */
function syncScrim() {
  const any = $('#panel').classList.contains('open')
    || $('#drawer').classList.contains('open')
    || $('#memDrawer').classList.contains('open');
  $('#scrim').classList.toggle('on', any);
}
function openPanel() {
  closeDrawer();
  closeMemory();
  fillPanel();
  $('#panel').classList.add('open');
  syncScrim();
}
function closePanel() {
  $('#panel').classList.remove('open');
  syncScrim();
}
function closeDrawer() {
  $('#drawer').classList.remove('open');
  syncScrim();
}
$('#btnSettings').onclick = openPanel;
$('#btnPanelClose').onclick = closePanel;
$('#btnHistory').onclick = openDrawer;
$('#drawerClose').onclick = closeDrawer;
$('#scrim').onclick = () => { closePanel(); closeDrawer(); closeMemory(); };

/* ---------------- 记忆抽屉：看得见、能改、能单条删 ---------------- */
const MEM_KIND = { fact: '事实', event: '事件', prefer: '偏好', promise: '约定', mood: '心情' };
function closeMemory() {
  $('#memDrawer').classList.remove('open');
  syncScrim();
}
function openMemory() {
  closePanel();
  closeDrawer();
  $('#memDrawer').classList.add('open');
  syncScrim();
  loadMemory();
}
async function loadMemory() {
  const box = $('#memLog');
  box.classList.add('loading');
  try {
    const r = await getJSON('/api/memory?t=' + Date.now());
    S.memory = r.memory || [];
    renderMemory();
  } catch (e) {
    box.innerHTML = '<div class="hempty">记忆读取失败</div>';
  } finally {
    box.classList.remove('loading');
  }
}
function renderMemory() {
  const box = $('#memLog');
  const list = (S.memory || []).slice().sort((a, b) => String(b.t || '').localeCompare(String(a.t || '')));
  $('#memCount').textContent = list.length ? list.length + ' 条' : '';
  box.innerHTML = '';
  if (!list.length) {
    const d = document.createElement('div');
    d.className = 'hempty';
    d.textContent = '（还没有长期记忆。聊够设定条数后会自动总结。）';
    box.appendChild(d);
    return;
  }
  list.forEach((it) => box.appendChild(memoryRow(it)));
}
function memoryTime(t) {
  const m = String(t || '').match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return t || '';
  return m[1] + '年' + Number(m[2]) + '月' + Number(m[3]) + '日 ' + m[4] + ':' + m[5];
}

function memoryRow(it) {
  const row = document.createElement('div');
  row.className = 'mrow';
  const head = document.createElement('div');
  head.className = 'mhead';
  const kind = document.createElement('span');
  kind.className = 'mkind';
  kind.textContent = MEM_KIND[it.kind] || '事实';
  const time = document.createElement('span');
  time.className = 'mtime';
  time.textContent = memoryTime(it.t);
  const weight = document.createElement('span');
  weight.className = 'mweight';
  weight.textContent = '★'.repeat(Math.max(1, Math.min(5, Number(it.weight) || 3)));
  head.append(kind, time, weight);
  const text = document.createElement('div');
  text.className = 'mtext';
  text.textContent = it.text || '';
  const acts = document.createElement('div');
  acts.className = 'mactions';
  const edit = document.createElement('button');
  edit.className = 'mini-btn';
  edit.textContent = '编辑';
  edit.onclick = () => editMemoryRow(it, row);
  const del = document.createElement('button');
  del.className = 'mini-btn danger';
  del.textContent = '删除';
  del.onclick = () => removeMemoryItem(it);
  acts.append(edit, del);
  row.append(head, text, acts);
  return row;
}
function editMemoryRow(it, row) {
  row.innerHTML = '';
  const ta = document.createElement('textarea');
  ta.className = 'medit';
  ta.value = it.text || '';
  const acts = document.createElement('div');
  acts.className = 'mactions';
  const save = document.createElement('button');
  save.className = 'mini-btn';
  save.textContent = '保存';
  const cancel = document.createElement('button');
  cancel.className = 'mini-btn';
  cancel.textContent = '取消';
  cancel.onclick = () => renderMemory();
  save.onclick = async () => {
    const text = ta.value.trim();
    if (!text) { toast('记忆不能为空'); return; }
    save.disabled = true;
    const r = await getJSON('/api/memory/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: it.id, text }),
    });
    if (!r.ok) { toast(r.error || '保存失败'); save.disabled = false; return; }
    S.memory = r.memory || [];
    renderMemory();
    toast('这条记忆已改好');
  };
  acts.append(save, cancel);
  row.append(ta, acts);
  ta.focus();
}
async function removeMemoryItem(it) {
  if (!confirm('删掉这条记忆？\n\n' + (it.text || ''))) return;
  const r = await getJSON('/api/memory/delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: it.id }),
  });
  if (!r.ok) { toast(r.error || '删除失败'); return; }
  S.memory = r.memory || [];
  renderMemory();
  toast('已删掉这条记忆');
}
$('#btnMemory').onclick = openMemory;
$('#memClose').onclick = closeMemory;

function fillPanel() {
  const c = S.cfg;
  $('#fBase').value = c.api.base_url || '';
  $('#fKey').value = '';
  $('#fKey').placeholder = c.api.has_key ? '已保存（留空则不修改）' : 'sk-...';
  $('#keyHint').textContent = c.api.has_key
    ? '已保存在这台设备的浏览器里。要换就重新粘贴，留空保留原来那把。'
    : '只存在这台设备的浏览器里，不上传；换设备或清缓存要重新填。';
  $('#fModel').value = c.api.model || '';
  $('#fMaxTok').value = c.api.max_tokens || 1200;
  $('#fTimeline').value = c.timeline || 'A';
  $('#fTimelineCustom').value = c.timeline_custom || '';
  $('#fVol').value = Math.round((c.ui.bgm_volume ?? 0.6) * 100);
  $('#volHint').textContent = $('#fVol').value + '%';
  $('#fSpeed').value = c.ui.typing_speed ?? 30;
  $('#fFont').value = c.ui.font_size ?? 24;
  $('#fDelay').value = c.ui.multi_send_delay ?? 8;
  $('#fAuto').value = String(Number(c.ui.autoplay === undefined ? 1 : c.ui.autoplay));
  $('#fBg').value = c.ui.background || 'bg_010';
  $('#fFace').value = c.ui.expression || 'normal';
  $('#fDist').value = c.ui.dist === 'near' ? 'near' : 'far';
  $('#fBgm').value = c.ui.bgm || 'bgm_01';
  const pr = c.prompt || {};
  $('#fHist').value = pr.history_turns ?? 12;
  $('#fSummary').value = pr.summary_every ?? 30;
  $('#memOut').textContent = '';
  $('#testOut').textContent = '';
  $('#saveStatus').textContent = '';
}

$('#fVol').oninput = () => {
  $('#volHint').textContent = $('#fVol').value + '%';
  audio.volume = Number($('#fVol').value) / 100;
};
$('#fSpeed').oninput = () => setSpeed(Number($('#fSpeed').value));
$('#fFont').oninput = () => setFont(Number($('#fFont').value));
$('#fBg').onchange = () => {
  const id = $('#fBg').value;
  if (!bgItem(id)) return;
  setBackground(id);
  const patch = bgPatchForCurrent(id);
  S.state = Object.assign({}, S.state, patch);
  pushState(patch);
};
$('#fFace').onchange = () => {
  const k = $('#fFace').value;
  S.state.expression = k;
  setSprite(k);
  setNear(S.state.dist || 'far', k);
};
$('#fDist').onchange = () => {
  const d = $('#fDist').value === 'near' ? 'near' : 'far';
  S.state.dist = d;
  S.cfg.ui.dist = d;
  setNear(d, S.state.expression || $('#fFace').value || 'normal');
};
$('#fBgm').onchange = () => { setBgm($('#fBgm').value); startAudio(); };

$('#btnModels').onclick = async () => {
  const out = $('#modelsOut');
  out.textContent = '拉取中…';
  const api = { base_url: $('#fBase').value.trim() };
  const key = $('#fKey').value.trim();
  if (key) api.key = key;
  const r = await getJSON('/api/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: { api: api } }),
  });
  if (!r.ok) { out.textContent = r.error || '拉取失败'; return; }
  const list = $('#modelList');
  list.innerHTML = '';
  (r.models || []).forEach((m) => {
    const o = document.createElement('option');
    o.value = m;
    list.appendChild(o);
  });
  out.textContent = r.models.length + ' 个（点输入框可选）';
  if (!r.models.length) out.textContent = '接口没返回模型';
};

$('#btnTest').onclick = async () => {  const out = $('#testOut');
  out.textContent = '测试中…';
  const api = { base_url: $('#fBase').value.trim(), model: $('#fModel').value.trim() };
  const key = $('#fKey').value.trim();
  if (key) api.key = key;
  const r = await getJSON('/api/config/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: { api: api } }),
  });
  out.textContent = r.ok ? '通了：' + (r.sample || '') : '失败：' + (r.error || '');
};

$('#fTimeline').addEventListener('change', () => {
  fillFaceSelect('', $('#fTimeline').value);
});

$('#btnSave').onclick = async () => {
  const api = {
    base_url: $('#fBase').value.trim(),
    model: $('#fModel').value.trim(),
    max_tokens: Math.max(200, Number($('#fMaxTok').value) || 1200),
  };
  const key = $('#fKey').value.trim();
  if (key) api.key = key;
  const body = {
    config: {
      api: api,
      timeline: $('#fTimeline').value,
      timeline_custom: $('#fTimelineCustom').value.trim(),
      ui: {
        background: $('#fBg').value,
        expression: $('#fFace').value,
        dist: $('#fDist').value === 'near' ? 'near' : 'far',
        bgm: $('#fBgm').value,
        bgm_volume: Number($('#fVol').value) / 100,
        typing_speed: Number($('#fSpeed').value),
        font_size: Number($('#fFont').value),
        multi_send_delay: Math.max(0, Number($('#fDelay').value) || 0),
        autoplay: Number($('#fAuto').value) === 0 ? 0 : 1,
      },
      prompt: {
        history_turns: Math.max(2, Number($('#fHist').value) || 12),
        summary_every: Math.max(0, Number($('#fSummary').value) || 0),
      },
    },
  };
  const r = await getJSON('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.ok) {
    S.cfg = r.config;
    fillFaceSelect($('#fFace').value);
    const bg = $('#fBg').value;
    const face = $('#fFace').value;
    const dist = $('#fDist').value === 'near' ? 'near' : 'far';
    const bgm = $('#fBgm').value;
    S.state.background = bg;
    S.state.expression = face;
    S.state.dist = dist;
    S.state.bgm = bgm;
    syncPovUi(currentPov());
    $('#saveStatus').textContent = '已保存';
    setBackground(bg);
    Object.assign(S.state, bgPatchForCurrent(bg));
    setSprite(face);
    setNear(dist, face);
    setBgm(bgm);
    startAudio();
    // 多次改背景时，以这次保存的最后一个值为准；服务端只记最后一次
    await pushState(Object.assign(bgPatchForCurrent(bg), { expression: face, dist, bgm, apart: S.state.apart }));
    setTimeout(() => { $('#saveStatus').textContent = ''; }, 1800);
  } else {
    $('#saveStatus').textContent = '保存失败';
  }
};

$('#btnClearHist').onclick = async () => {
  if (!confirm('只删掉对话上下文（他不再记得刚才聊过什么），长期记忆保留。继续？')) return;
  const r = await getJSON('/api/history/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (!r.ok) { toast('删除失败'); return; }
  sayEl().textContent = '';
  $('#histLog').innerHTML = '';
  toast('上下文已删除（记忆还在）');
};

$('#btnClearMem').onclick = async () => {
  if (!confirm('清空记忆与对话流水？人设、素材、设置都不会动。')) return;
  await getJSON('/api/memory/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  sayEl().textContent = '';
  $('#histLog').innerHTML = '';
  toast('已清空');
};

/* ---------------- 导出 / 导入（纯前端：本机备份） ---------------- */
$('#btnExport').onclick = async () => {
  const r = await getJSON('/api/export');
  if (!r.ok) { toast(r.error || '导出失败'); return; }
  const text = JSON.stringify(r.data, null, 2);
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const name = '鸟笼备份-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
    pad(d.getHours()) + pad(d.getMinutes()) + '.json';
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1200);
  $('#backupOut').textContent = '已导出：' + name + '（不含 API Key）';
  toast('已导出数据');
};

$('#btnImport').onclick = () => $('#importFile').click();
$('#importFile').onchange = async (ev) => {
  const f = (ev.target.files || [])[0];
  ev.target.value = '';
  if (!f) return;
  let data;
  try { data = JSON.parse(await f.text()); }
  catch (e) { toast('这个文件不是有效的 JSON'); return; }
  if (!confirm('导入会覆盖当前设置、记忆、历史和场景。API Key 保留本机现在这把。继续？')) return;
  const r = await getJSON('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  if (!r.ok) { toast(r.error || '导入失败'); return; }
  $('#backupOut').textContent = '已导入，正在重新打开…';
  toast('已导入');
  setTimeout(() => location.reload(), 800);
};

/* ---------------- 静音 / 首次播放 ---------------- */
$('#btnMute').onclick = () => {
  const m = !audio.muted;
  audio.muted = m;
  $('#btnMute').style.opacity = m ? '.4' : '1';
  if (!m) startAudio();
  getJSON('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: { muted: m } }),
  });
};

function bgmAudible() {
  return !!audio && !!audio.src && !audio.paused && !audio.muted && Number(audio.volume) > 0;
}
/* 页面在后台时也保持一个极轻的播放流：有原 BGM 就让 BGM 占住，没有就放 1 秒静音循环。 */
function syncKeepAlive() {
  if (!keepAlive) return;
  if (bgmAudible()) {
    if (!keepAlive.paused) {
      try { keepAlive.pause(); } catch (e) { /* 忽略 */ }
    }
    return;
  }
  keepAlive.volume = 0;
  if (keepAlive.paused) keepAlive.play().catch(() => { /* 等第一次点击 */ });
}
function startAudio() {
  S.bgmStarted = true;
  if (!audio.src && S.state && S.state.bgm) setBgm(S.state.bgm);
  if (!audio.muted) audio.play().catch(() => {});
  syncKeepAlive();
}
setInterval(syncKeepAlive, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncKeepAlive(); });
document.addEventListener('pointerdown', () => { if (!S.bgmStarted) startAudio(); else syncKeepAlive(); }, { once: true });
audio.addEventListener('playing', syncKeepAlive);
audio.addEventListener('pause', () => { if (!document.hidden) syncKeepAlive(); });

/* ---------------- 提示 ---------------- */
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 3600);
}



