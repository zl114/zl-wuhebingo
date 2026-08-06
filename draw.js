// draw.js v2 — 乌合bingo 抽取程序 (zlwuhe格式)
// 用法:
//   node draw.js season <赛季名>         初始化赛季
//   node draw.js round <赛季名> <回合号>   抽题
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
  const pool = (bank.questions || []).filter(q => q.enabled !== false);
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
function genQuestionnaireText(questions) {
  const TYPE_MAP = { single: '单选题', multi: '多选题', text: '单行文本题' };
  const lines = [];
  lines.push('乌合bingo 回合问卷');
  lines.push('');

  let qnum = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const typeName = TYPE_MAP[q.type] || '单选题';
    const desc = q.desc ? '(' + q.desc + ')' : '';
    if (q.id === 'CASTLE') {
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
    currentRound: 0,
    finished: false,
    winner: null
  };

  // 生成赛季配置
  const config = {
    castling: true,       // 易位机制
    winCheck: true,       // 获胜检测
    speedUp: true,        // 5人加速
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
  if (fs.existsSync(stateFile) && fs.existsSync(configFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (config.castling !== false && state.castling && state.castling.triggered) {
      questions.unshift({
        id: 'CASTLE',
        type: 'text',
        text: '易位',
        desc: '可选项，输入一个字母A~Y指定要使用易位的格子',
        options: [],
        minFill: 0, maxFill: 1,
        formula: '0'
      });
      console.log('  [castling] 易位题已加入 (机制已触发)');
    }
  }

  fs.writeFileSync(path.join(roundDir, 'questions.json'), JSON.stringify(questions, null, 2), 'utf8');

  const qText = genQuestionnaireText(questions);
  fs.writeFileSync(path.join(roundDir, '问卷.txt'), qText, 'utf8');

  console.log('回合 ' + roundNum + ' 抽题完成, ' + questions.length + '题');
  questions.forEach(q => console.log('  [' + (q.type || '?') + '] ' + (q.text || q.title)));
}

// ===== CLI =====
const args = process.argv.slice(2);
if (args[0] === 'season') initSeason(args[1]);
else if (args[0] === 'round') drawNewRound(args[1], parseInt(args[2]) || 1);
else console.log('用法:\n  node draw.js season <赛季名>\n  node draw.js round <赛季名> <回合号>');
