/* 鸟笼 · 纯前端引擎
   把原来 server.py 的提示词、记忆、历史、状态、拍一拍、表情控制搬到浏览器。
   所有数据只存在本机（localStorage）；模型请求由浏览器直连，不经过任何后端。 */
(function () {
'use strict';

const VERSION = '0.2.0-pure';
const APP_TITLE = '鸟笼';
const PERSONA_FILES = {
  persona: '角色人设.md',
  story: '剧情总纲.md',
  user: '我的档案.md',
  assets: '素材清单.md',
};

const DEFAULT_CONFIG = {
  api: { base_url: '', key: '', model: '', temperature: 0.85, max_tokens: 1200 },
  server: { host: '127.0.0.1', port: 8737, open_browser: true, lan: true },
  ui: {
    background: 'bg_010', expression: 'normal', dist: 'far', outfit: 'uniform',
    bgm: 'bgm_01', bgm_volume: 0.6, typing_speed: 30, font_size: 24,
    multi_send_delay: 8, autoplay: 1,
  },
  timeline: 'A',
  timeline_custom: '',
  prompt: { max_chars: 34000, history_turns: 12, memory_top_n: 12, summary_every: 30 },
  features: { web_search: false, attachments: true },
};

const STATE_DEFAULT = {
  background: 'bg_010', bg_user: 'bg_010', bg_char: 'bg_010',
  expression: 'normal', dist: 'far', outfit: 'uniform',
  cg: '', bgm: 'bgm_01', muted: false, guest: '', pov: 'user', apart: false,
};

const TIMELINE_BLOCKS = {
  A: '【时间锚点 A · 待宵亭的日常】实雪仍在咖啡屋『待宵亭』用「樱」这个名字当女招待还债。婚约在法律上已经取消，但帐每天都会来店里。送礼骚扰与红酒事件已经发生，谁送的还不知道。绑架事件尚未发生。',
  B: '【时间锚点 B · 车内的邀请】已经查明「橘八寻」这个律师并不存在。帐第二次要实雪住进雅乐代家，她拒绝了。帐与平井镜太郎已经和解、互称名字。绑架事件尚未发生。',
  C: '【时间锚点 C · 同居之后】实雪已经住进雅乐代家，辞掉了咖啡屋的工作。帐肩上留下了枪伤，八寻逃走后音信全无。她叫他「夫君大人」。两人已经互通过心意。',
  D: '【时间锚点 D · 婚约取消那天】九重家已破产，父母离世，实雪刚从纯喫茶说出「请和我做朋友吧」。帐回家后砸了墙，还没有向她之外的任何人摊牌。',
  E: '【时间锚点 E · 小时候】两人还是孩子，约九到十岁。實雪和帳在雅楽代家的庭前、走廊或花园里度过一段童年时光；帳还没有长成后来的少爷，实雪也还是个孩子。这个锚点只能写童年日常、玩耍、约定和孩童能理解的情绪，不要写婚约、成人恋爱、身体接触或任何性暗示。',
};


const SCENE_PROMPT = `【视角地点判断 · 只做地点推理】你在一部双视角视觉小说里做“场记”。角色是雅楽代 帳（男，角色），用户是九重 実雪（女，我）。
你的任务：根据最近对话，判断两个人**此刻各自实际所在的地点**，并判断他们是否分开。只判断地点，不写剧情、不写台词、不分析感情。

硬规则：
1. 只有最近对话里明确发生了“告别、离开、回家、去学校、去店里、坐车、走到某处”等移动，才改变地点；没有明确移动，就沿用给出的当前地点。
2. 如果两人仍在一起，USER 和 CHAR 必须选同一个背景，APART=0。
3. 如果已经告别/分开，按各自去的方向选：実雪回家就选她现在的家；帳去学校就选学校；不要为了“画面好看”把两人放回同一个地方。
4. 実雪现在的家：时间锚点 C（已住进雅楽代家）选雅楽代邸；其余锚点选她自己的公寓/房间（bg_035「九重的房间（公寓）」或 bg_036/048 公寓外观）。不要选“九重家旧宅”（已查封，不是可进入场景）。
5. 帳去学校/上课：选学校（bg_084）；在教室里选 bg_132 或 bg_086。不要选咖啡厅。
6. 不要选意象/特写背景（鸟笼、椿、信、礼物、葡萄酒、注射、漆黑、纯白、天空、夕阳、海等），只选能住人、能上学的实际地点。
7. 输出必须是三行，不能多也不能少，不能解释：
USER=bg_xxx|地点名
CHAR=bg_xxx|地点名
APART=0或1

可用背景（只能从这里选）：
%BG_LIST%

当前记录：
実雪=%USER_BG%|%USER_LABEL%
帳=%CHAR_BG%|%CHAR_LABEL%
APART=%APART%

最近对话：
%TRANSCRIPT%`;

const SUMMARY_PROMPT = `【记忆整理 · 帳的日记】你是长期记忆的整理员。下面是一段角色（雅楽代 帳）与用户（九重 実雪）的最近对话。
请只写 1 条长期记忆，格式严格为 \`kind|weight|text\`，只输出这一行；不要编号、不要解释、不要分成多条。
kind 取 event / mood / promise / prefer / fact；weight 1-5（越重要越高）。
text 必须用雅楽代帳的第一人称「我」写，像他写给自己看的日记：先写今天实际发生了什么，再写一个他当面没说出口的细节或心情。60-110 个汉字，短句，克制，不要总结陈词，不要分析关系，不要写「她让我明白」这种升华。
这是日记，不是第三人称摘要：不要写「実雪如何如何」的旁观句；日期和时间由界面显示，正文不要重复年月日。
只写这段对话里真实出现过的事；没有值得留下的内容时，只输出 \`fact|1|-\`。`;

const HISTORY_BAD_RE = /吃撑|放你回去|做好觉悟|覚悟して|ご主人様|主人大人|你的狗|君の犬|犬にな|牙だけ|獠牙|去勢|絶育|押し倒|ペット/;
const WIFE_WORD_RE = /妻子|老婆|奥さん|お嫁さん|俺の妻|我的妻子/;

const TOUCH_TEXT = {
  head: '她伸手摸了摸你的头（手心按在头发上，停了一下才收回去）',
  face: '她伸手碰了碰你的脸（指尖从脸颊擦过去）',
  arm: '她拉了拉你的衣袖／碰了碰你的肩',
};

/* ---------------- 本机存取 ---------------- */
const CFG_KEY = 'tobari_pure_cfg_v1';
const STATE_KEY = 'tobari_pure_state_v1';
const MEM_KEY = 'tobari_pure_memory_v1';
const HIST_KEY = 'tobari_pure_history_v1';
const TOUCH_KEY = 'tobari_pure_touches_v1';
const SCENE_KEY = 'tobari_pure_scene_v1';
const THREAT_KEY = 'tobari_pure_threat_v1';
const SUMMARY_KEY = 'tobari_pure_summary_v1';

const fallbackStore = new Map();
function readRaw(key, def) {
  try {
    const s = localStorage.getItem(key);
    if (s !== null) return JSON.parse(s);
  } catch (e) { /* file:// 或隐私模式 */ }
  if (fallbackStore.has(key)) return clone(fallbackStore.get(key));
  return clone(def);
}
function writeRaw(key, val) {
  const v = clone(val);
  try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 忽略 */ }
  fallbackStore.set(key, v);
}
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function deepMerge(base, patch) {
  const out = clone(base || {});
  Object.keys(patch || {}).forEach((k) => {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = clone(v);
    }
  });
  return out;
}

/* ---------------- 时间 ---------------- */
function pad2(n) { return String(n).padStart(2, '0'); }
function stamp(withSec) {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + (withSec ? ':' + pad2(d.getSeconds()) : '');
}
function nowText() {
  const d = new Date();
  const wd = '日一二三四五六'[d.getDay()];
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 星期' + wd + ' ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/* ---------------- 初始化数据 ---------------- */
const FS = { ready: null, manifest: null, personas: null, seed: null, rules: null };

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('读取失败：' + url);
  return r.text();
}

async function ensureInit() {
  if (FS.ready) return FS.ready;
  FS.ready = (async () => {
    const pd = window.PURE_DATA || null;
    if (pd) {
      FS.manifest = pd.manifest || {};
      FS.personas = pd.persona || {};
      FS.seed = pd.seed || {};
      FS.rules = pd.rules || {};
    } else {
      FS.manifest = await (await fetch('assets/manifest.json')).json();
      FS.seed = {};
      FS.rules = {};
      FS.personas = {};
      for (const k of Object.keys(PERSONA_FILES)) {
        try { FS.personas[PERSONA_FILES[k]] = await fetchText('persona/' + encodeURIComponent(PERSONA_FILES[k])); }
        catch (e) { FS.personas[PERSONA_FILES[k]] = ''; }
      }
    }
    if (!FS.manifest || !Array.isArray(FS.manifest.bg)) throw new Error('素材清单读取失败');

    if (readRaw(CFG_KEY, null) === null) {
      const cfg = deepMerge(DEFAULT_CONFIG, FS.seed.config || {});
      if (cfg.api) { cfg.api.key = ''; cfg.api.has_key = false; }
      if (cfg.features) cfg.features.web_search = false;
      writeRaw(CFG_KEY, cfg);
    }
    if (readRaw(STATE_KEY, null) === null) writeRaw(STATE_KEY, deepMerge(STATE_DEFAULT, FS.seed.state || {}));
    if (readRaw(MEM_KEY, null) === null) writeRaw(MEM_KEY, Array.isArray(FS.seed.memory) ? FS.seed.memory : []);
    if (readRaw(HIST_KEY, null) === null) {
      const h = FS.seed.history || {};
      writeRaw(HIST_KEY, { offline: h.offline || [], online: h.online || [] });
    }
    if (readRaw(TOUCH_KEY, null) === null) writeRaw(TOUCH_KEY, []);
    if (readRaw(SCENE_KEY, null) === null) writeRaw(SCENE_KEY, {});
    return true;
  })();
  return FS.ready;
}

/* ---------------- 配置 / 状态 ---------------- */
function loadConfig() {
  // 总结间隔完全跟设置里的「记忆总结间隔」走：填 30 就 30 轮一次，填 50 就 50 轮一次，填 0 关闭。
  return deepMerge(DEFAULT_CONFIG, readRaw(CFG_KEY, {}));
}
function publicConfig(cfg) {
  const c = clone(cfg || loadConfig());
  c.api = c.api || {};
  c.api.has_key = !!(c.api.key || '').trim();
  c.api.key = '';
  if (c.features) c.features.web_search = false;
  return c;
}
function saveConfig(patch) {
  const old = loadConfig();
  const cfg = deepMerge(old, patch || {});
  if (patch && patch.api && patch.api.has_key && !((patch.api.key || '').trim())) cfg.api.key = (old.api || {}).key || '';
  writeRaw(CFG_KEY, cfg);
  return cfg;
}
function tempConfig(patch) {
  const old = loadConfig();
  const cfg = deepMerge(old, patch || {});
  if (patch && patch.api && patch.api.has_key && !((patch.api.key || '').trim())) cfg.api.key = (old.api || {}).key || '';
  return cfg;
}

function loadState() {
  const st = deepMerge(STATE_DEFAULT, readRaw(STATE_KEY, {}));
  if (!bgItem(st.background)) st.background = STATE_DEFAULT.background;
  if (!bgItem(st.bg_user)) st.bg_user = st.background;
  if (!bgItem(st.bg_char)) st.bg_char = st.background;
  return st;
}
function saveState(patch) {
  const next = deepMerge(loadState(), patch || {});
  writeRaw(STATE_KEY, next);
  return next;
}
function resetState() {
  const cfg = loadConfig();
  const ui = cfg.ui || {};
  const old = loadState();
  const st = deepMerge(STATE_DEFAULT, {
    background: ui.background || STATE_DEFAULT.background,
    expression: ui.expression || 'normal',
    dist: ui.dist || 'far',
    outfit: ui.outfit || 'uniform',
    bgm: ui.bgm || 'bgm_01',
    muted: !!old.muted,
    guest: '', cg: '', pov: 'user', apart: false,
    bg_user: ui.background || STATE_DEFAULT.background,
    bg_char: ui.background || STATE_DEFAULT.background,
  });
  writeRaw(STATE_KEY, st);
  return st;
}
function bgItem(id) { return (FS.manifest.bg || []).find((x) => x.id === id) || null; }
function bgLabel(id) { const it = bgItem(id); return it ? (it.label || '') : ''; }

/* ---------------- 记忆 ---------------- */
function loadMemory() { const m = readRaw(MEM_KEY, []); return Array.isArray(m) ? m : []; }
function addMemory(items) {
  if (!items || !items.length) return 0;
  const mem = loadMemory();
  const ids = new Set(mem.map((x) => x.id));
  let added = 0;
  items.forEach((it) => {
    const text = String((it && it.text) || '').trim();
    if (!text) return;
    let mid = 'm' + Math.floor(Date.now() / 1000) + pad2(added);
    while (ids.has(mid)) mid += 'x';
    mem.push({ id: mid, t: stamp(false), kind: it.kind || 'fact', text, weight: Number(it.weight) || 3 });
    ids.add(mid);
    added++;
  });
  if (mem.length > 400) {
    mem.sort((a, b) => (Number(a.weight) || 3) - (Number(b.weight) || 3) || String(a.t || '').localeCompare(String(b.t || '')));
    const drop = mem.slice(0, mem.length - 400);
    const rest = mem.filter((x) => !drop.includes(x)).sort((a, b) => String(a.t || '').localeCompare(String(b.t || '')));
    rest.unshift({
      id: 'm_archived', t: stamp(false), kind: 'fact', weight: 2,
      text: '早期记忆（压缩）：' + drop.slice(0, 30).map((x) => x.text || '').join('；'),
    });
    writeRaw(MEM_KEY, rest);
  } else {
    writeRaw(MEM_KEY, mem);
  }
  return added;
}
function pickMemory(limit) {
  return loadMemory().sort((a, b) => (Number(b.weight) || 3) - (Number(a.weight) || 3) || String(b.t || '').localeCompare(String(a.t || ''))).slice(0, limit);
}
function updateMemory(mid, text) {
  mid = String(mid || '').trim();
  text = String(text || '').trim().slice(0, 1000);
  if (!mid || !text) return false;
  const mem = loadMemory();
  const it = mem.find((x) => x.id === mid);
  if (!it) return false;
  it.text = text;
  it.t_edit = stamp(false);
  writeRaw(MEM_KEY, mem);
  return true;
}
function deleteMemory(mid) {
  mid = String(mid || '').trim();
  if (!mid) return false;
  const mem = loadMemory();
  const rest = mem.filter((x) => x.id !== mid);
  if (rest.length === mem.length) return false;
  writeRaw(MEM_KEY, rest);
  return true;
}
function clearMemory() { writeRaw(MEM_KEY, []); }

/* ---------------- 备份 / 迁移 ---------------- */
function exportPayload() {
  const cfg = clone(loadConfig());
  delete cfg.api.key;
  delete cfg.api.has_key;
  return {
    app: '鳥籠',
    version: VERSION,
    exported_at: stamp(true),
    config: cfg,
    state: loadState(),
    memory: loadMemory(),
    history: loadHistory(),
    summary: readRaw(SUMMARY_KEY, {}),
    touches: readRaw(TOUCH_KEY, []),
    scene: readRaw(SCENE_KEY, {}),
    threat: readRaw(THREAT_KEY, {}),
  };
}
function importPayload(data) {
  if (!data || typeof data !== 'object') throw new Error('不是有效的备份文件');
  const cur = loadConfig();
  if (data.config && typeof data.config === 'object') {
    const cfg = deepMerge(cur, data.config);
    // 换设备导入时保留本机当前 Key；备份里本来就不放 Key
    cfg.api.key = (cur.api || {}).key || '';
    writeRaw(CFG_KEY, cfg);
  }
  if (data.state && typeof data.state === 'object') writeRaw(STATE_KEY, deepMerge(STATE_DEFAULT, data.state));
  if (Array.isArray(data.memory)) writeRaw(MEM_KEY, data.memory);
  if (data.history && typeof data.history === 'object') {
    writeRaw(HIST_KEY, {
      offline: Array.isArray(data.history.offline) ? data.history.offline : [],
      online: Array.isArray(data.history.online) ? data.history.online : [],
    });
  }
  if (data.summary && typeof data.summary === 'object') writeRaw(SUMMARY_KEY, data.summary);
  if (Array.isArray(data.touches)) writeRaw(TOUCH_KEY, data.touches);
  if (data.scene && typeof data.scene === 'object') writeRaw(SCENE_KEY, data.scene);
  if (data.threat && typeof data.threat === 'object') writeRaw(THREAT_KEY, data.threat);
  return true;
}

/* ---------------- 历史 ---------------- */
function loadHistory() {
  const h = readRaw(HIST_KEY, { offline: [], online: [] });
  if (!h || typeof h !== 'object') return { offline: [], online: [] };
  return { offline: Array.isArray(h.offline) ? h.offline : [], online: Array.isArray(h.online) ? h.online : [] };
}
function appendChat(role, text, extra, channel) {
  const h = loadHistory();
  const ch = channel === 'online' ? 'online' : 'offline';
  const line = Object.assign({ t: stamp(true), role, text }, extra || {});
  h[ch].push(line);
  if (h[ch].length > 600) h[ch] = h[ch].slice(-600);
  writeRaw(HIST_KEY, h);
}
function historyForApi(channel) {
  const h = loadHistory();
  const list = h[channel === 'online' ? 'online' : 'offline'];
  return list.map((x) => ({ role: x.role, content: x.text, t: x.t, pov: x.pov || 'user' }));
}
function cleanAssistantForPrompt(text) {
  let s = sanitizeModelOutput(text);
  s = cleanLines(s);
  return s.trim();
}
function recentHistory(turns, channel, stage = 'A') {
  const h = loadHistory();
  const lines = [];
  h[channel === 'online' ? 'online' : 'offline'].forEach((obj) => {
    if (!obj || !['user', 'assistant'].includes(obj.role) || !obj.text) return;
    if (obj.role === 'assistant' && HISTORY_BAD_RE.test(obj.text)) return;
    if (obj.role === 'assistant' && stage !== 'C' && WIFE_WORD_RE.test(obj.text)) return;
    let text = obj.text;
    if (obj.role === 'assistant') {
      text = cleanAssistantForPrompt(text);
      if (!text) return;
      text = text.replace('雅楽代君', '\u0000NAME\u0000').replace(/君/g, 'あなた').replace(/\u0000NAME\u0000/g, '雅楽代君');
    }
    lines.push({ role: obj.role, content: text });
  });
  // 设置里写的是「聊天上下文条数」，按消息条数算；旧版误乘 2，
  // 填 100 实际会塞 200 条，容易让模型把更早的 user 也当成待回答的问题。
  const n = Math.max(2, Number(turns) || 12);
  return lines.slice(-n);
}
function clearHistory() { writeRaw(HIST_KEY, { offline: [], online: [] }); }

/* ---------------- 拍一拍 / 场景 ---------------- */
function addTouch(kind) {
  if (!TOUCH_TEXT[kind]) return false;
  const cur = readRaw(TOUCH_KEY, []);
  cur.push({ t: nowText(), kind, text: TOUCH_TEXT[kind] });
  writeRaw(TOUCH_KEY, cur.slice(-6));
  return true;
}
function pendingTouches() { const cur = readRaw(TOUCH_KEY, []); return Array.isArray(cur) ? cur : []; }
function clearTouches() { writeRaw(TOUCH_KEY, []); }
function addSceneEvent(bgId, label) {
  const noMove = /旧宅/.test(String(label || ''));
  writeRaw(SCENE_KEY, { t: nowText(), bg: bgId, label: label || bgId, preview: noMove });
}
function pendingScene() { const d = readRaw(SCENE_KEY, {}); return d && d.bg ? d : {}; }
function clearScene() { writeRaw(SCENE_KEY, {}); }

/* ---------------- 提示词 ---------------- */
function timelineText(cfg) {
  const custom = String(cfg.timeline_custom || '').trim();
  if (custom) return '【时间锚点 · 自定义】' + custom;
  return TIMELINE_BLOCKS[String(cfg.timeline || 'A').toUpperCase()] || TIMELINE_BLOCKS.A;
}
function relationStage(cfg) {
  const custom = String(cfg.timeline_custom || '').trim();
  let stage = String(cfg.timeline || 'A').toUpperCase();
  if (custom) {
    if (/同居|婚后|结婚|夫妻|夫人|夫君|嫁/.test(custom)) stage = 'C';
    else if (/婚约取消|取消婚约|做朋友|分手/.test(custom)) stage = 'D';
    else if (/小时候|幼|童年|回忆|孩子/.test(custom)) stage = 'E';
    else stage = 'A';
  }
  return ['A', 'B', 'C', 'D', 'E'].includes(stage) ? stage : 'A';
}
function relationRules(cfg) {
  const stage = relationStage(cfg);
  const historyRule = '旧对话里如果出现过“妻子／老婆／奥さん／お嫁さん”的句子，那是失败的即兴，不要模仿、不要接着玩这个梗。';
  if (stage === 'E') {
    return '【关系阶段 · 小时候（硬规则）】两人都是孩子（約九到十岁），不是婚约对象，不是恋人。只写童年玩伴之间的亲近：一起玩、分享点心、拉手跑过庭院、约好下次见面。不要写婚约、求婚、占有欲、成人恋爱、亲吻或身体越界。';
  }
  if (stage === 'C') {
    return '【关系阶段 · 同居之后（硬规则）】\n' +
      '实雪已经住进雅楽代家，两人互通过心意；可以偶尔用「奥さん」「俺の妻」这种轻的、带笑的称呼。\n' +
      '但仍然不是命令或宣告：不要用“作为我的妻子”“你必须当我的妻子”“妻子的位置给你留着”这种把她按进身份的说法。\n' +
      '她要是否认或害羞，就笑着退半步，不要追着证明。\n' + historyRule;
  }
  return '【关系阶段 · 婚前（硬规则，优先于台词习惯和旧对话）】\n' +
    '现在是 A/B/D 阶段：婚约已经在法律上取消，她没有答应同居、也没有答应结婚。她不是你的妻子，不要把她当成既定身份。\n' +
    '禁止任何“我的妻子／老婆／夫人／お嫁さん／奥さん”“作为我的妻子”“当我的妻子”“妻子的位置给你留着”的说法。\n' +
    '「婚約者」可以提，但只能当小时候的旧事或玩笑，说完自己先收；她否认、皱眉或说“谁是你妻子”，就立刻退回朋友距离，不要继续缠。\n' +
    '婚前的亲近方式是：来店里看她、请客、拿旧事逗她、问她“俺のこと、どう思ってる？”、被拒绝时笑着说“じゃあ、今日はここまでにしとくよ”。\n' +
    historyRule;
}
function presenceRules(st) {
  if (st.apart) {
    return '【空间关系 · 分开｜硬规则】你们现在不在同一地点，彼此看不见对方。\n' +
      '不要写对方就在身边、不要写对方站在房间里或伸手碰到你；对方只能通过电话、短信、回忆、书信出现。\n' +
      '「我」视角只写自己所在的地方发生的事；「帳」视角只写他在自己的地方发生的事。切换视角不会把两个人瞬移到一起。\n' +
      '如果这一轮发生了告别、他先走、你回家、两人分开，就在回复最后单独一行写 `@@STATE apart=true`；如果重逢、回到同一地点，就写 `@@STATE apart=false`。不要只在旁白里说分开。';
  }
  return '【空间关系 · 同处】你们现在在同一地点，可以看见对方、听见对方说话；但仍要遵守当前视角的心理隔离。\n' +
    '如果这一轮发生告别、他先走、你回家、两人分开，就在回复最后单独一行写 `@@STATE apart=true`；如果重逢、回到同一地点，就写 `@@STATE apart=false`。不要只在旁白里说分开。';
}
function ambientRules(bgLabel) {
  const publicScene = /(咖啡|喫茶|店|街|车站|公園|公园|市场|餐廳|餐厅|食堂|教会|教室|学园|学園|等待室|大厅)/.test(bgLabel || '');
  if (!publicScene) return '【路人／环境声｜可选】当前不是公共场所，不要为了热闹硬加路人；把注意力留在两人的对话上。';
  return '【路人／环境声｜可选，不是每轮都要】当前在公共场所，可以偶尔插入 1 句路人的自然台词，让场景有生活感。\n' +
    '格式必须单独一行，行首写说话人：`田中：请给我一杯咖啡` 或 `田中：「请给我一杯咖啡」`；整行不要再套一层多余的引号，不要给路人写心理，不要给路人立绘。\n' +
    '**说话人的名字要按剧情来**：前文已经出现过名字，就直接用那个名字（田中、佐藤さん、美咲）；没有名字，就写具体身份（店员、同学、店主、老师、邻桌客人、路人A）。不要一律固定写「路人」，只有真的不知道身份、也无法从上下文推断时才用「路人」。\n' +
    '路人只做环境声，不推进主线、不打断两人的关键对话；如果这一轮正在表白、争吵、受伤、亲密或剧情紧张，就完全不要加。';
}
function povRules(pov) {
  if (pov === 'char') {
    return '【当前视角 · 雅楽代帳（我）的第一人称｜硬规则，优先于角色人设里的视角说明】\n' +
      '旁白里的「我」＝帳，実雪是「她」。不要写「帳：……」这种第三人称。\n' +
      '这一视角只允许帳的心理、感官和判断；実雪的心理不可见——不要输出她的括号心声，也不要用旁白替她解释她在想什么。她的情绪只能通过你看见的台词、表情、动作表现。\n' +
      '用户发来的文字是帳视角下的旁白／动作，不是実雪的台词；把它当作正在发生的事，不要当作用户在说话，也不要复述它。\n' +
      '画面里可以看见帳的立绘；但旁白里的我仍然是帳，不要写「我看着自己的脸」或描述自己的立绘。';
  }
  return '【当前视角 · 九重実雪（我）的第一人称｜硬规则，优先于角色人设里的视角说明】\n' +
    '旁白里的「我」＝実雪，帳是「他」。不要写「実雪：……」这种第三人称。\n' +
    '这一视角只允许実雪的心理、感官和判断；帳的心理不可见——不要输出帳的括号心声，也不要用旁白直接解释他在想什么。他的情绪只能通过你看见的台词、表情、动作表现。\n' +
    '用户发来的文字是実雪的动作／台词；不要在回复里替実雪补心理，也不要复述她刚说的话。\n' +
    '同处时画面里可以看见帳的立绘；如果空间关系是分开，则看不到他。';
}
function spriteGroupForTimeline(timeline) {
  const base = (FS.manifest || {}).sprite || {};
  if (String(timeline || '').toUpperCase() === 'E' && base.child) return base.child;
  return base;
}
function activeSpriteGroup() {
  return spriteGroupForTimeline(loadConfig().timeline);
}
function manifestDigest(cfg) {
  const man = FS.manifest || {};
  const group = spriteGroupForTimeline((cfg || {}).timeline);
  const exprs = [];
  Object.keys(group.bust || {}).forEach((k) => {
    exprs.push(k + '=' + ((group.bust || {})[k].label || ''));
  });
  const bgs = [], bgms = [];
  (man.bg || []).slice(0, 60).forEach((it) => { if (it.curated) bgs.push(it.id + '=' + (it.label || '')); });
  (man.bgm || []).slice(0, 60).forEach((it) => { bgms.push(it.id + '=' + (it.label || '')); });
  const guests = [];
  Object.keys(man.guests || {}).forEach((gid) => {
    const g = man.guests[gid];
    const keys = Object.keys(g.bust || {}).map((k) => k + '=' + ((g.bust || {})[k].label || '')).join('，');
    guests.push(gid + '（' + (g.name || '') + '）表情键：' + keys);
  });
  const guestLine = guests.length ? '配角（可出场）：' + guests.join('；') + '\n' : '';
  const exprNote = String((cfg || {}).timeline || '').toUpperCase() === 'E'
    ? '（时间锚点 E：小时候立绘，仅半身）'
    : '（近景/半身两档共用同一套键）';
  return '【可用素材 id（只能从这里选）】\n' +
    '表情键：' + exprs.join('，') + exprNote + '\n' +
    '距离：dist=far（半身） / dist=near（整屏近景特写）\n' +
    guestLine +
    '背景：' + bgs.join('，') + '\n' +
    'BGM：' + bgms.join('，');
}
function scenePlaceNote(bgId, label) {
  const bid = String(bgId || '').trim();
  const lab = String(label || '').trim();
  if (bid === 'bg_009' || lab.includes('纯喫茶') || lab.includes('純喫茶')) {
    return '街上的另一家纯喫茶，不是待宵亭，也不是実雪打工的カフェー。原作里她是提前到这家店等人（约在下午一点），觉得这里安静、和打工的店气氛像但不是同一个地方。不要写成她在这里当女招待、也不要写成你来看她上班；你们是出门来这里见面/喝茶的。';
  }
  if (['bg_010', 'bg_011', 'bg_050', 'bg_051', 'bg_052', 'bg_053', 'bg_054', 'bg_055'].includes(bid) || lab.includes('咖啡厅') || lab.includes('カフェー')) {
    return '待宵亭，実雪打工的咖啡厅（她在这里用「樱」这个化名当女招待还债）；帳每天来店里看她。这里是她的工作地点，不是她家，也不是纯喫茶。';
  }
  if (lab.includes('雅乐代') || lab.includes('雅樂代') || lab.includes('帐的房间') || lab.includes('衣装间')) {
    return '雅楽代家（帳的家/本家）。这里不是実雪打工的店，也不是她自己的公寓；父母可能在这里。';
  }
  if (lab.includes('旧宅')) return '九重家旧宅已经被查封，不是可进入的场景；不能写前往、进入、推门或屋内回忆。';
  if (bid === 'bg_035' || lab.includes('九重') || lab.includes('主人公部屋')) return '九重実雪现在住的房间（咖啡屋老板提供的公寓内），不是破产前的九重家旧宅，也不是雅楽代家；旧宅已经被查封，不能住。';
  if (lab.includes('公寓')) return '実雪住的公寓（咖啡屋老板提供的住处/外观），不是雅楽代家，也不是她打工的店；如果画面是外观，不要写成房间内部。';
  if (lab.includes('平井')) return '平井鏡太郎的家/住处，不是帳家，也不是実雪家。';
  if (lab.includes('学校') || lab.includes('教室')) return '学校/校舍，不是家，也不是咖啡店。';
  if (['街道', '街', '小巷', '后巷', '死巷', '东京站', '百货店', '电影院', '西餐厅', '酒吧', '酒屋', '乡间', '海', 'タクシー'].some((k) => lab.includes(k))) {
    return '出门在外（街道/公共场所/约会地点），不是待宵亭，也不是家；你们是出来办事、约会或偶遇。';
  }
  if (['夜空', '星空', '烟火', '朝霞', '夕阳', '晴空', '天空'].some((k) => lab.includes(k))) {
    return '天空/远景/时间氛围，不是一间具体的房间；只当景色和情绪，不要据此说“回到了家/店里”。';
  }
  if (['鸟笼', '椿', '信', '礼物', '葡萄酒', '抽屉', '书', '注射', '车轮', '纯白', '漆黑', '素材', '意象', '虚化'].some((k) => lab.includes(k))) {
    return '意象/物件/特写画面，不是实际所在的地点；不要把它当成新房间或新店。';
  }
  if (lab.includes('仓库')) return '仓库，不是待宵亭，也不是家。';
  if (lab.includes('浴室')) return '浴室，不是待宵亭，也不是外面的街道。';
  return '当前画面所示的地点；不要把它误认成待宵亭或実雪打工的店。';
}
function readPersona(key) {
  const f = PERSONA_FILES[key] || '';
  return (FS.personas && FS.personas[f]) || '';
}
function buildSystemBlocks(cfg, channel, pov) {
  const st = loadState();
  const bg = bgLabel(st.background);
  const userBg = bgItem(st.bg_user) ? st.bg_user : st.background;
  const charBg = bgItem(st.bg_char) ? st.bg_char : st.background;
  const userLabel = bgLabel(userBg);
  const charLabel = bgLabel(charBg);
  const scene = '【当前时间】' + nowText() + '（用户本地时间）\n' +
    '【当前场景】画面背景=' + st.background + '（' + bg + '）；表情=' + st.expression + '；BGM=' + st.bgm + '；CG=' + (st.cg || '无') + '\n' +
    '【当前各自位置】実雪=' + userBg + '（' + userLabel + '）；帳=' + charBg + '（' + charLabel + '）；' +
    (st.apart ? '两人现在分开，不在同一地点。' : '两人现在在同一地点。') + '\n' +
    '【地点性质（必须遵守）】' + scenePlaceNote(st.background, bg);
  const mem = pickMemory(Number((cfg.prompt || {}).memory_top_n || 12));
  const memText = mem.length ? '【长期记忆】\n' + mem.map((x) => '- (' + (x.t || '') + ') ' + (x.text || '')).join('\n') : '【长期记忆】暂无';
  const blocks = [
    (channel === 'online' ? '' : povRules(pov || st.pov)), (channel === 'online' ? '' : presenceRules(st)), (channel === 'online' ? '' : ambientRules(bg)), readPersona('persona'), scene, timelineText(cfg), relationRules(cfg), readPersona('user'), memText,
    manifestDigest(cfg), readPersona('story'), (FS.rules && FS.rules.format) || '',
  ];
  if (channel === 'online') blocks.push((FS.rules && FS.rules.online) || '');
  if (channel !== 'online') {
    const sc = pendingScene();
    if (sc && sc.bg) {
      if (sc.preview) {
        blocks.push('【她刚把画面切到（刚发生，还没回应过）】\n' +
          '实雪把画面换成了「' + (sc.label || sc.bg) + '」（' + sc.bg + '）。' +
          '这个画面的性质：' + scenePlaceNote(sc.bg, sc.label || '') + '\n' +
          '**这只是画面预览，不是你们实际到达了这里。** 不要写“走了一会儿／我们来到了／推开房门／走进去了”，也不要改变当前实际地点。' +
          '如果她问起这个画面，就按你们现在真正所在的地方回答；不要为了配合画面把她搬进九重家旧宅。');
      } else {
        blocks.push('【她刚把场景换了（刚发生，还没回应过）】\n' +
          '实雪把画面从刚才的地方换成了「' + (sc.label || sc.bg) + '」（' + sc.bg + '）。' +
          '这个新地点的性质：' + scenePlaceNote(sc.bg, sc.label || '') + '\n' +
          '这不是她按错了按钮——就当成你们真的走过去了。' +
          '回应时先用一句第一人称旁白交代移动，例如「走了一会儿，我们到了电影院。」（换成对应地点），然后再接她/你的台词或动作；不要问她为什么换地方，也不要提“背景”“按钮”“设置”这些词。');
      }
    }
    const touches = pendingTouches();
    if (touches.length) {
      blocks.push('【她刚才的动作（刚发生，还没回应过）】\n' +
        touches.slice(-3).map((t) => '- ' + (t.text || '')).join('\n') +
        '\n这是她主动碰了你。回应里可以自然地带一句反应（僵一下、嘴硬、或者干脆顺着她），不要每次都提，也不要写成大段感想；最多占一行。');
    }
  }
  return blocks.filter((b) => b && String(b).trim());
}
function buildMessages(cfg, userText, extraSystem, channel, pov) {
  const blocks = buildSystemBlocks(cfg, channel, pov);
  if (extraSystem) blocks.unshift(extraSystem);
  const turns = Number((cfg.prompt || {}).history_turns || 12);
  const msgs = [{ role: 'system', content: blocks.join('\n\n') }].concat(recentHistory(turns, channel, relationStage(cfg)));
  msgs.push({ role: 'user', content: userText });
  const budget = Number((cfg.prompt || {}).max_chars || 24000);
  let total = msgs.reduce((n, m) => n + String(m.content || '').length, 0);
  // 历史末尾必须是 assistant，否则会在 current user 前留下一条没被回答的 user，
  // 模型可能把它和当前这条一起回答，看起来就像“复读上上轮”。
  while (msgs.length > 2 && msgs[msgs.length - 2].role === 'user') {
    total -= String(msgs[msgs.length - 2].content || '').length;
    msgs.splice(msgs.length - 2, 1);
  }
  // 超出预算时按“一整轮”删，不要只删半轮，避免留下孤立的 user 消息。
  while (total > budget && msgs.length > 3) {
    const a = msgs[1], b = msgs[2];
    if (a && a.role === 'user' && b && b.role === 'assistant') {
      total -= String(a.content || '').length + String(b.content || '').length;
      msgs.splice(1, 2);
    } else {
      total -= String(a.content || '').length;
      msgs.splice(1, 1);
    }
  }
  if (total > budget) {
    const over = total - budget;
    msgs[msgs.length - 1].content = msgs[msgs.length - 1].content.slice(0, Math.max(200, msgs[msgs.length - 1].content.length - over));
  }
  // 紧贴当前 user 放一条最新消息锚点：历史只当背景，别把更早的 user 当成待回答的问题。
  msgs.splice(msgs.length - 1, 0, {
    role: 'system',
    content: '【最新一条】下面才是实雪这一轮刚发来的消息。以上全部是历史，只作背景：不要回答、复述或续写历史里的任何 user，也不要先把更早的话接一遍。只回应下面这一条。',
  });
  return msgs;
}

/* ---------------- 模型调用 ---------------- */
function endpointUrl(base, path) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  path = path || '/chat/completions';
  if (b.endsWith('/chat/completions')) return b;
  if (b.endsWith('/v1')) return b + path;
  if (/\/v\d/i.test(b)) return b + path;
  return b + '/v1' + path;
}
function modelsUrl(base) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  if (b.endsWith('/chat/completions')) return b.replace(/\/chat\/completions$/, '/models');
  if (b.endsWith('/v1')) return b + '/models';
  if (/\/v\d/i.test(b)) return b + '/models';
  return b + '/v1/models';
}
async function postJSON(url, payload, key, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout || 90000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await r.text();
    if (!r.ok) throw new Error('接口返回 ' + r.status + '：' + text.slice(0, 500));
    try { return JSON.parse(text); } catch (e) { throw new Error('接口返回不是 JSON：' + text.slice(0, 200)); }
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('请求超时（90 秒）');
    if (e && /Failed to fetch|NetworkError|Load failed/i.test(e.message || '')) throw new Error('连不上接口（检查 Base URL / 网络 / 浏览器 CORS）');
    throw e;
  } finally { clearTimeout(timer); }
}
async function callModel(cfg, messages, timeout, temperature) {
  const api = cfg.api || {};
  const base = String(api.base_url || '').trim();
  const key = String(api.key || '').trim();
  const model = String(api.model || '').trim();
  if (!base) throw new Error('还没有填 API 地址');
  if (!key) throw new Error('还没有填 API Key');
  const payload = {
    model: model || 'gpt-4o-mini', messages,
    temperature: Number(temperature == null ? (api.temperature == null ? 0.85 : api.temperature) : temperature),
    max_tokens: Number(api.max_tokens || 1200),
  };
  const body = await postJSON(endpointUrl(base, '/chat/completions'), payload, key, timeout);
  const choices = body.choices || [];
  if (!choices.length) throw new Error('接口没有返回内容');
  const msg = choices[0].message || {};
  let text = String(msg.content || '').trim();
  if (text) return text;
  const reasoning = msg.reasoning_content || msg.reasoning || '';
  const finish = choices[0].finish_reason || '';
  const payload2 = Object.assign({}, payload, { max_tokens: Math.max(Number(payload.max_tokens) * 2, 2000) });
  const body2 = await postJSON(endpointUrl(base, '/chat/completions'), payload2, key, timeout);
  const msg2 = ((body2.choices || [{}])[0] || {}).message || {};
  text = String(msg2.content || '').trim();
  if (text) return text;
  let hint = '（finish_reason=' + (finish || '?');
  if (reasoning) hint += '，模型只吐了思考过程';
  hint += '）';
  throw new Error('模型这次没给出正文，已自动重试一次仍为空 ' + hint + '。把 max_tokens 调大，或换成不带思考的模型。');
}
async function listModels(cfg, timeout) {
  const api = cfg.api || {};
  const base = String(api.base_url || '').trim();
  const key = String(api.key || '').trim();
  if (!base) throw new Error('还没有填 API 地址');
  if (!key) throw new Error('还没有填 API Key');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout || 45000);
  try {
    const r = await fetch(modelsUrl(base), { headers: { Authorization: 'Bearer ' + key }, signal: ctrl.signal });
    const text = await r.text();
    if (!r.ok) throw new Error('拉取失败 ' + r.status + '：' + text.slice(0, 300));
    let body; try { body = JSON.parse(text); } catch (e) { throw new Error('模型列表不是 JSON'); }
    if (!body || !Array.isArray(body.data)) throw new Error('这个接口不返回模型列表（/models 不是 OpenAI 格式）');
    return body.data.map((it) => (it && it.id) || (typeof it === 'string' ? it : '')).filter(Boolean).sort();
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('请求超时');
    if (e && /Failed to fetch|NetworkError|Load failed/i.test(e.message || '')) throw new Error('连不上接口（检查 Base URL / 网络 / CORS）');
    throw e;
  } finally { clearTimeout(timer); }
}

/* ---------------- 解析模型输出 ---------------- */
function onlineFilter(text) {
  const out = [];
  String(text || '').split('\n').forEach((ln) => {
    let s = ln.trim();
    if (!s || s.startsWith('（') || s.startsWith('(')) return;
    s = s.replace(/^[「『"]+|[」』"]+$/g, '');
    if (s) out.push(s);
  });
  return out.join('\n');
}
function povFilter(text, pov) {
  if (pov !== 'user') return text;
  const lines = String(text || '').split('\n').map((x) => x.trim()).filter(Boolean)
    .filter((x) => !/^[（(]/.test(x));
  return lines.join('\n') || '他沉默了一下。';
}
function parseMemoLine(s) {
  if (!s || ['-', '无', 'none'].includes(s.trim())) return [];
  const parts = s.split('|').map((x) => x.trim());
  let kind = 'fact', weight = '3', text = '';
  if (parts.length >= 3) { kind = parts[0]; weight = parts[1]; text = parts.slice(2).join('|'); }
  else if (parts.length === 2) { kind = 'fact'; weight = parts[0]; text = parts[1]; }
  else { kind = 'fact'; weight = '3'; text = parts[0]; }
  let w = parseInt(weight, 10); if (!Number.isFinite(w)) w = 3; w = Math.max(1, Math.min(5, w));
  if (!text || text === '-') return [];
  return [{ kind: ['fact', 'event', 'prefer', 'promise', 'mood'].includes(kind) ? kind : 'fact', weight: w, text }];
}
function cleanLines(body) {
  const out = [];
  let fence = false;
  String(body || '').split('\n').forEach((ln) => {
    let s = ln.trim();
    if (!s) return;
    if (s.startsWith('```') || s.startsWith('~~~')) { fence = !fence; return; }
    if (fence) return;
    if (/^(call|tool_call|function_call|assistant|system|default_api|agw_emit|content)\s*[:：{]/i.test(s)) return;
    if (/^@@/.test(s)) return;
    s = s.replace(/^line\s*\d+\s*(?:\([^)]*\))?\s*[:：]/i, '');
    s = s.replace(/^（?(?:dialogue|narration|inner|thought|台词|心声|旁白)）?\s*[:：]?\s*/i, '');
    s = s.replace(/\*\*/g, '').replace(/`/g, '');
    s = s.replace(/^[*#>]+/, '').trim().replace(/^["']+|["']+$/g, '').replace(/}+$/, '').trim();
    if (!s) return;
    if (!/[\u3040-\u30ff\u3400-\u9fff]/.test(s)) return;
    out.push(s);
  });
  return out.slice(0, 12).join('\n');
}
function sanitizeModelOutput(raw) {
  let s = String(raw || '').replace(/\r/g, '');
  // 这个角色只说日文/中文；模型偶尔会漏出韩文音节（例如正文开头的「정」），直接清掉
  s = s.replace(/[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uAC00-\uD7AF\uD7B0-\uD7FF]/g, '');
  // 有些模型会把控制行拆成 @@ST / ATE，或者少一个 @，先统一拼回来
  s = s.replace(/@+\s*@*\s*S\s*T\s*A\s*T\s*E/gi, '@@STATE');
  // 去掉 default_api / agw_emit 这类工具调用包装，只留下 content 里的正文
  s = s.replace(/(^|\n)\s*(?:default_api|tool_call|function_call)\s*:[^\n{]*\{\s*content\s*:\s*/gi, '$1');
  s = s.replace(/default_api\s*:[^\n{]*\{\s*content\s*:\s*/gi, '');
  s = s.replace(/\bagw_emit_[0-9a-z]+\s*\{\s*content\s*:\s*/gi, '');
  // 控制行如果被挤在正文同一行（哪怕中间没有空格），都拆回独立一行
  s = s.replace(/([^\n])[ \t]*@@STATE/gi, '$1\n@@STATE');
  // 去掉包装残留的单独括号行
  s = s.replace(/(^|\n)\s*[}\]"']+\s*(?=\n|$)/g, '$1');
  return s;
}
function splitReply(raw) {
  raw = sanitizeModelOutput(raw);
  const statePatch = {}, memos = [];
  let webQuery = '', section = '';
  const keep = [];
  String(raw || '').replace(/\r/g, '').split('\n').forEach((ln) => {
    let s = ln.trim().replace(/^["']+|["']+$/g, '');
    if (s.startsWith('@@WEB')) { webQuery = s.slice(5).trim().replace(/^[：:]+/, ''); return; }
    if (s.startsWith('@@STATE')) {
      section = 'state';
      s = s.slice(6).replace(/[}\]"']+\s*$/g, '').trim();
      s.replace(/，/g, ' ').split(/\s+/).forEach((kv) => {
        if (!kv.includes('=')) return;
        const i = kv.indexOf('=');
        const k = kv.slice(0, i).trim().toLowerCase();
        const v = kv.slice(i + 1).trim().replace(/[}\]"']+$/g, '');
        if (k === 'bg' || k === 'background') statePatch.background = v || '';
        else if (k === 'face' || k === 'expression') statePatch.expression = v || '';
        else if (k === 'bgm') statePatch.bgm = v || '';
        else if (k === 'cg') statePatch.cg = v || '';
        else if (k === 'dist' || k === 'distance') statePatch.dist = v || '';
        else if (k === 'guest' || k === 'cameo') statePatch.guest = v || '';
        else if (k === 'apart' || k === 'separate' || k === 'together') statePatch.apart = v || '';
      });
      return;
    }
    if (s.startsWith('@@MEMO')) {
      section = 'memo';
      const rest = s.slice(6).trim();
      if (rest) memos.push(...parseMemoLine(rest));
      return;
    }
    if (section === 'memo') { if (s) memos.push(...parseMemoLine(s)); return; }
    keep.push(ln);
  });
  return { reply: cleanLines(keep.join('\n').trim()), statePatch, memos: memos.slice(0, 4), webQuery };
}

/* ---------------- 配角 / 状态校验 ---------------- */
const GUEST_PEOPLE = {
  kagami: /(?:平井\s*)?(?:鏡太郎|镜太郎)/,
  father: /(?:雅[樂乐]代\s*)?暁/,
  mother: /(?:雅[樂乐]代\s*)?(?:香[穗穂]留|かほる)/,
};
function guestLineRes() {
  const out = {};
  Object.keys(GUEST_PEOPLE).forEach((gid) => {
    out[gid] = new RegExp('^(?:' + GUEST_PEOPLE[gid].source + ')\\s*(?:\\[[A-Za-z_]+\\])?\\s*[：:]');
  });
  return out;
}
function replyMentionsGuest(reply) {
  const res = guestLineRes();
  for (const raw of String(reply || '').split('\n')) {
    const s = raw.trim();
    if (!s) continue;
    for (const gid of Object.keys(res)) { if (res[gid].test(s)) return gid; }
    if (!/^[「『（(]/.test(s)) {
      for (const gid of Object.keys(GUEST_PEOPLE)) { if (GUEST_PEOPLE[gid].test(s)) return gid; }
    }
  }
  return '';
}
function threatGuardOk() {
  const g = readRaw(THREAT_KEY, {});
  if (!g || !g.line) return true;
  return (loadHistory().offline.length - Number(g.line)) >= 60;
}
function threatGuardMark() { writeRaw(THREAT_KEY, { line: loadHistory().offline.length }); }
function sanitizeStatePatch(patch) {
  const out = {};
  const man = FS.manifest || {};
  const bgIds = new Set((man.bg || []).map((x) => x.id));
  const faceKeys = new Set(Object.keys((activeSpriteGroup().bust) || {}));
  const bgmIds = new Set((man.bgm || []).map((x) => x.id));
  if (bgIds.has(patch.background)) out.background = patch.background;
  if (bgIds.has(patch.bg_user)) out.bg_user = patch.bg_user;
  if (bgIds.has(patch.bg_char)) out.bg_char = patch.bg_char;
  if (faceKeys.has(patch.expression)) {
    let expr = patch.expression;
    if (expr === 'threat' && !threatGuardOk()) expr = 'angry';
    if (expr === 'threat') threatGuardMark();
    out.expression = expr;
  }
  if (['far', 'near'].includes(patch.dist)) out.dist = patch.dist;
  const g = patch.guest;
  if (['', 'none', 'off'].includes(g)) out.guest = '';
  else if (g && (man.guests || {})[g]) out.guest = g;
  if (bgmIds.has(patch.bgm)) out.bgm = patch.bgm;
  if ('cg' in patch) out.cg = new Set((man.cg || []).map((x) => x.id)).has(patch.cg) ? patch.cg : '';
  if ('apart' in patch) out.apart = (patch.apart === true || patch.apart === 'true' || patch.apart === 1 || patch.apart === '1');
  return out;
}

/* ---------------- 记忆自动总结 ---------------- */
function summaryCounter() { const d = readRaw(SUMMARY_KEY, {}); return Number(d.n || 0) || 0; }
function setSummaryCounter(n) { writeRaw(SUMMARY_KEY, { n: Number(n) || 0, t: stamp(false) }); }
function parseMemoLines(raw) {
  const items = [];
  String(raw || '').split('\n').forEach((line) => {
    line = line.trim().replace(/`/g, '').trim();
    if (!line || !line.includes('|')) return;
    const parts = line.split('|').map((x) => x.trim());
    if (parts.length < 3) return;
    const kind = parts[0], weight = parseInt(parts[1], 10), text = parts.slice(2).join('|').trim();
    if (!text || text === '-') return;
    items.push({ kind: kind || 'fact', weight: Number.isFinite(weight) ? Math.max(1, Math.min(5, weight)) : 3, text });
  });
  return items.slice(0, 8);
}
async function summarizeRecent(cfg, turns, channel) {
  const lines = recentHistory(turns, channel, relationStage(cfg));
  if (!lines.length) return 0;
  const transcript = '【现在】' + nowText() + '\n' + lines.map((m) => (m.role === 'user' ? '実雪：' : '帳：') + m.content).join('\n');
  try {
    const raw = await callModel(cfg, [{ role: 'system', content: SUMMARY_PROMPT }, { role: 'user', content: transcript }], 90000);
    return addMemory(parseMemoLines(raw));
  } catch (e) { return 0; }
}
function tickSummary(cfg, channel) {
  let every = Number((cfg.prompt || {}).summary_every || 0);
  if (!Number.isFinite(every) || every <= 0) return;
  const n = summaryCounter() + 1;
  if (n < every) { setSummaryCounter(n); return; }
  setSummaryCounter(0);
  setTimeout(() => { summarizeRecent(cfg, every, channel).catch(() => {}); }, 0);
}

/* ---------------- 附件 ---------------- */
function decodeBase64Text(b64) {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
async function upload(body) {
  const name = String(body.name || 'file').split(/[\\/]/).pop() || 'file';
  const data = String(body.data || '');
  if (!data) return { ok: false, error: '空文件' };
  const ext = (name.match(/\.([^.]+)$/) || [])[1] || '';
  const lower = ext.toLowerCase();
  const textExt = ['txt', 'md', 'csv', 'json', 'html', 'htm', 'py', 'js', 'ts', 'css', 'xml', 'yaml', 'yml'];
  if (!textExt.includes(lower)) {
    return { ok: false, error: '纯前端版暂不支持 .' + (ext || '未知') + ' 正文提取；先把文字复制进来，或换 txt/md/csv/json。' };
  }
  let text = '';
  try { text = decodeBase64Text(data.split(',')[1] || ''); }
  catch (e) { return { ok: false, error: '文件解码失败' }; }
  const note = '[附件] ' + name + '（' + Number(body.size || text.length) + ' 字节，纯文本）\n【附件正文·节选】\n' + text.slice(0, 3500) +
    (text.length > 3500 ? '\n……（后略，共 ' + text.length + ' 字）' : '');
  return { ok: true, file: name, note, size: Number(body.size || text.length), chars: text.length, kind: '纯文本' };
}

/* ---------------- 聊天 ---------------- */
async function chat(body) {
  const cfg = loadConfig();
  let text = String(body.text || '').trim();
  const attachNote = String(body.attach_note || '').trim();
  if (attachNote) text = (text + '\n' + attachNote).trim() || attachNote;
  if (!text) return { ok: false, error: '空消息' };
  const extraSystem = String(body.extra_system || '').trim();
  const channel = body.channel === 'online' ? 'online' : 'offline';
  const pov = body.pov === 'char' ? 'char' : 'user';
  let histText = text;
  if (attachNote) {
    const head = attachNote.split('【附件正文')[0].trim();
    histText = (text.replace(attachNote, '').trim() + '\n' + head + '〔正文已读，见当轮回复〕').trim();
  }
  let raw;
  try {
    raw = await callModel(cfg, buildMessages(cfg, text, extraSystem, channel, pov), 90000);
  } catch (e) {
    const msg = e.message || String(e);
    return { ok: false, error: msg, need_key: /API 地址|API Key/.test(msg) };
  }
  const parsed = splitReply(raw);
  let reply = parsed.reply;
  if (channel === 'online') reply = onlineFilter(reply);
  else reply = povFilter(reply, pov);
  if (!reply) reply = '（……声が、うまく出ない。もう一度、俺の名前を呼んで。）（……声音有点出不来了。再叫一次我的名字。）';
  const applied = sanitizeStatePatch(parsed.statePatch);
  if (Object.keys(FS.manifest.guests || {}).length) applied.guest = replyMentionsGuest(reply);
  if (applied.background) {
    if (applied.apart === true) {
      applied[pov === 'char' ? 'bg_char' : 'bg_user'] = applied.background;
    } else {
      applied.bg_user = applied.background;
      applied.bg_char = applied.background;
    }
  } else if (applied.apart === false) {
    // 模型判断“重新同处”时，两边地点一起回到当前画面，避免切视角跳回旧地点。
    applied.bg_user = applied.bg_char = loadState().background;
  }
  if (Object.keys(applied).length) saveState(applied);
  // 记忆只由每 30 轮的自动总结写入；忽略模型偶尔漏出的 @@MEMO，避免又变成一句话一条。
  // addMemory(parsed.memos);
  appendChat('user', histText, { pov }, channel);
  appendChat('assistant', reply, Object.assign({ pov }, Object.keys(applied).length ? { state: applied } : null), channel);
  if (channel !== 'online') { clearTouches(); clearScene(); }
  tickSummary(cfg, channel);
  return { ok: true, reply, state: applied, memo: parsed.memos.length, model: (cfg.api || {}).model || '' };
}


/* ---------------- 双视角地点推理 ---------------- */
async function judgePovScene(body) {
  const cfg = loadConfig();
  const st = loadState();
  const pov = body.pov === 'char' ? 'char' : 'user';
  const userBg = bgItem(st.bg_user) ? st.bg_user : st.background;
  const charBg = bgItem(st.bg_char) ? st.bg_char : st.background;
  const bgList = (FS.manifest.bg || []).map((x) => x.id + '=' + (x.label || '')).join('\n');
  const hist = recentHistory(16, 'offline', relationStage(cfg));
  const transcript = hist.length
    ? hist.map((m) => (m.role === 'user' ? '実雪：' : '帳：') + String(m.content || '')).join('\n')
    : '（最近没有对话，沿用当前地点）';
  const prompt = SCENE_PROMPT
    .replace('%BG_LIST%', bgList)
    .replace('%USER_BG%', userBg)
    .replace('%USER_LABEL%', bgLabel(userBg))
    .replace('%CHAR_BG%', charBg)
    .replace('%CHAR_LABEL%', bgLabel(charBg))
    .replace('%APART%', st.apart ? '1' : '0')
    .replace('%TRANSCRIPT%', transcript + '\n\n' + timelineText(cfg));

  let raw;
  try {
    raw = await callModel(cfg, [
      { role: 'system', content: prompt },
      { role: 'user', content: '现在，只输出 USER / CHAR / APART 三行。' },
    ], 45000, 0.2);
  } catch (e) {
    return { ok: false, error: e.message || String(e), bg_user: userBg, bg_char: charBg, apart: !!st.apart };
  }

  const um = raw.match(/USER\s*[=：:]\s*(bg_\d+)/i);
  const cm = raw.match(/CHAR\s*[=：:]\s*(bg_\d+)/i);
  const am = raw.match(/APART\s*[=：:]\s*([01])/i);
  let ub = um ? um[1] : userBg;
  let cb = cm ? cm[1] : charBg;
  let apart = am ? am[1] === '1' : !!st.apart;
  if (!bgItem(ub)) ub = userBg;
  if (!bgItem(cb)) cb = charBg;
  if (!apart) {
    // 同处时两边必须使用同一张背景，优先沿用当前画面。
    if (bgItem(st.background) && (st.background === ub || st.background === cb)) { ub = cb = st.background; }
    else if (ub !== cb) { cb = ub; }
  }
  // 模型返回前用户可能又切了视角；这时不要把旧视角的结果写进当前状态。
  if (loadState().pov !== pov) {
    return { ok: false, error: '视角已切换', bg_user: userBg, bg_char: charBg, apart: !!st.apart };
  }
  const patch = { bg_user: ub, bg_char: cb, apart };
  patch.background = pov === 'char' ? cb : ub;
  saveState(patch);
  return {
    ok: true, bg_user: ub, bg_char: cb, apart,
    user_label: bgLabel(ub), char_label: bgLabel(cb),
  };
}

/* ---------------- 路由 ---------------- */
function parseBody(opt) {
  try { return opt && opt.body ? JSON.parse(opt.body) : {}; }
  catch (e) { return {}; }
}
async function request(url, opt) {
  await ensureInit();
  opt = opt || {};
  const method = String(opt.method || 'GET').toUpperCase();
  const u = new URL(url, location.href);
  let path = u.pathname.replace(/\/+$/, '') || '/';
  // file:///C:/... 下 new URL('/api/x', ...) 会变成 /C:/api/x，这里归一化
  const apiAt = path.lastIndexOf('/api/');
  if (apiAt >= 0) path = path.slice(apiAt);

  if (method === 'GET') {
    if (path === '/api/config') return { config: publicConfig(loadConfig()), version: VERSION, pure: true };
    if (path === '/api/manifest') return { manifest: FS.manifest };
    if (path === '/api/state') return { state: loadState() };
    if (path === '/api/memory') return { memory: loadMemory() };
    if (path === '/api/history') return { history: historyForApi(u.searchParams.get('channel') || 'offline') };
    if (path === '/api/export') return { ok: true, data: exportPayload() };
    if (path === '/api/ping') return { ok: true, version: VERSION, pure: true };
  }

  if (method === 'POST') {
    const body = parseBody(opt);
    if (path === '/api/chat') return chat(body);
    if (path === '/api/scene') return judgePovScene(body);
    if (path === '/api/state') {
      const old = loadState();
      const patch = body.state || body || {};
      if (patch.pov === 'char' || patch.pov === 'user') patch.pov = patch.pov; else delete patch.pov;
      // 视角切换只换当前画面，不能把另一边的地点也覆盖掉。
      if (patch.background && !body.keep_bg_slots) {
        if (patch.apart === true) patch[patch.pov === 'char' ? 'bg_char' : 'bg_user'] = patch.background;
        else { patch.bg_user = patch.background; patch.bg_char = patch.background; }
      }
      const next = saveState(patch);
      if (!body.silent && patch.background && patch.background !== old.background) addSceneEvent(patch.background, bgLabel(patch.background));
      return { state: next };
    }
    if (path === '/api/config') {
      const cfg = saveConfig(body.config || body);
      return { ok: true, config: publicConfig(cfg) };
    }
    if (path === '/api/config/test') {
      try {
        const cfg = tempConfig(body.config || body);
        const sample = await callModel(cfg, [
          { role: 'system', content: '你是一个连通性测试助手。' },
          { role: 'user', content: '只回复两个字：在的' },
        ], 45000);
        return { ok: true, sample: String(sample).slice(0, 200) };
      } catch (e) { return { ok: false, error: e.message || String(e) }; }
    }
    if (path === '/api/models') {
      try { return { ok: true, models: await listModels(tempConfig(body.config || body)) }; }
      catch (e) { return { ok: false, error: e.message || String(e) }; }
    }
    if (path === '/api/memory/update') {
      const ok = updateMemory(body.id, body.text);
      return { ok, error: ok ? undefined : '这条记忆不在了', memory: loadMemory() };
    }
    if (path === '/api/memory/delete') {
      const ok = deleteMemory(body.id);
      return { ok, error: ok ? undefined : '这条记忆不在了', memory: loadMemory() };
    }
    if (path === '/api/memory/clear') {
      clearMemory();
      writeRaw(HIST_KEY, { offline: [], online: [] });
      writeRaw(SUMMARY_KEY, { n: 0, t: stamp(false) });
      return { ok: true, memory: [] };
    }
    if (path === '/api/import') {
      try {
        importPayload(body.data || body);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message || String(e) }; }
    }
    if (path === '/api/history/clear') {
      const ch = u.searchParams.get('channel') === 'online' ? 'online' : 'offline';
      const h = loadHistory();
      h[ch] = [];
      writeRaw(HIST_KEY, h);
      return { ok: true, history: [] };
    }
    if (path === '/api/reset') { return { ok: true, state: resetState() }; }
    if (path === '/api/upload') return upload(body);
    if (path === '/api/touch') { if (!addTouch(body.kind)) return { ok: false, error: '未知动作' }; return { ok: true }; }
    if (path === '/api/summary/now') {
      try { const n = await summarizeRecent(loadConfig(), Number(body.turns || 20), 'offline'); return { ok: true, added: n }; }
      catch (e) { return { ok: false, error: e.message || String(e) }; }
    }
  }
  return { ok: false, error: '纯前端版没有这个接口：' + method + ' ' + path };
}

window.PureAPI = { request, ensureInit, version: VERSION, title: APP_TITLE };
})();
