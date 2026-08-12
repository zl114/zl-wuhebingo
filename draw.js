// draw.js v2 — 乌合bingo 抽取程序 (zlwuhe格式)
// 用法:
//   node draw.js season <赛季名>                    初始化赛季
//   node draw.js round <赛季名> <回合号>             抽题
//   node draw.js restore <赛季名> <回合号>           从seq恢复
//   node draw.js seq <赛季名> <回合号> <类型序列>     按指定类型序列抽题
// 题库: 题库.json (JSON格式，含t1Pools和questions数组)

const fs = require('fs');
const path = require('path');
const core = require('./core');

const QUESTION_BANK = path.join(__dirname, '题库.json');
const TYPE_DIST = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'];

// ===== 加载题库 =====
function loadBank() {
  const text = fs.readFileSync(QUESTION_BANK, 'utf8');
  return core.parseJSON(text);
}

// ===== 抽题 =====
function drawRound(bank) {
  const questions = [];
  const pool = (bank.questions || []).filter(q => q.enabled !== false && !q.test);
  const picked = new Set(); // 去重: 已选题目id

  for (const t of TYPE_DIST) {
    if (t === 'T1') {
      questions.push(core.composeT1(bank));
    } else if (t === 'T10') {
      const t10 = pool.find(q => q.id === 'T10' || q.id.toUpperCase().startsWith('T10'));
      if (t10) questions.push({ ...t10 });
    } else if (t === 'T5') {
      const candidates = pool.filter(q => q.type === 'single' && q.id !== 'T10' && !picked.has(q.id));
      if (candidates.length) {
        const q = candidates[Math.floor(Math.random() * candidates.length)];
        picked.add(q.id);
        questions.push({ ...q, id: 'T5' });
      }
    } else if (t === 'T2') {
      const candidates = pool.filter(q => q.type === 'single' && q.options.length === 3 && !picked.has(q.id));
      if (candidates.length) {
        const q = candidates[Math.floor(Math.random() * candidates.length)];
        picked.add(q.id);
        questions.push({ ...q, id: 'T2' });
      }
    } else if (t === 'T3') {
      const candidates = pool.filter(q => q.type === 'single' && q.options.length === 4 && !picked.has(q.id));
      if (candidates.length) {
        const q = candidates[Math.floor(Math.random() * candidates.length)];
        picked.add(q.id);
        questions.push({ ...q, id: 'T3' });
      }
    } else if (t === 'T4') {
      const candidates = pool.filter(q => q.type === 'single' && q.options.length === 5 && !picked.has(q.id));
      if (candidates.length) {
        const q = candidates[Math.floor(Math.random() * candidates.length)];
        picked.add(q.id);
        questions.push({ ...q, id: 'T4' });
      }
    } else if (t === 'T6') {
      const candidates = pool.filter(q => q.type === 'text' && !picked.has(q.id));
      if (candidates.length) {
        const q = candidates[Math.floor(Math.random() * candidates.length)];
        picked.add(q.id);
        questions.push({ ...q, id: 'T6' });
      }
    } else if (t === 'T7') {
      const candidates = pool.filter(q => q.type === 'multi' && q.options.length >= 3 && q.options.length <= 6 && !picked.has(q.id));
      if (candidates.length) {
        const q = candidates[Math.floor(Math.random() * candidates.length)];
        picked.add(q.id);
        questions.push({ ...q, id: 'T7' });
      }
    } else if (t === 'T8') {
      const candidates = pool.filter(q => q.type === 'multi' && q.options.length >= 5 && q.options.length <= 7 && !picked.has(q.id));
      if (candidates.length) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        picked.add(pick.id);
        questions.push({ ...pick, id: 'T8' });
      }
    } else if (t === 'T9') {
      const candidates = pool.filter(q => q.type === 'multi' && !picked.has(q.id));
      if (candidates.length) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        picked.add(pick.id);
        questions.push({ ...pick, id: 'T9' });
      }
    }
  }
  // 检查完整性
  if (questions.length < 10) console.log('  警告: 仅抽到 ' + questions.length + '/10 题, 部分类型题库不足');
  return questions;
}

// ===== 生成问卷文本 (腾讯问卷DSL格式) =====
var EVENT_CN = {
  wisdom: '智慧之息：选最少选项者该题+2',
  unity: '团结之息：选最多者+2',
  caution: '谨慎之息：被超半数选择的选项，选了-1',
  thursday: '周四之息：每题-0.5',
  blaze: '灼热之息：正分题×1.2',
  frost: '寒冰之息：负分题×1.2',
  mirror: '对称之息：得分取绝对值',
  invert: '颠倒之息：得分×-1',
  flora: '草木之息：每题最低分者拉平到最高分者',
  void: '归零之息：某题恰好0分则+7'
};

function genQuestionnaireText(questions, state, seasonName, roundNum) {
  const TYPE_MAP = { single: '单选题', multi: '多选题', text: '单行文本题' };
  const lines = [];
  lines.push('乌合bingo ' + (seasonName || '') + '-' + (roundNum || '?') + '问卷');
  lines.push('');

  // 任务版
  if (state && state.board && state.board.length > 0) {
    lines.push((seasonName || '') + '任务版\\');
    const CL2 = 'ABCDEFGHIJKLMNOPQRSTUVWXY';
    for (let i = 0; i < state.board.length; i++) {
      lines.push('[' + CL2[i] + ']' + (state.board[i].desc || '') + '\\');
    }
    lines.push('\\');
    const hasEventBlk = state && state.events && state.events.active && state.events.active.length > 0;
    if (!hasEventBlk) lines.push('');
  }

  // 生效事件（下一轮，带描述）
  if (state && state.events && state.events.active && state.events.active.length > 0) {
    lines.push('下一轮生效事件: \\');
    for (let ei = 0; ei < state.events.active.length; ei++) {
      lines.push((EVENT_CN[state.events.active[ei]] || state.events.active[ei]) + '\\');
    }
    lines.push('');
  }

  let qnum = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const typeName = TYPE_MAP[q.type] || '单选题';
    const desc = q.desc ? '(' + q.desc + ')' : '';
    if (q.id === 'CASTLE' || q.id === 'HOLD') {
      lines.push((q.text || q.title) + '[' + typeName + ']' + desc);
    } else {
      qnum++;
      lines.push(qnum + '. ' + (q.text || q.title) + '[' + typeName + ']' + desc);
    }

    if (q.type === 'single' || q.type === 'multi') {
      for (const opt of q.options) {
        lines.push(opt.text);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ===== 赛季初始化 =====
// ===== S2 判断（与 settle.js 规则一致） =====
function isS2Season(state, seasonName) {
  var sn = String((state && state.season) || seasonName || '');
  return /s2/i.test(sn) && !/s2\d/i.test(sn);
}

// 在题目开头插入屏息 HOLD 题（S2 且 config.breathHold !== false）
function addHoldQuestion(state, config, questions) {
  if (!isS2Season(state, null)) return false;
  if (config && config.breathHold === false) return false;
  if (!state.breathHold) state.breathHold = { quota: 2, players: {}, requests: [], applied: [] };
  questions.unshift({
    id: 'HOLD', type: 'text', text: '屏息',
    desc: '输入你想屏息指定的格A~Y。2回合后该格任务条件永久削弱。每人每赛季最多2次，不填则本回合不使用。',
    options: [], minFill: 0, maxFill: 1, formula: '0'
  });
  console.log('  [S2屏息] 屏息题已加入');
  return true;
}

function initSeason(seasonName) {
  const seasonDir = path.join(__dirname, seasonName);
  core.ensureDir(seasonDir);

  const taskFile = path.join(__dirname, '任务库.json');
  const allTasks = core.loadTasks(taskFile);
  const listA = allTasks.filter(t => t.list === 'A');
  const listB = allTasks.filter(t => t.list === 'B');

  const aPicked = listA.sort(() => Math.random() - 0.5).slice(0, 10);
  const remaining = [...listA.filter(t => !aPicked.includes(t)), ...listB].sort(() => Math.random() - 0.5);
  const restPicked = remaining.slice(0, 15);
  const allPicked = [...aPicked, ...restPicked].sort(() => Math.random() - 0.5);

  const board = [];
  for (let i = 0; i < 25; i++) {
    const def = allPicked[i];
    const param = core.generateTaskParam(def);
    board.push({ id: def.id, desc: core.taskDisplay(def, param), param });
  }

  const state = {
    season: seasonName,
    board,
    playerBoards: {},
    history: [],
    castling: { triggered: false, triggeredBy: null, triggerRound: null, speedUp: false, players: {}, log: [] },
    events: { active: [], history: [] },
    breathHold: { quota: 2, players: {}, requests: [], applied: [] },
    currentRound: 0,
    finished: false,
    winner: null
  };

  // 生成赛季配置
  const config = {
    castling: !isS2Season(state, seasonName),  // S2 无易位（易位为 S1 遗留机制）
    winCheck: true,       // 获胜检测
    speedUp: true,        // 5人加速
    events: true,         // S2 封印之息事件（false 可禁用）
    breathHold: true,     // S2 屏息技能（false 可禁用）
    playerCount: 12       // 预期人数(仅记录, 不影响结算)
  };
  fs.writeFileSync(path.join(seasonDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');

  fs.writeFileSync(path.join(seasonDir, 'state.json'), JSON.stringify(state, null, 2), 'utf8');

  let boardText = '赛季 ' + seasonName + ' 任务板\n';
  boardText += '='.repeat(60) + '\n';
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const t = board[r * 5 + c];
      boardText += '[' + String.fromCharCode(65 + r * 5 + c) + '] ' + t.desc + '\n';
    }
  }
  fs.writeFileSync(path.join(seasonDir, '任务板.txt'), boardText, 'utf8');

  console.log('赛季 ' + seasonName + ' 初始化完成');
  console.log('任务: A列' + aPicked.length + '个 + 其余' + restPicked.length + '个, 共25格');
  console.log(boardText);
}

// ===== 回合抽题 =====
function drawNewRound(seasonName, roundNum) {
  const seasonDir = path.join(__dirname, seasonName);
  if (!fs.existsSync(seasonDir)) { console.log('赛季目录不存在, 请先初始化: node draw.js season ' + seasonName); return; }

  const roundDir = path.join(seasonDir, 'round_' + roundNum);
  core.ensureDir(roundDir);

  // 安全检查: 已有题目时备份并警告
  var qFile = path.join(roundDir, 'questions.json');
  if (fs.existsSync(qFile)) {
    try { fs.copyFileSync(qFile, qFile + '.bak'); } catch(e) {}
    console.log('⚠️ 该回合已有题目, 已备份到 questions.json.bak');
    console.log('   正在进行覆盖抽题...');
  }

  const bank = loadBank();
  const questions = drawRound(bank);

  // 易位题：如果机制启用且已触发，在开头加入填空题
  const stateFile = path.join(seasonDir, 'state.json');
  const configFile = path.join(seasonDir, 'config.json');
  var state = null, config = null;
  if (fs.existsSync(stateFile) && fs.existsSync(configFile)) {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (config.castling !== false && state.castling && state.castling.triggered) {
      questions.unshift({
        id: 'CASTLE',
        type: 'text',
        text: '易位',
        desc: '输入你想使用的易位格子上的字母。例如你看到格子上写着A，输入A即可',
        options: [],
        minFill: 0, maxFill: 1,
        formula: '0'
      });
      console.log('  [castling] 易位题已加入 (机制已触发)');
    }
  }
  // 屏息题（S2 且 config.breathHold !== false），在开头加入
  if (state && config) addHoldQuestion(state, config, questions);

  fs.writeFileSync(path.join(roundDir, 'questions.json'), JSON.stringify(questions, null, 2), 'utf8');
  // 保存题目序列以便恢复
  var seqQuestions = questions.filter(function(q) { return q.id !== 'CASTLE'; });
  fs.writeFileSync(path.join(roundDir, 'questions_seq.json'), JSON.stringify(seqQuestions, null, 2), 'utf8');

  const qText = genQuestionnaireText(questions, state, seasonName, roundNum);
  fs.writeFileSync(path.join(roundDir, '问卷.txt'), qText, 'utf8');

  console.log('回合 ' + roundNum + ' 抽题完成, ' + questions.length + '题');
  questions.forEach(q => console.log('  [' + (q.type || '?') + '] ' + (q.text || q.title)));
}

// ===== 从seq恢复 =====
function restoreRound(seasonName, roundNum) {
  const roundDir = path.join(__dirname, seasonName, 'round_' + roundNum);
  var seqFile = path.join(roundDir, 'questions_seq.json');
  if (!fs.existsSync(seqFile)) { console.log('无seq文件: ' + seqFile); return; }

  console.log('从 ' + seqFile + ' 恢复题目...');
  var seqQuestions = JSON.parse(fs.readFileSync(seqFile, 'utf8'));
  if (!Array.isArray(seqQuestions)) { console.log('seq格式错误'); return; }

  // 安全检查: 覆盖前备份
  var qFile = path.join(roundDir, 'questions.json');
  if (fs.existsSync(qFile)) {
    try { fs.copyFileSync(qFile, qFile + '.bak'); } catch(e) {}
    console.log('  已备份原 questions.json -> .bak');
  }

  // 添加CASTLE题(如果需要)
  var questions = seqQuestions.slice();
  const stateFile = path.join(__dirname, seasonName, 'state.json');
  const configFile = path.join(__dirname, seasonName, 'config.json');
  var state = null, config = null;
  if (fs.existsSync(stateFile) && fs.existsSync(configFile)) {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (config.castling !== false && state.castling && state.castling.triggered) {
      questions.unshift({
        id: 'CASTLE', type: 'text', text: '易位',
        desc: '输入你想使用的易位格子上的字母。例如你看到格子上写着A，输入A即可',
        options: [], minFill: 0, maxFill: 1, formula: '0'
      });
      console.log('  [castling] 易位题已加入');
    }
  }
  // 屏息题（S2 且 config.breathHold !== false），在开头加入
  if (state && config) addHoldQuestion(state, config, questions);

  fs.writeFileSync(qFile, JSON.stringify(questions, null, 2), 'utf8');
  console.log('恢复完成, ' + questions.length + '题');
  questions.forEach(q => console.log('  [' + (q.type || '?') + '] ' + (q.text || q.title)));
}

// ===== 按指定类型序列抽题 =====
function drawSeqRound(seasonName, roundNum, typeSeq) {
  const roundDir = path.join(__dirname, seasonName, 'round_' + roundNum);
  core.ensureDir(roundDir);

  var qFile = path.join(roundDir, 'questions.json');
  if (fs.existsSync(qFile)) {
    try { fs.copyFileSync(qFile, qFile + '.bak'); } catch(e) {}
    console.log('⚠️ 该回合已有题目, 已备份到 questions.json.bak');
  }

  const bank = loadBank();
  const pool = (bank.questions || []).filter(q => q.enabled !== false && !q.test);
  const questions = [];
  const picked = new Set();

  // 类型序列格式: "T1,T2:石头剪刀布,T3:平分博弈,..."
  // T1自动生成, T10固定, 其他按指定ID从题库取
  var typeMap = {};
  typeSeq.split(',').forEach(function(item) {
    var parts = item.trim().split(':');
    if (parts.length >= 2) typeMap[parts[0].trim()] = parts.slice(1).join(':').trim();
  });

  for (var ti = 0; ti < TYPE_DIST.length; ti++) {
    var t = TYPE_DIST[ti];
    if (t === 'T1') {
      questions.push(core.composeT1(bank));
    } else if (t === 'T10') {
      var t10 = pool.find(function(q) { return q.id === 'T10' || q.id.toUpperCase().startsWith('T10'); });
      if (t10) questions.push({ ...t10 });
    } else if (typeMap[t]) {
      var targetId = typeMap[t];
      var found = pool.find(function(q) { return q.id === targetId || q.text === targetId || q.title === targetId; });
      if (found) {
        picked.add(found.id);
        questions.push({ ...found, id: t });
        console.log('  [' + t + '] 已指定: ' + (found.text || found.title || found.id));
      } else {
        console.log('  [' + t + '] 未找到指定类型: ' + targetId + ', 将随机抽取');
        // fallback to random
        var candidates = pool.filter(function(q) { return !picked.has(q.id); });
        if (candidates.length) {
          var q = candidates[Math.floor(Math.random() * candidates.length)];
          picked.add(q.id);
          questions.push({ ...q, id: t });
        }
      }
    } else {
      console.log('  [' + t + '] 未指定, 将随机抽取');
      var candidates = pool.filter(function(q) { return !picked.has(q.id); });
      if (candidates.length) {
        var q = candidates[Math.floor(Math.random() * candidates.length)];
        picked.add(q.id);
        questions.push({ ...q, id: t });
      }
    }
  }

  // 检查完整性
  if (questions.length < TYPE_DIST.length) console.log('  警告: 仅抽到 ' + questions.length + '/' + TYPE_DIST.length + ' 题');

  // 易位题
  const stateFile = path.join(__dirname, seasonName, 'state.json');
  const configFile = path.join(__dirname, seasonName, 'config.json');
  var state = null, config = null;
  if (fs.existsSync(stateFile) && fs.existsSync(configFile)) {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (config.castling !== false && state.castling && state.castling.triggered) {
      questions.unshift({
        id: 'CASTLE', type: 'text', text: '易位',
        desc: '输入你想使用的易位格子上的字母。例如你看到格子上写着A，输入A即可',
        options: [], minFill: 0, maxFill: 1, formula: '0'
      });
      console.log('  [castling] 易位题已加入');
    }
  }
  // 屏息题（S2 且 config.breathHold !== false），在开头加入
  if (state && config) addHoldQuestion(state, config, questions);

  fs.writeFileSync(qFile, JSON.stringify(questions, null, 2), 'utf8');
  var seqQuestions = questions.filter(function(q) { return q.id !== 'CASTLE'; });
  fs.writeFileSync(path.join(roundDir, 'questions_seq.json'), JSON.stringify(seqQuestions, null, 2), 'utf8');

  const qText = genQuestionnaireText(questions, state, seasonName, roundNum);
  fs.writeFileSync(path.join(roundDir, '问卷.txt'), qText, 'utf8');

  console.log('回合 ' + roundNum + ' 抽题完成, ' + questions.length + '题');
  questions.forEach(q => console.log('  [' + (q.type || '?') + '] ' + (q.text || q.title)));
}

// ===== CLI =====
var args = process.argv.slice(2);
if (args[0] === 'season') initSeason(args[1]);
else if (args[0] === 'round') drawNewRound(args[1], parseInt(args[2]) || 1);
else if (args[0] === 'restore') restoreRound(args[1], parseInt(args[2]) || 1);
else if (args[0] === 'seq') drawSeqRound(args[1], parseInt(args[2]) || 1, args[3] || '');
else console.log('用法:\n  node draw.js season <赛季名>\n  node draw.js round <赛季名> <回合号>\n  node draw.js restore <赛季名> <回合号>\n  node draw.js seq <赛季名> <回合号> <类型序列>');
