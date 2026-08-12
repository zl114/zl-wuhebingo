// s2breath.js — 乌合bingo S2「大地的呼吸」屏息技能
// 规则：
//   1. 玩家在任意一轮答题时通过问卷中的「屏息」填空题指定自己的一个格子（A~Y 或 0~24）
//   2. 2回合后该格任务完成条件被永久削弱（requestRound + 2 = applyRound）
//   3. 削弱绑定「格子位置」而非任务本身（易位后仍作用于该位置）
//   4. 削弱规则：
//        - 总计/累计/获得N次/总分/排名分类   → 要求减半（向上取整）
//        - 连续类                          → 要求-1（下限1）
//        - 一次性任务                       → 按任务类型放宽（checkTasks 中依据 weakened 标记判定）
//   5. 每人每赛季最多2次（提交即占用次数）
// 用法:
//   node s2breath.js test   — 内置自测
var fs = require('fs');
var path = require('path');
var core = require('./core');

var QUOTA = 2;
var CELL_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXY';
var WEAK_FILE = path.join(__dirname, 's2weak.json');

// 特殊弱化表（一次性任务削弱版，可配置）: { taskId: { desc, check, goal? } }
function loadWeakTable() {
  try {
    if (fs.existsSync(WEAK_FILE)) {
      var t = JSON.parse(fs.readFileSync(WEAK_FILE, 'utf8'));
      var out = {};
      for (var k in t) if (t.hasOwnProperty(k) && !/^_/.test(k)) out[k] = t[k];
      return out;
    }
  } catch (e) {}
  return {};
}
var _weakCache = null;
function weakTable() {
  if (!_weakCache) _weakCache = loadWeakTable();
  return _weakCache;
}
function weakRule(taskId) { return weakTable()[taskId] || null; }

// 任务库原始模板（含 {x} 占位），用于渲染后 desc 的正确弱化计算
var TASK_LIB = null;
try { TASK_LIB = require('./任务库.json'); } catch (e) {}
function taskTemplate(taskId) {
  if (!TASK_LIB || !TASK_LIB.tasks) return null;
  for (var i = 0; i < TASK_LIB.tasks.length; i++) {
    if (TASK_LIB.tasks[i].id === taskId) return TASK_LIB.tasks[i];
  }
  return null;
}

function defaultState() {
  return { quota: QUOTA, players: {}, requests: [], applied: [] };
}

// 格号解析: A~Y / a~y / 0~24 → 0~24；无效返回 -1
function parseCellInput(input) {
  if (input == null) return -1;
  var s = String(input).trim().toUpperCase();
  if (!s) return -1;
  if (/^[A-Y]$/.test(s)) return s.charCodeAt(0) - 65;
  if (/^\d{1,2}$/.test(s)) {
    var n = parseInt(s, 10);
    return (n >= 0 && n <= 24) ? n : -1;
  }
  return -1;
}

// 削弱规则：返回 { goal, desc, kind, check }
//   kind: 'total'(减半) | 'streak'(连续-1) | 'single'(一次性)
//   一次性任务优先查特殊弱化表 s2weak.json（用户可配置 check 放宽类型）
function weakify(taskId, param, desc) {
  var d = desc || '';
  var p = (param == null ? 1 : param);
  var goal = null, kind = 'single', nd = d, check = null;

  // 特殊弱化表优先（一次性任务）
  var rule = weakRule(taskId);
  if (rule) {
    goal = (rule.goal != null ? rule.goal : null);
    check = rule.check || null;
    nd = rule.desc || d;
    if (goal != null) kind = 'total';
    return { goal: goal, desc: nd, kind: kind, check: check };
  }

  // 尝试用任务库原始模板（含 {x}），保证渲染后 desc 也能正确弱化（总计减半/连续-1）
  var tpl = taskTemplate(taskId);
  var srcD = (tpl && tpl.desc && tpl.desc.indexOf('{x}') >= 0) ? tpl.desc : d;

  if (srcD.indexOf('{x}') >= 0) {
    if (/连续\{x\}次/.test(srcD)) {
      kind = 'streak';
      goal = Math.max(1, p - 1);
    } else {
      kind = 'total';
      goal = Math.ceil(p / 2);
    }
    nd = srcD.replace(/\{x\}/g, String(goal));
  }
  return { goal: goal, desc: nd, kind: kind, check: check };
}

// 解析本轮屏息提交（在结算流程中调用）
// ranked: finalRanked（含 answers, name, absent）
// questions: 题目数组（含 HOLD/CASTLE 前导特殊题）
// 返回 { accepted: [...], rejected: [{name, reason}] }
function parseHoldAnswers(state, roundNum, ranked, questions) {
  var bh = state.breathHold || (state.breathHold = defaultState());
  if (!bh.players) bh.players = {};
  if (!bh.requests) bh.requests = [];
  var holdQi = -1;
  for (var qi = 0; qi < questions.length; qi++) {
    if (questions[qi] && questions[qi].id === 'HOLD') { holdQi = qi; break; }
  }
  var accepted = [], rejected = [];
  if (holdQi < 0) return { accepted: accepted, rejected: rejected };

  for (var i = 0; i < ranked.length; i++) {
    var p = ranked[i];
    if (p.absent) continue;
    var ans = p.answers && p.answers[holdQi];
    var val = ans && ans.value ? String(ans.value).trim() : '';
    if (!val) continue;
    var name = p.name;
    var cellIdx = parseCellInput(val);
    if (cellIdx < 0) { rejected.push({ name: name, reason: '无效格号: ' + val }); continue; }
    var used = (bh.players[name] && bh.players[name].used) || 0;
    if (used >= (bh.quota || QUOTA)) { rejected.push({ name: name, reason: '屏息次数已用完(每人每赛季' + (bh.quota || QUOTA) + '次)' }); continue; }
    var pBoard = state.playerBoards && state.playerBoards[name];
    if (!pBoard) { rejected.push({ name: name, reason: '无玩家数据' }); continue; }
    if (!pBoard[cellIdx]) { rejected.push({ name: name, reason: '格号越界' }); continue; }
    if (pBoard[cellIdx].completed) { rejected.push({ name: name, reason: CELL_LABELS[cellIdx] + '格已完成' }); continue; }
    // 通过 → 记录请求并占用次数
    if (!bh.players[name]) bh.players[name] = { used: 0 };
    bh.players[name].used += 1;
    bh.requests.push({
      player: name, cell: cellIdx, requestRound: roundNum,
      applyRound: roundNum + 2, status: 'pending'
    });
    accepted.push({ name: name, cell: cellIdx, applyRound: roundNum + 2 });
  }
  return { accepted: accepted, rejected: rejected };
}

// 应用到期削弱（applyRound == roundNum 的请求）
// 返回 [{player, cell, taskId, oldDesc, newDesc, goal}]
function applyDueWeakenings(state, roundNum) {
  var bh = state.breathHold;
  var out = [];
  if (!bh || !bh.requests) return out;
  var remain = [];
  for (var i = 0; i < bh.requests.length; i++) {
    var r = bh.requests[i];
    if (r.status === 'pending' && r.applyRound === roundNum) {
      var res = applyOne(state, r);
      if (res) {
        r.status = 'applied';
        r.appliedRound = roundNum;
        bh.applied = bh.applied || [];
        bh.applied.push(r);
        out.push(res);
        continue;
      }
      // 应用失败（格子已完成等）→ 仍消耗次数，记录 notice
      r.status = 'void';
      r.voidReason = '应用时格子已完成或无效';
      bh.applied = bh.applied || [];
      bh.applied.push(r);
      continue;
    }
    remain.push(r);
  }
  bh.requests = remain;
  return out;
}

function applyOne(state, r) {
  var name = r.player, cellIdx = r.cell;
  var pBoard = state.playerBoards && state.playerBoards[name];
  if (!pBoard || !pBoard[cellIdx]) return null;
  var taskCell = pBoard[cellIdx];
  if (taskCell.completed) return null;
  var board = state.board || [];
  var taskId = (state.playerTaskMap && state.playerTaskMap[name])
    ? state.playerTaskMap[name][cellIdx] : (board[cellIdx] ? board[cellIdx].id : null);
  var taskDef = null;
  for (var b = 0; b < board.length; b++) if (board[b].id === taskId) { taskDef = board[b]; break; }
  if (!taskDef && board[cellIdx]) taskDef = board[cellIdx];
  var desc = taskDef ? taskDef.desc : (taskCell.weakDesc || '');
  var param = taskDef ? taskDef.param : (taskCell.goal || 1);
  var w = weakify(taskId, param, desc);
  taskCell.weakened = true;
  taskCell.weakKind = w.kind;
  taskCell.weakCheck = w.check;
  taskCell.weakAppliedRound = r.applyRound;
  if (w.goal != null) taskCell.goal = w.goal;
  taskCell.weakDesc = '【屏息】' + w.desc;
  return { player: name, cell: cellIdx, taskId: taskId, oldDesc: desc, newDesc: w.desc, goal: w.goal };
}

// 查询玩家屏息状态
function query(state, playerName) {
  var bh = state.breathHold || defaultState();
  var pl = bh.players && bh.players[playerName];
  var used = (pl && pl.used) || 0;
  var pending = (bh.requests || []).filter(function (r) { return r.player === playerName && r.status === 'pending'; });
  var applied = (bh.applied || []).filter(function (r) { return r.player === playerName && r.status === 'applied'; });
  return {
    quota: bh.quota || QUOTA,
    used: used,
    remaining: (bh.quota || QUOTA) - used,
    pending: pending.map(function (r) { return { cell: r.cell, requestRound: r.requestRound, applyRound: r.applyRound }; }),
    applied: applied.map(function (r) { return { cell: r.cell, appliedRound: r.appliedRound }; })
  };
}

// ===== CLI =====
var args = process.argv.slice(2);
if (require.main === module) {
  if (args[0] === 'test') runTests();
  else if (args[0] === 'weak') {
    // node s2breath.js weak <taskId> [param]
    var taskId = args[1];
    var taskDefs = null;
    try { taskDefs = JSON.parse(fs.readFileSync(path.join(__dirname, '任务库.json'), 'utf8')); } catch (e) {}
    var def = taskDefs && taskDefs.tasks ? taskDefs.tasks.find(function (t) { return t.id === taskId; }) : null;
    if (!def) { console.log('未找到任务 ' + taskId); process.exit(1); }
    var param = args[2] != null ? parseInt(args[2], 10) : def.param;
    var w = weakify(taskId, param, def.desc);
    console.log(JSON.stringify({ id: taskId, desc: def.desc, param: param, weak: w }, null, 2));
  } else {
    console.log('用法:\n  node s2breath.js weak <taskId> [param]\n  node s2breath.js test');
  }
}

// ===== 自测 =====
function runTests() {
  var passed = 0, failed = 0;
  function eq(name, actual, expected) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (ok ? '' : '  got=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected)));
    ok ? passed++ : failed++;
  }

  // 格号解析
  eq('parse A', parseCellInput('A'), 0);
  eq('parse Y', parseCellInput('y'), 24);
  eq('parse 0', parseCellInput('0'), 0);
  eq('parse 24', parseCellInput('24'), 24);
  eq('parse 25 越界', parseCellInput('25'), -1);
  eq('parse Z 越界', parseCellInput('Z'), -1);
  eq('parse 空', parseCellInput('  '), -1);
  eq('parse 乱码', parseCellInput('abc'), -1);

  // weakify: 总计类（减半向上取整）
  eq('总计 6→3', weakify('A08', 6, '总计{x}次在T1选择得分最高的选项'), { goal: 3, desc: '总计3次在T1得到前3高的总分数', kind: 'total', check: null });
  eq('总计 7→4', weakify('A25', 7, '总计{x}次在T1选择得分最低的选项'), { goal: 4, desc: '总计4次在T1得到前3低的总分数', kind: 'total', check: null });
  eq('总分 100→50', weakify('A04', 100, '总分达到{x}分'), { goal: 50, desc: '任意连续3局排名分之和大于50', kind: 'total', check: null });
  // weakify: 连续类（-1）
  eq('连续 4→3', weakify('A06', 4, '连续{x}次排名1~6'), { goal: 3, desc: '连续3次排名1~6', kind: 'streak', check: null });
  eq('连续 2→1', weakify('A07', 2, '连续{x}次在T1选择得分最高的选项'), { goal: 1, desc: '连续1次在T1得到前3高的总分数', kind: 'streak', check: null });
  // weakify: 特殊弱化表（一次性任务）
  eq('B17 连续3次→2次', weakify('B17', null, '连续3次在除T10外某题获得最高的分数'), { goal: 2, desc: '连续2次在除T10外某题获得最高的分数', kind: 'total', check: 'streakGoal' });
  eq('B14 0~4全收集', weakify('B14', null, '在T6回答过0~9所有整数答案'), { goal: 5, desc: '在T6回答过0~4所有整数答案', kind: 'total', check: 'digits0to4' });
  eq('B02 一次性', weakify('B02', null, '在T1中独享过公正（仅你一人选择某个公正选项）'), { goal: null, desc: '在T1中选择公正选项且该选项总人数不超过2人（任意回合）', kind: 'single', check: 'justTop2' });
  eq('weakRule B20', weakRule('B20').check, 'singleTop6');
  eq('weakRule A08 无', weakRule('A08'), null);

  // 完整流程: parse → 到期应用
  var state = {
    board: [
      { id: 'A08', param: 6, desc: '总计{x}次在T1选择得分最高的选项' },
      { id: 'B02', param: null, desc: '在T1中独享过公正（仅你一人选择某个公正选项）' }
    ],
    playerBoards: { P1: [{ progress: 0, completed: false, goal: 6 }, { progress: 0, completed: false, goal: 1 }] },
    playerTaskMap: { P1: ['A08', 'B02'] },
    breathHold: defaultState()
  };
  var QUESTIONS = [{ id: 'HOLD', type: 'text' }, { id: 'T1', type: 'single' }];
  var ranked = [
    { name: 'P1', absent: false, answers: [{ value: 'A' }, { label: 'X' }] },
    { name: 'P2', absent: false, answers: [{ value: 'Z' }, { label: 'Y' }] }
  ];
  // R3 提交
  var res = parseHoldAnswers(state, 3, ranked, QUESTIONS);
  eq('接受 P1-A', res.accepted.length, 1);
  eq('接受格号', res.accepted[0].cell, 0);
  eq('拒绝 P2-Z', res.rejected[0].name, 'P2');
  eq('P1 used=1', state.breathHold.players.P1.used, 1);
  // R5 到期应用
  var applied = applyDueWeakenings(state, 4);
  eq('R4 未到期', applied.length, 0);
  var applied2 = applyDueWeakenings(state, 5);
  eq('R5 到期应用', applied2.length, 1);
  eq('A08 goal 6→3', state.playerBoards.P1[0].goal, 3);
  eq('weakened 标记', state.playerBoards.P1[0].weakened, true);
  eq('weakDesc', state.playerBoards.P1[0].weakDesc, '【屏息】总计3次在T1得到前3高的总分数');
  eq('requests 清空', state.breathHold.requests.length, 0);

  // 查询
  var q = query(state, 'P1');
  eq('剩余次数', q.remaining, 1);

  console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
  process.exit(failed > 0 ? 1 : 0);
}


// ===== 导出（供 settle.js 等模块集成） =====
module.exports = {
  defaultState: defaultState,
  parseCellInput: parseCellInput,
  weakify: weakify,
  weakRule: weakRule,
  parseHoldAnswers: parseHoldAnswers,
  applyDueWeakenings: applyDueWeakenings,
  applyOne: applyOne,
  query: query
};
