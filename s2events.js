// s2events.js — 乌合bingo S2「大地的呼吸」封印之息事件系统
// 职责：
//   1. applyEvents(): 结算时按优先级应用本轮生效事件到每题得分
//   2. drawEvents(): 结算后为下一回合抽取事件（喷涌回合抽3，其余抽1，R3起）
//   3. CLI: node s2events.js draw <roundNum> [seasonDir]  — 手动抽取/写入state
//          node s2events.js test                        — 内置自测
var fs = require('fs');
var path = require('path');

// ===== 事件定义（优先级从上至下结算） =====
var EVENT_ORDER = [
  'illusion', // 0 镜花水月：该题虚化玩家视作0.1人（防0爆掉）
  'triple',   // 0.5 对影成三：该题实化玩家视作3人
  'wisdom',   // 1 智慧之息
  'unity',    // 2 团结之息
  'caution',  // 3 谨慎之息
  'thursday', // 4 周四之息
  'blaze',    // 5 灼热之息
  'frost',    // 6 寒冰之息
  'mirror',   // 7 对称之息
  'invert',   // 8 颠倒之息
  'flora',    // 9 草木之息
  'void'      // 10 归零之息
];

var EVENT_NAMES = {
  illusion: '镜花水月', triple: '对影成三',
  wisdom: '智慧之息', unity: '团结之息', caution: '谨慎之息', thursday: '周四之息',
  blaze: '灼热之息', frost: '寒冰之息', mirror: '对称之息', invert: '颠倒之息',
  flora: '草木之息', void: '归零之息'
};

// 喷涌回合（S3）：R3 起每 3 回合一次 → 3, 6, 9, 12, ...
function isSurge(roundNum) {
  return roundNum >= 3 && roundNum % 3 === 0;
}

// 为 roundNum 回合抽取事件（不放回）：
//   roundNum < 3  → 不抽（第3回合起才有事件，生效从R4开始？见 settle.js 集成说明）
//   喷涌回合      → 3 个
//   其余          → 1 个
function drawEvents(roundNum, exclude) {
  if (roundNum < 1) return [];  // S3：R1 起事件生效
  var k = isSurge(roundNum) ? 3 : 1;
  var pool = EVENT_ORDER.slice();
  // 冷却保险: 最近2回合已抽取的事件不再出现
  if (exclude && exclude.length > 0) {
    pool = pool.filter(function(e) { return exclude.indexOf(e) < 0; });
  }
  if (pool.length < k) pool = EVENT_ORDER.slice();  // 保底: 池不足时放宽
  var out = [];
  for (var i = 0; i < k && pool.length > 0; i++) {
    var idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

// ===== 每题事件应用 =====

// 玩家在第 qi 题选中的选项 label 列表（单选1个、多选多个、填空返回[]——选项类事件对填空不生效）
function chosenLabels(player, qi) {
  var ans = player.answers && player.answers[qi];
  if (!ans) return [];
  if (ans.labels && ans.labels.length > 0) return ans.labels.slice();
  if (ans.label) return [ans.label];
  return [];
}

function minPositiveCount(counts) {
  var m = null;
  for (var k in counts) {
    if (counts[k] > 0 && (m === null || counts[k] < m)) m = counts[k];
  }
  return m;
}

function maxCount(counts) {
  var m = 0;
  for (var k in counts) if (counts[k] > m) m = counts[k];
  return m;
}

// 玩家所选任一选项的人数 == target 则触发
function chosenAnyAt(players, i, qi, counts, target) {
  var labels = chosenLabels(players[i], qi);
  for (var c = 0; c < labels.length; c++) {
    if ((counts[labels[c]] || 0) === target) return true;
  }
  return false;
}

// 对第 qi 题应用单个事件到 scores[]（与 players 一一对应）
function applyEventToQuestion(ev, q, qStats, players, qi, scores) {
  var counts = (qStats && qStats.counts) || {};
  var isOptionQ = q.type === 'single' || q.type === 'multi';
  var i, chos, c;
  switch (ev) {
    case 'illusion': // 镜花水月：该题虚化玩家(weight<1)视作0.25人参与（防0爆掉）
      if (!isOptionQ) break;
      for (i = 0; i < players.length; i++) {
        var _w1 = players[i].weight || 1;
        if (_w1 < 1) {
          var _l1 = chosenLabels(players[i], qi);
          for (var _j1 = 0; _j1 < _l1.length; _j1++) {
            if (counts[_l1[_j1]] !== undefined) counts[_l1[_j1]] = counts[_l1[_j1]] - _w1 + 0.25;
          }
        }
      }
      break;
    case 'triple': // 对影成三：该题实化玩家(weight>1)视作3人参与
      if (!isOptionQ) break;
      for (i = 0; i < players.length; i++) {
        var _w3 = players[i].weight || 1;
        if (_w3 > 1) {
          var _l3 = chosenLabels(players[i], qi);
          for (var _j3 = 0; _j3 < _l3.length; _j3++) {
            if (counts[_l3[_j3]] !== undefined) counts[_l3[_j3]] = counts[_l3[_j3]] - _w3 + 3;
          }
        }
      }
      break;
    case 'wisdom': // 智慧之息：选中人数最少选项之一 → 该题+2；填空按答案人数（1 1 2 3 → 填2和3的+2）
      if (q.type === 'single' || q.type === 'multi') {
        var minC = minPositiveCount(counts);
        if (minC === null) break;
        for (i = 0; i < players.length; i++) {
          if (chosenAnyAt(players, i, qi, counts, minC)) scores[i] += 2;
        }
      } else if (q.type === 'text') {
        var minT = minPositiveCount(counts);
        if (minT === null) break;
        for (i = 0; i < players.length; i++) {
          var _a = players[i].answers && players[i].answers[qi];
          var _v = (_a && _a.value !== undefined && _a.value !== null) ? String(_a.value).trim() : '';
          if (_v !== '' && (counts[_v] || 0) === minT) scores[i] += 2;
        }
      }
      break;
    case 'unity': // 团结之息：选中人数最多选项之一 → 该题+2
      if (!isOptionQ) break;
      var maxC = maxCount(counts);
      if (maxC <= 0) break;
      for (i = 0; i < players.length; i++) {
        if (chosenAnyAt(players, i, qi, counts, maxC)) scores[i] += 2;
      }
      break;
    case 'caution': // 谨慎之息：选中被超过半数选择的选项 → 该题-1（单选>6，多选>9）
      if (!isOptionQ) break;
      var threshold = q.type === 'multi' ? 9 : 6;
      for (i = 0; i < players.length; i++) {
        chos = chosenLabels(players[i], qi);
        for (c = 0; c < chos.length; c++) {
          if ((counts[chos[c]] || 0) > threshold) { scores[i] -= 1; break; }
        }
      }
      break;
    case 'thursday': // 周四之息：每题-0.5
      for (i = 0; i < players.length; i++) scores[i] -= 0.5;
      break;
    case 'blaze': // 灼热之息：正分题×1.2
      for (i = 0; i < players.length; i++) if (scores[i] > 0) scores[i] *= 1.2;
      break;
    case 'frost': // 寒冰之息：负分题×1.2
      for (i = 0; i < players.length; i++) if (scores[i] < 0) scores[i] *= 1.2;
      break;
    case 'mirror': // 对称之息：得分取绝对值
      for (i = 0; i < players.length; i++) scores[i] = Math.abs(scores[i]);
      break;
    case 'invert': // 颠倒之息：得分×-1
      for (i = 0; i < players.length; i++) scores[i] = -scores[i];
      break;
    case 'flora': // 草木之息：该题最低分者拉到与最高分相同（并列最低全部）
      var mx = Math.max.apply(null, scores);
      var mn = Math.min.apply(null, scores);
      if (mx !== mn) {
        for (i = 0; i < scores.length; i++) if (scores[i] === mn) scores[i] = mx;
      }
      break;
    case 'void': // 归零之息：该题得分恰好0 → +7（容差判定，浮点±0也算）
      for (i = 0; i < scores.length; i++) if (Math.abs(scores[i]) < 1e-9) scores[i] = 7;
      break;
  }
}

// 应用一组事件到全员得分（每题独立，按优先级依次结算）
// ranked: [{name, answers, qScores, totalScore, rank, absent?}]
// questions: 题目数组（含CASTLE则 qOffset=1）
// events: 生效事件id数组
// stats: core.scoreAllQuestions 的 stats（每题 counts）
// 返回 { ranked: 修正+重排后的数组, logs: [{event, qi, detail}] }
function applyEvents(ranked, questions, qOffset, events, stats) {
  var present = ranked.filter(function(r) { return !r.absent; });
  if (present.length === 0) return { ranked: ranked, logs: [] };
  var effective = (events || []).filter(function(e) { return EVENT_ORDER.indexOf(e) >= 0; });
  if (effective.length === 0) return { ranked: ranked, logs: [] };

  // 按优先级排序（EVENT_ORDER 已有序，直接按索引排）
  effective = effective.slice().sort(function(a, b) {
    return EVENT_ORDER.indexOf(a) - EVENT_ORDER.indexOf(b);
  });

  for (var qi = qOffset; qi < questions.length; qi++) {
    var q = questions[qi];
    if (!q) continue;
    var qStats = (stats && stats[qi]) || { counts: {} };
    var scores = present.map(function(p) { return p.qScores[qi] || 0; });
    for (var ei = 0; ei < effective.length; ei++) {
      applyEventToQuestion(effective[ei], q, qStats, present, qi, scores);
    }
    for (var pi = 0; pi < present.length; pi++) {
      present[pi].qScores[qi] = Math.round(scores[pi] * 100) / 100; // 保留2位小数
    }
  }

  // 重算总分并重排（并列同分同排名）
  present.forEach(function(p) {
    p.totalScore = 0;
    for (var i = 0; i < p.qScores.length; i++) p.totalScore += (p.qScores[i] || 0);
  });
  present.sort(function(a, b) { return b.totalScore - a.totalScore; });
  for (var ri = 0; ri < present.length; ri++) {
    if (ri > 0 && Math.round(present[ri].totalScore * 100) === Math.round(present[ri - 1].totalScore * 100)) {
      present[ri].rank = present[ri - 1].rank;
    } else {
      present[ri].rank = ri + 1;
    }
  }
  var result = present.concat(ranked.filter(function(r) { return r.absent; }));
  return { ranked: result, logs: [] };
}

// ===== CLI =====
var args = process.argv.slice(2);

if (require.main === module) {
if (args[0] === 'draw') {
  // node s2events.js draw <roundNum> [seasonDir]
  var rn = parseInt(args[1]) || 0;
  var seasonDir = args[2] || path.join(__dirname, 'rS1');
  var statePath = path.join(seasonDir, 'state.json');
  var state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (!state.events) state.events = { active: [], history: [] };
  // 存档旧 active
  if (state.events.active && state.events.active.length > 0) {
    state.events.history = state.events.history || [];
    state.events.history.push({ round: state.currentRound || rn - 1, events: state.events.active.slice() });
  }
    var recentExcl = [];
  var evHist2 = state.events.history || [];
  for (var ehx2 = evHist2.length - 1; ehx2 >= 0 && recentExcl.length < 2; ehx2--) {
    var evsx2 = evHist2[ehx2].events || [];
    for (var evix2 = 0; evix2 < evsx2.length && recentExcl.length < 2; evix2++) {
      recentExcl.push(evsx2[evix2]);
    }
  }
  var drawn = drawEvents(rn, recentExcl);
  state.events.active = drawn;
  fs.writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2), 'utf8');
  try { fs.renameSync(statePath + '.tmp', statePath); } catch (e) { fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8'); }
  console.log('为 R' + rn + ' 抽取事件' + (isSurge(rn) ? ' (气息喷涌×3)' : '') + ':');
  drawn.forEach(function(e) { console.log('  - ' + EVENT_NAMES[e] + ' (' + e + ')'); });
  if (drawn.length === 0) console.log('  (无事件: R' + rn + ' < 3 或抽取为空)');
  console.log('已写入: ' + statePath);
} else if (args[0] === 'test') {
  runTests();
} else {
  console.log('用法:');
  console.log('  node s2events.js draw <roundNum> [seasonDir]');
  console.log('  node s2events.js test');
}
}

// ===== 自测 =====
function runTests() {
  var passed = 0, failed = 0;
  function near(a, b) { return Math.abs(a - b) < 1e-6; }
  function eqArr(name, actual, expected) {
    var ok = Array.isArray(actual) && actual.length === expected.length &&
      actual.every(function(v, i) { return near(v, expected[i]); });
    console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (ok ? '' : '  got=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected)));
    ok ? passed++ : failed++;
  }
  function eq(name, actual, expected) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (ok ? '' : '  got=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected)));
    ok ? passed++ : failed++;
  }
  // 把 ranked 转为 {name: qScores} 便于断言（无视重排顺序）
  function byName(ranked) {
    var m = {};
    ranked.forEach(function(p) { m[p.name] = p.qScores; });
    return m;
  }

  // --- 喷涌判定 ---
  eq('surge R4', isSurge(4), false);
  eq('surge R5', isSurge(5), true);
  eq('surge R8', isSurge(8), true);
  eq('surge R11', isSurge(11), true);
  eq('surge R14', isSurge(14), true);
  eq('surge R17', isSurge(17), true);
  eq('surge R13', isSurge(13), false);

  // --- 抽取 ---
  eq('draw R2 无事件', drawEvents(2), []);
  eq('draw R3 抽1', drawEvents(3).length, 1);
  eq('draw R5 喷涌抽3', drawEvents(5).length, 3);
  eq('draw R5 不重复', new Set(drawEvents(5)).size, 3);
  eq('draw R14 喷涌抽3', drawEvents(14).length, 3);

  // --- 模拟数据工厂：3人2题（q0单选 A/B/C, q1多选 A/B）---
  var QUESTIONS = [
    { id: 'T1', type: 'single', options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] },
    { id: 'T2', type: 'multi', options: [{ label: 'A' }, { label: 'B' }] }
  ];
  var STATS = [
    { counts: { A: 2, B: 1, C: 0 } },
    { counts: { A: 2, B: 2 } }
  ];
  function mkPlayer(name, q0, q1, s0, s1) {
    return { name: name, answers: [{ label: q0 }, { labels: q1.slice() }], qScores: [s0, s1], totalScore: s0 + s1, rank: 0, absent: false };
  }
  function freshABC() {
    return [mkPlayer('P1', 'A', ['A'], 1, 2), mkPlayer('P2', 'B', ['B'], 3, 4), mkPlayer('P3', 'A', ['A', 'B'], 5, 6)];
  }
  function run(players, events) { return applyEvents(players, QUESTIONS, 0, events, STATS); }

  // 智慧之息：q0 最少 B(1人)→P2+2; q1 A/B并列2→全+2
  var m = byName(run(freshABC(), ['wisdom']).ranked);
  eqArr('智慧 q0 P2+2', m.P2, [5, 6]);
  eqArr('智慧 q1 全+2', m.P1, [1, 4]);

  // 智慧之息填空：1 1 2 3 → 填"2"和"3"的+2（答案人数最少），空答案不加
  var TQ = [{ id: 'T6', type: 'text' }];
  var TS = [{ counts: { '1': 2, '2': 1, '3': 1 } }];
  var tp = [
    { name: 'A', answers: [{ type: 'text', value: '1' }], qScores: [1], totalScore: 1, rank: 0, absent: false },
    { name: 'B', answers: [{ type: 'text', value: '1' }], qScores: [1], totalScore: 1, rank: 0, absent: false },
    { name: 'C', answers: [{ type: 'text', value: '2' }], qScores: [1], totalScore: 1, rank: 0, absent: false },
    { name: 'D', answers: [{ type: 'text', value: '3' }], qScores: [1], totalScore: 1, rank: 0, absent: false },
    { name: 'E', answers: [{ type: 'text', value: '' }], qScores: [1], totalScore: 1, rank: 0, absent: false }
  ];
  var tm = byName(applyEvents(tp, TQ, 0, ['wisdom'], TS).ranked);
  eqArr('智慧 填空 1/1/2/3 C+2', tm.C, [3]);
  eqArr('智慧 填空 1/1/2/3 D+2', tm.D, [3]);
  eqArr('智慧 填空 1/1/2/3 A不加', tm.A, [1]);
  eqArr('智慧 填空 空答案不加', tm.E, [1]);

  // 团结之息：q0 最多 A(2人)→P1,P3+2; q1 并列最多→全+2
  m = byName(run(freshABC(), ['unity']).ranked);
  eqArr('团结 q0 A+2', m.P3, [7, 8]);
  eqArr('团结 q1 全+2', m.P2, [3, 6]);

  // 谨慎之息：3人场无人>6（阈值写死）
  m = byName(run(freshABC(), ['caution']).ranked);
  eqArr('谨慎 3人无人>6', m.P3, [5, 6]);

  // 谨慎之息：构造12人场，A选项7人>6 → 选A者-1
  var twelve = [];
  for (var ti = 0; ti < 12; ti++) {
    var pick = ti < 7 ? 'A' : 'B';
    twelve.push(mkPlayer('T' + (ti + 1), pick, ['A'], 1, 2));
  }
  var stats12 = [{ counts: { A: 7, B: 5, C: 0 } }, { counts: { A: 12, B: 0 } }];
  var r12 = applyEvents(twelve, QUESTIONS, 0, ['caution'], stats12);
  var m12 = byName(r12.ranked);
  eqArr('谨慎 单选>6 选A者-1', m12.T1, [0, 1]);
  eqArr('谨慎 单选B(5人)不减', m12.T8, [1, 1]);
  eq('谨慎 多选>9(12人全选A) -1', m12.T1[1], 1);

  // 周四之息：每题-0.5
  m = byName(run(freshABC(), ['thursday']).ranked);
  eqArr('周四 q0', m.P1, [0.5, 1.5]);

  // 灼热之息：正分×1.2
  m = byName(run(freshABC(), ['blaze']).ranked);
  eqArr('灼热 正分×1.2', m.P3, [6, 7.2]);

  // 寒冰之息：负分×1.2（每次用 fresh 数据，避免测试间污染）
  function freshNeg() { return [mkPlayer('N1', 'A', ['A'], -2, 3), mkPlayer('N2', 'B', ['B'], 4, -5)]; }
  m = byName(run(freshNeg(), ['frost']).ranked);
  eqArr('寒冰 负分×1.2', m.N1, [-2.4, 3]);
  eqArr('寒冰 正分不变', m.N2, [4, -6]);

  // 对称之息：取绝对值
  m = byName(run(freshNeg(), ['mirror']).ranked);
  eqArr('对称 abs', m.N1, [2, 3]);
  eqArr('对称 abs2', m.N2, [4, 5]);

  // 颠倒之息：×-1
  m = byName(run(freshNeg(), ['invert']).ranked);
  eqArr('颠倒 ×-1', m.N1, [2, -3]);
  eqArr('颠倒 ×-1 负变正', m.N2, [-4, 5]);

  // 草木之息：最低拉到最高（并列最低全拉）
  var flora = [mkPlayer('F1', 'A', ['A'], 1, 0), mkPlayer('F2', 'B', ['B'], 5, 5), mkPlayer('F3', 'A', ['A'], 1, 3)];
  m = byName(run(flora, ['flora']).ranked);
  eqArr('草木 q0 并列最低拉平', m.F1, [5, 5]);
  eqArr('草木 q1 0→5', m.F2, [5, 5]);

  // 归零之息：0分+7（独立数据）
  var voids = [mkPlayer('V1', 'A', ['A'], 0, 2), mkPlayer('V2', 'B', ['B'], 1, 0)];
  m = byName(run(voids, ['void']).ranked);
  eqArr('归零 0→7', m.V1, [7, 2]);
  eqArr('归零 q1 0→7', m.V2, [1, 7]);

  // 优先级：对称(7) 在 颠倒(8) 前 → 先abs再取反 → 全变负
  var combo = [mkPlayer('C1', 'A', ['A'], -3, 4), mkPlayer('C2', 'B', ['B'], 2, -1)];
  m = byName(run(combo, ['mirror', 'invert']).ranked);
  eqArr('组合 对称→颠倒', m.C1, [-3, -4]);
  eqArr('组合 对称→颠倒2', m.C2, [-2, -1]);

  // 优先级：颠倒(8) 在 归零(10) 前 → 0分题颠倒后仍0，归零+7
  var combo2 = [mkPlayer('D1', 'A', ['A'], 0, 2), mkPlayer('D2', 'B', ['B'], 1, 3)];
  m = byName(run(combo2, ['invert', 'void']).ranked);
  eqArr('组合 颠倒→归零', m.D1, [7, -2]);
  eqArr('组合 D2', m.D2, [-1, -3]);

  // 优先级：草木(9) 在 归零(10) 前 → 草木拉平后无0 → 归零不触发
  var combo3 = [mkPlayer('E1', 'A', ['A'], 0, 0), mkPlayer('E2', 'B', ['B'], 0, 5)];
  m = byName(run(combo3, ['flora', 'void']).ranked);
  eqArr('组合 草木→归零 E1', m.E1, [7, 5]); // q0 双0: 草木不拉平(全同)→归零+7; q1: 草木0→5
  // 注意: q0 两人同为0, 草木mx===mn不拉平, 归零两人都+7
  eqArr('组合 草木→归零 E2(原始q1=5)', m.E2, [7, 5]);

  // 三重组合：灼热→对称→颠倒（正分先×1.2, 再abs, 再×-1）
  var combo4 = [mkPlayer('G1', 'A', ['A'], -2, 4)];
  m = byName(run(combo4, ['blaze', 'mirror', 'invert']).ranked);
  eqArr('三重 灼热→对称→颠倒', m.G1, [-2, -4.8]);

  // absent 玩家不受事件影响
  var withAbsent = freshABC();
  withAbsent.push({ name: 'ABS', answers: [], qScores: [0, 0], totalScore: 0, rank: 4, absent: true });
  var ra = run(withAbsent, ['thursday']).ranked;
  var absP = ra[ra.length - 1];
  eqArr('absent 不被-0.5', absP.qScores, [0, 0]);

  // 重排验证：事件后排名正确（P3 总分最高排第1）
  var rr = run(freshABC(), ['thursday']).ranked;
  eq('重排 第1名是P3', rr[0].name, 'P3');
  eq('重排 排名字段', rr[0].rank, 1);

  // CASTLE 题（qOffset=1）不参与事件
  var qWithCastle = [{ id: 'CASTLE', type: 'text', options: [], formula: '0' }].concat(QUESTIONS);
  var statsWithCastle = [{ counts: {} }].concat(STATS);
  var castlePlayers = freshABC().map(function(p) {
    var c = JSON.parse(JSON.stringify(p));
    c.answers = [{ label: '' }].concat(c.answers);
    c.qScores = [0].concat(c.qScores);
    return c;
  });
  var rc = applyEvents(castlePlayers, qWithCastle, 1, ['thursday'], statsWithCastle);
  var mc = byName(rc.ranked);
  eqArr('CASTLE 不被-0.5', mc.P1, [0, 0.5, 1.5]);
  eqArr('CASTLE 正常题被-0.5', mc.P2, [0, 2.5, 3.5]);

  console.log('\n自测结果: ' + passed + ' 通过, ' + failed + ' 失败');
  process.exit(failed > 0 ? 1 : 0);
}

module.exports = {
  EVENT_ORDER: EVENT_ORDER,
  EVENT_NAMES: EVENT_NAMES,
  isSurge: isSurge,
  drawEvents: drawEvents,
  applyEvents: applyEvents
};
