// board.js — 生成任务板仪表盘 (总版 + 单人版)
var fs = require('fs');
var path = require('path');

var stateFile = process.argv[2];
if (!stateFile) { console.log('用法: node board.js <赛季名>/state.json'); process.exit(1); }

var state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
var board = state.board;
var playerBoards = state.playerBoards || {};
var isS2 = /^s[23]$/i.test(String(state.season || '').trim());  // S2/S3 显示事件+屏息区块
var s2breath = null;
try { s2breath = require('./s2breath'); } catch (e) {}
var players = Object.keys(playerBoards).sort();
var COLORS = ['#e94560','#f39c12','#2ecc71','#3498db','#9b59b6','#1abc9c','#e74c3c','#f1c40f','#e67e22','#00bcd4','#8bc34a','#ff6f00'];

// 读取玩家自定义颜色 (全局配置: zlwuhe/colors.json, 无则回退赛季目录)
var colorsFile = path.join(__dirname, 'zlwuhe', 'colors.json');
if (!fs.existsSync(colorsFile)) colorsFile = path.join(path.dirname(stateFile), 'colors.json');
var playerColors = {};
if (fs.existsSync(colorsFile)) {
  try { playerColors = JSON.parse(fs.readFileSync(colorsFile, 'utf8')); } catch(e) {}
}

function playerColor(pi) {
  var name = players[pi];
  return playerColors[name] || COLORS[pi % COLORS.length];
}

function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ====== S2「大地的呼吸」展示辅助 ======
var CELLS = 'ABCDEFGHIJKLMNOPQRSTUVWXY';
var EVENT_INFO = {
  wisdom:  { name: '智慧之息', color: '#3498db', desc: '选中人数最少选项之一 → 该题+2' },
  unity:   { name: '团结之息', color: '#2ecc71', desc: '选中人数最多选项之一 → 该题+2' },
  caution: { name: '谨慎之息', color: '#e67e22', desc: '被超半数选择的选项，选了-1' },
  thursday:{ name: '周四之息', color: '#9b59b6', desc: '每题得分 -0.5' },
  blaze:   { name: '灼热之息', color: '#e94560', desc: '正分题 ×1.2' },
  frost:   { name: '寒冰之息', color: '#00bcd4', desc: '负分题 ×1.2' },
  mirror:  { name: '对称之息', color: '#f1c40f', desc: '得分取绝对值' },
  invert:  { name: '颠倒之息', color: '#e74c3c', desc: '得分 ×-1' },
  flora:   { name: '草木之息', color: '#1abc9c', desc: '该题最低分拉平到最高分' },
  void:    { name: '归零之息', color: '#8e44ad', desc: '该题恰好0分 → +7' }
};
function evInfo(key) { return EVENT_INFO[key] || { name: key, color: '#8b949e', desc: '' }; }
function isSurgeRound(rn) { return rn >= 5 && (rn - 5) % 3 === 0; }

// 屏息状态整理 (state.breathHold)
var bh = state.breathHold || null;
var breathRows = [];
var breathReqRows = [];
var bhView = bh || { quota: 2, players: {}, requests: [], applied: [] };
{
  var allReq = (bhView.requests || []).concat(bhView.applied || []);
  var seenKey = {};
  allReq.forEach(function(r) {
    var k = r.player + '|' + r.cell + '|' + r.requestRound;
    if (seenKey[k]) return;
    seenKey[k] = true;
    breathReqRows.push({
      player: r.player,
      label: CELLS[r.cell],
      requestRound: r.requestRound,
      applyRound: r.applyRound,
      status: r.status || 'pending',
      appliedRound: r.appliedRound,
      voidReason: r.voidReason
    });
  });
  Object.keys(bhView.players || {}).forEach(function(p) {
    breathRows.push({ player: p, used: bhView.players[p].used || 0, quota: bhView.quota || 2 });
  });
}
function breathCellOf(playerName) {
  return breathReqRows.filter(function(x) { return x.player === playerName && x.status === 'pending'; });
}
function breathDoneOf(playerName) {
  return breathReqRows.filter(function(x) { return x.player === playerName && x.status !== 'pending'; });
}

var castling = state.castling || {};
var swapLog = (castling.log || []).filter(function(e) { return e.act === 'swap'; });
var specLog = (castling.log || []).filter(function(e) { return e.act === 'spec'; });
var swappedCells = {};
swapLog.forEach(function(e) {
  if (!swappedCells[e.from]) swappedCells[e.from] = [];
  if (!swappedCells[e.to]) swappedCells[e.to] = [];
  swappedCells[e.from].push(e.player + '(R' + e.round + ')');
  swappedCells[e.to].push(e.player + '(R' + e.round + ')');
});
// Pending cells (易位指定但未到期, 且格子未完成才显示)
var pendingInfo = {};
if (castling.players) {
  Object.entries(castling.players).forEach(function(e) {
    var pd = e[1];
    if (pd.pendingCell !== null && pd.pendingCell !== undefined) {
      var playerBd = (state.playerBoards || {})[e[0]];
      if (playerBd && playerBd[pd.pendingCell] && playerBd[pd.pendingCell].completed) return;
      var playerLM = (state.playerLabelMap || {})[e[0]];
      var pLabel = playerLM ? playerLM[pd.pendingCell] : 'ABCDEFGHIJKLMNOPQRSTUVWXY'[pd.pendingCell];
      if (!pendingInfo[pLabel]) pendingInfo[pLabel] = [];
      pendingInfo[pLabel].push(e[0] + ' (R' + (pd.cooldownUntil || (pd.pendingRound + 3)) + '到期)');
    }
  });
}

// ====== 生成格子 HTML ======
function cellHTML(idx, pi, isSingle) {
  var r = Math.floor(idx / 5), c = idx % 5;
  var t = board[idx];
  var label = 'ABCDEFGHIJKLMNOPQRSTUVWXY'[idx];
  // 单人板: 读取该玩家的实际任务和标签
  var taskMap = state.playerTaskMap || {};
  var labelMap = state.playerLabelMap || {};
  var displayTask = board[idx]; // 默认原始任务
  if (isSingle && pi >= 0) {
    var pm = taskMap[players[pi]];
    var lm = labelMap[players[pi]];
    if (pm) {
      var taskId = pm[idx];
      var realTask = board.find(function(bt) { return bt.id === taskId; });
      if (realTask) displayTask = realTask;
    }
    if (lm) label = lm[idx];
  }
  var swapTitle = swappedCells[label] ? ' 易位: ' + swappedCells[label].join(', ') : '';

  var pips = '', allDone = true, anyDone = false;
  var plist = isSingle && pi >= 0 ? [players[pi]] : players;
  plist.forEach(function(p, i) {
    var pi2 = isSingle ? pi : i;
    var cell = playerBoards[p][idx];
    var done = cell.completed;
    if (!done) allDone = false; else anyDone = true;
    var goal = cell.goal || state.board[idx].param || 1;
    var pct = Math.min(100, Math.round((cell.progress || 0) / Math.max(1, goal) * 100));
    var title = esc(p) + (done ? ' ✅' : (cell.progress > 0 ? ' ' + cell.progress + '/' + goal : ''));
    var bg = done ? playerColor(pi2) : (cell.progress > 0 ? '#444' : '#222');
    pips += '<div class="pip' + (done?' on':'') + '" style="background:' + bg + ';opacity:' + (done||cell.progress>0?1:0.3) + '" title="' + title + '" ></div>';
  });

  var swapClass = '';
  var swapTitle = '';
  var pendingClass = '';
  var pendingTitle = '';
  // 单人板不再需要swap边框(格子内容已直接替换)
  var pendingClass = '';
  if (pendingInfo[label] && isSingle && pi >= 0) {
    var pn2 = players[pi];
    if (pendingInfo[label].some(function(s) { return s.indexOf(pn2) >= 0; })) pendingClass = ' pending';
  }
  var doneClass = isSingle && anyDone ? ' done' : '';
  // 任务O: 显示数字完成情况 (B14 - 0~9)
  var digitDisplay = '';
  if (isSingle && pi >= 0 && displayTask.id === 'B14') {
    var cell = playerBoards[players[pi]][14];
    var digits = cell.digits || {};
    var dg = '<div class="digits">';
    for (var d = 0; d <= 9; d++) {
      dg += '<span class="digit' + (digits[d] ? ' on' : '') + '">' + d + '</span>';
    }
    dg += '</div>';
    digitDisplay = dg;
  }

  var weakBadge = '';
  var weakTitle = '';
  var weakPreview = '';
  if (isSingle && pi >= 0) {
    var wc = playerBoards[players[pi]][idx];
    if (wc && wc.weakened) {
      weakBadge = '<div class="weak">💨屏息' + (wc.weakAppliedRound ? '·R' + wc.weakAppliedRound : '') + '</div>';
      weakTitle = wc.weakDesc ? ' [屏息] ' + wc.weakDesc : '';
    }
  }
  // 弱化预览: 未屏息的格子显示屏息后的任务形式 (复用 s2breath.weakify)
  if (!weakTitle && s2breath && displayTask) {
    try {
      var wRes = s2breath.weakify(displayTask.id, displayTask.param != null ? displayTask.param : 1, displayTask.desc);
      if (wRes && wRes.desc) {
        weakPreview = (wRes.desc === displayTask.desc)
          ? '\n💨屏息弱化: 与原任务相同'
          : '\n💨屏息弱化: ' + wRes.desc;
      }
    } catch (e) {}
  }

  var dType = isSingle ? 'p' + pi : 'm';
  var detailBtn = '<button class="detail-btn" title="查看任务详情/弱化形式" onclick="event.stopPropagation();showDetail(\'' + dType + '\',' + idx + ')">💨</button>';

  return '<td class="cell' + swapClass + doneClass + pendingClass + '" onclick="showDetail(\'' + dType + '\',' + idx + ')" title="' + esc(displayTask.desc) + esc(weakPreview) + weakTitle + swapTitle + (pendingClass?' pending':'') + '"><div class="label">' + label + '</div><div class="desc">' + esc(displayTask.desc) + '</div>' + weakBadge + detailBtn + '<div class="pips">' + pips + '</div>' + digitDisplay + '</td>';
}

// ====== 总版 ======
var masterTable = '';
for (var r = 0; r < 5; r++) {
  masterTable += '<tr>';
  for (var c = 0; c < 5; c++) masterTable += cellHTML(r * 5 + c, -1, false);
  masterTable += '</tr>';
}

// ====== 单人版 ======
var singleBoards = '';
players.forEach(function(p, pi) {
  var done = playerBoards[p].filter(function(c) { return c.completed; }).length;
  singleBoards += '<div class="single-board" id="p' + pi + '">';
  singleBoards += '<h2><span class="dot" style="background:' + playerColor(pi) + '"></span>' + esc(p) + ' <small>' + done + '/25</small></h2>';
  singleBoards += '<table class="single-table">';
  for (var r = 0; r < 5; r++) {
    singleBoards += '<tr>';
    for (var c = 0; c < 5; c++) singleBoards += cellHTML(r * 5 + c, pi, true);
    singleBoards += '</tr>';
  }
  singleBoards += '</table></div>';
});

// ====== 图例 + 时间线 ======
var legend = '';
players.forEach(function(p, pi) {
  var done = playerBoards[p].filter(function(c){return c.completed}).length;
  legend += '<div class="player"><a href="#p' + pi + '"><span class="dot" style="background:' + playerColor(pi) + '"></span>' + esc(p) + ' <b>' + done + '/25</b></a></div>';
});

var maxRound = state.currentRound || 0;
var timeline = '';
if (maxRound > 0 && state.history.length > 0) {
  timeline += '<h2>各回合新增完成</h2>';
  timeline += '<table class="timeline"><tr><th>玩家</th>';
  for (var rn = 1; rn <= maxRound; rn++) timeline += '<th>R' + rn + '</th>';
  timeline += '<th>总计</th></tr>';
  players.forEach(function(p, pi) {
    timeline += '<tr><td style="color:' + playerColor(pi) + ';font-weight:bold">' + esc(p) + '</td>';
    var total = 0;
    for (var rn = 1; rn <= maxRound; rn++) {
      var pb = playerBoards[p] || [];
      var count = pb.filter(function(c) { return c.completed && c.completedAt === rn; }).length;
      total += count;
      var cs = '';
      pb.forEach(function(c, ci) { if (c.completed && c.completedAt === rn) cs += 'ABCDEFGHIJKLMNOPQRSTUVWXY'[ci]; });
      timeline += '<td title="' + cs + '">' + (count > 0 ? '+' + count : '·') + '</td>';
    }
    timeline += '<td><b>' + total + '</b></td></tr>';
  });
  timeline += '</table>';
}

var swapTable = '';
if (swapLog.length > 0) {
  swapTable += '<h2>易位交换记录</h2><table class="timeline"><tr><th>回合</th><th>玩家</th><th>交换</th></tr>';
  swapLog.forEach(function(e) { swapTable += '<tr><td>R' + e.round + '</td><td>' + esc(e.player) + '</td><td>' + e.from + ' ↔ ' + e.to + '</td></tr>'; });
  swapTable += '</table>';
}

// 易位冷却状态
var cPlayers = castling.players || {};
var coolTable = '';
if (Object.keys(cPlayers).length > 0) {
  coolTable += '<h2>易位状态</h2><table class="timeline"><tr><th>玩家</th><th>已用</th><th>冷却</th><th>指定格</th><th>指定回合</th></tr>';
  Object.entries(cPlayers).forEach(function(e) {
    var pd = e[1];
    var label = 'ABCDEFGHIJKLMNOPQRSTUVWXY';
    var playerLM = (state.playerLabelMap || {})[e[0]];
    coolTable += '<tr><td>' + esc(e[0]) + '</td>';
    coolTable += '<td>' + (pd.maxUses >= 999 ? '∞' : pd.uses + '/1') + '</td>';
    coolTable += '<td>' + (pd.cooldownUntil ? (state.currentRound < pd.cooldownUntil ? '⏳R' + pd.cooldownUntil : '✅') : '✅') + '</td>';
    coolTable += '<td>' + (pd.pendingCell != null ? (playerLM ? playerLM[pd.pendingCell] : label[pd.pendingCell]) : '-') + '</td>';
    coolTable += '<td>' + (pd.pendingRound ? 'R' + pd.pendingRound : '-') + '</td></tr>';
  });
  coolTable += '</table>';
  if (castling.speedUp) coolTable += '<p style="text-align:center;color:#f39c12;margin-top:4px">⚡ 已加速 (≥3人触发, 冷却缩短至2回合)</p>';
}

// ====== S2 封印之息 + 屏息 区块 ======
var s2EventsHTML = '';
var s2BreathHTML = '';
if (isS2) {
  var ev = state.events || { active: [], history: [] };
  var _evOrder = Object.keys(EVENT_INFO);  // 键序=优先级（wisdom→void）
  var activeList = (ev.active || []).slice().sort(function(a, b) {
    return _evOrder.indexOf(a) - _evOrder.indexOf(b);
  }).map(function(k) {
    var info = evInfo(k);
    return '<div class="ev-card" style="border-color:' + info.color + '"><div class="ev-name" style="color:' + info.color + '">' + esc(info.name) + '</div><div class="ev-desc">' + esc(info.desc) + '</div></div>';
  }).join('');
  var evHead = activeList
    ? '<h2>🌬 本轮生效事件' + ((ev.active || []).length >= 3 ? ' <small>气息喷涌×' + ev.active.length + '</small>' : '') + '</h2>'
    : '<h2>🌬 封印之息</h2><p class="sub">R3 起每回合结算后抽取，下一回合生效 · R5/8/11… 气息喷涌×3</p>';
  var evBody = activeList ? '<div class="ev-list">' + activeList + '</div>' : '';
  var hisRows = '';
  (ev.history || []).forEach(function(h) {
    var names = (h.events || []).map(function(k) {
      var info = evInfo(k);
      return '<span class="ev-tag" style="border-color:' + info.color + ';color:' + info.color + '">' + esc(info.name) + '</span>';
    }).join(' ');
    hisRows += '<tr><td>R' + h.round + '</td><td>' + (names || '-') + '</td></tr>';
  });
  s2EventsHTML = '<div id="s2events">' + evHead + evBody
    + (hisRows ? '<h2>事件历史</h2><table class="timeline"><tr><th>回合</th><th>生效事件</th></tr>' + hisRows + '</table>' : '')
    + '</div>';

  // 屏息状态 (S2 下始终显示区块)
  if (isS2) {
    var bRows = '';
    if (breathRows.length === 0) {
      bRows = '<tr><td colspan="4" style="color:#8b949e">暂无玩家使用屏息（每人每赛季最多 ' + (bhView.quota || 2) + ' 次）</td></tr>';
    }
    breathRows.forEach(function(r) {
      var pend = breathCellOf(r.player).map(function(x) { return x.label + '(R' + x.applyRound + '生效)'; }).join(', ');
      var done = breathDoneOf(r.player).map(function(x) {
        return x.label + (x.status === 'applied' ? '(R' + x.appliedRound + '✅)' : '(作废)');
      }).join(', ');
      bRows += '<tr><td>' + esc(r.player) + '</td><td>' + r.used + '/' + r.quota + '</td>'
        + '<td>' + (pend || '-') + '</td><td>' + (done || '-') + '</td></tr>';
    });
    s2BreathHTML = '<div id="breath"><h2>💨 屏息</h2>'
      + '<table class="timeline"><tr><th>玩家</th><th>已用/次数</th><th>申请中</th><th>已生效/作废</th></tr>' + bRows + '</table>'
      + '<p class="sub">屏息: 指定格号A~Y，2回合后该格任务条件永久削弱（绑定格位）</p></div>';
  }
}

// ====== HTML ======
// 读取赛季配置
var config = {};
var configFile = path.join(path.dirname(stateFile), 'config.json');
if (fs.existsSync(configFile)) {
  try { config = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch(e) {}
}

// ====== 格子详情数据（弱化预览/已屏息状态, 供弹窗使用） ======
function buildDetailData() {
  var master = [], byPlayer = [], CELLS = 'ABCDEFGHIJKLMNOPQRSTUVWXY';
  for (var i = 0; i < 25; i++) {
    var t = board[i];
    var w = null;
    try { if (s2breath) { var wr = s2breath.weakify(t.id, t.param != null ? t.param : 1, t.desc); w = wr && wr.desc ? wr.desc : null; } } catch (e) {}
    master.push({ label: CELLS[i], id: t.id, desc: t.desc, weak: w, weakened: false, weakRound: null, same: w === t.desc, status: '⬜', progress: 0, goal: (t.param || 1) });
  }
  players.forEach(function(p) {
    var arr = [];
    var pm = (state.playerTaskMap || {})[p];
    var lm = (state.playerLabelMap || {})[p];
    for (var i = 0; i < 25; i++) {
      var taskId = pm ? pm[i] : board[i].id;
      var realTask = null;
      for (var b = 0; b < board.length; b++) if (board[b].id === taskId) { realTask = board[b]; break; }
      var t = realTask || board[i];
      var c = (playerBoards[p] || [])[i] || {};
      var weakened = !!c.weakened;
      var w = null;
      if (weakened) w = c.weakDesc || t.desc;
      else { try { if (s2breath) { var wr2 = s2breath.weakify(t.id, t.param != null ? t.param : 1, t.desc); w = wr2 && wr2.desc ? wr2.desc : null; } } catch (e) {} }
      var goal = c.goal || t.param || 1;
      var st = c.completed ? '✅' : ((c.progress || 0) > 0 ? '◐' : '⬜');
      arr.push({ label: lm ? lm[i] : CELLS[i], id: t.id, desc: t.desc, weak: w, weakened: weakened, weakRound: c.weakAppliedRound || null, same: weakened ? false : (w === t.desc), status: st, progress: c.progress || 0, goal: goal });
    }
    byPlayer.push(arr);  // 数组, 与 players 同序
  });
  return { master: master, players: byPlayer };
}
var DETAILS = buildDetailData();

var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>任务板 - ' + state.season + '</title><style>'
  + '*{margin:0;padding:0;box-sizing:border-box}'
  + 'body{font-family:"Microsoft YaHei",sans-serif;background:#0d1117;color:#c9d1d9;padding:10px}'
  + 'h1{text-align:center;color:#e94560;margin:10px 0 4px;font-size:20px}'
  + 'h2{color:#e94560;margin:20px 0 8px;font-size:16px;text-align:center}'
  + 'h2 small{color:#8b949e;font-size:13px}'
  + '.sub{text-align:center;color:#8b949e;margin-bottom:12px;font-size:12px}'
  + '.nav{text-align:center;margin:8px 0;display:flex;flex-wrap:wrap;gap:8px;justify-content:center}'
  + '.nav a{color:#58a6ff;text-decoration:none;font-size:13px;padding:4px 10px;border:1px solid #30363d;border-radius:4px}'
  + '.nav a:hover{background:#1c2128}'
  + '.board-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}'
  + 'table{border-collapse:collapse;margin:0 auto}'
  + '.cell{width:130px;min-height:100px;border:2px solid #30363d;padding:5px 6px;vertical-align:top;font-size:10px;background:#161b22;position:relative}'
  + '.cell.swapped{border-color:#d35400}'
  + '.cell.pending{border-color:#f39c12;border-style:dashed}'
  + '.cell.swapped .label{color:#d35400}'
  + '.label{font-size:12px;font-weight:bold;color:#e94560;margin-bottom:2px}'
  + '.desc{line-height:1.25;margin-bottom:16px}'
  + '.pips{display:flex;flex-wrap:wrap;gap:2px;margin-top:2px}'
  + '.pip{width:11px;height:11px;border-radius:2px;cursor:pointer}'
  + '.pip.on{box-shadow:0 0 2px rgba(255,255,255,0.3)}'
  + '.pip.zoom{transform:scale(2.2);z-index:10;position:relative}'
  + '#pipinfo{display:none;position:fixed;background:#21262d;border:1px solid #e94560;border-radius:6px;padding:6px 12px;font-size:13px;z-index:100;white-space:nowrap;pointer-events:none}'
  + '#pipinfo.show{display:block}'
  + '.players{max-width:940px;margin:10px auto;display:flex;flex-wrap:wrap;gap:6px 16px;justify-content:center}'
  + '.player{display:flex;align-items:center;gap:5px;font-size:12px}'
  + '.dot{width:10px;height:10px;border-radius:2px;display:inline-block}'
  + '.single-board{margin:10px 0 30px}'
  + '.single-table{border-collapse:separate;border-spacing:0}'
  + '.single-table .cell{width:140px;min-height:105px}'
  + '.cell.done{background:#1a2f1a;outline:2px solid #2ecc71;outline-offset:-1px;z-index:1;position:relative}'
  + '.timeline-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}'
  + '.timeline{margin:10px auto}'
  + '.timeline td,.timeline th{padding:3px 6px;border:1px solid #30363d;font-size:11px;text-align:center}'
  + '.timeline th{background:#161b22;color:#8b949e}'
  + '.timeline td:first-child{text-align:left;padding-right:12px;position:sticky;left:0;background:#161b22;z-index:1}'
  + '@media(min-width:768px){body{padding:20px}.cell{width:160px;min-height:110px;font-size:11px}.label{font-size:14px}.pip{width:13px;height:13px}.player{font-size:13px}.single-table .cell{width:170px;min-height:115px}}'
  + '@media(min-width:1024px){.cell{width:180px;min-height:120px}}'
  + '.digits{display:flex;gap:1px;margin-top:2px;justify-content:center}'
  + '.digit{font-size:7px;width:11px;height:11px;line-height:11px;text-align:center;border-radius:1px;background:#1a1a1a;color:#444}'
  + '.digit.on{background:#3a3;color:#fff}'
  + '@media print{body{background:#fff;color:#000}.cell{background:#fff;border-color:#ccc}}'
  + '.ev-list{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:940px;margin:0 auto 10px}'
  + '.ev-card{border:1px solid;border-radius:6px;padding:6px 10px;background:#161b22;min-width:150px}'
  + '.ev-name{font-weight:bold;font-size:13px;margin-bottom:2px}'
  + '.ev-desc{font-size:11px;color:#8b949e}'
  + '.ev-tag{display:inline-block;border:1px solid;border-radius:3px;font-size:11px;padding:0 4px;margin:1px}'
  + '.weak{display:inline-block;font-size:8px;color:#f1c40f;background:rgba(241,196,15,.12);border:1px solid rgba(241,196,15,.4);border-radius:3px;padding:0 3px;margin-bottom:2px;line-height:1.5}'
  + '.cell{cursor:pointer}'
  + '.detail-btn{position:absolute;right:2px;bottom:2px;background:none;border:none;font-size:12px;cursor:pointer;opacity:.8;padding:1px 4px;line-height:1}'
  + '.detail-btn:active{opacity:1}'
  + '.modal-mask{display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:200;align-items:center;justify-content:center}'
  + '.modal-mask.show{display:flex}'
  + '.modal{position:relative;background:#161b22;border:1px solid #30363d;border-radius:10px;padding:18px 16px 14px;width:min(92vw,360px);max-height:80vh;overflow:auto}'
  + '.modal-close{position:absolute;top:6px;right:10px;background:none;border:none;color:#8b949e;font-size:22px;cursor:pointer;line-height:1}'
  + '.m-cell{font-size:15px;font-weight:bold;color:#e94560}'
  + '.m-cell small{color:#8b949e;font-weight:normal;margin-left:6px;font-size:12px}'
  + '.m-status{color:#8b949e;font-size:12px;margin:2px 0 10px}'
  + '.m-row{margin:9px 0;font-size:12px}'
  + '.m-row b{color:#8b949e;display:block;margin-bottom:3px}'
  + '.m-weak{color:#f1c40f;background:rgba(241,196,15,.08);border:1px solid rgba(241,196,15,.3);border-radius:5px;padding:6px 8px;line-height:1.4}'
  + '.m-weak small{color:#8b949e}'
  + '@media(max-width:767px){body{padding:6px}h1{font-size:17px;margin:6px 0 2px}h2{font-size:14px;margin:14px 0 6px}.sub{font-size:11px;margin-bottom:8px}.nav a{font-size:12px;padding:6px 9px}.board-wrap table,.single-table{width:100%;table-layout:fixed}.cell{width:auto;min-height:76px;font-size:8px;padding:3px 2px;border-width:1.5px}.single-table .cell{min-height:80px;font-size:8.5px}.label{font-size:10px}.desc{font-size:8px;line-height:1.2;margin-bottom:10px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.pip{width:9px;height:9px}.pip.zoom{transform:scale(2.6)}.digit{width:9px;height:9px;font-size:6px;line-height:9px}.weak{font-size:7px}.detail-btn{font-size:11px}.ev-card{min-width:calc(50% - 8px);flex:1}.player{font-size:11px}.timeline-wrap{max-width:100%}}'
  + '</style></head><body>'
  + '<h1>乌合bingo - ' + state.season + '</h1>'
  + '<div class="sub">回合 ' + state.currentRound + ' · ' + players.length + ' 人 · ' + (state.finished?'已结束 · 胜者: '+(state.winner||''):'进行中')
  + (config.castling === false ? ' · 易位:关' : '') + (config.winCheck === false ? ' · 获胜:关' : '')
  + (isS2 && state.events && state.events.active && state.events.active.length ? ' · 🌬 ' + state.events.active.slice().sort(function(a, b) { return _evOrder.indexOf(a) - _evOrder.indexOf(b); }).map(function(k){ return evInfo(k).name; }).join('、') : '') + '</div>'
  + '<div class="nav"><a href="#master">📋 总版</a>' + (isS2 ? '<a href="/s3/">📖 赛季介绍</a>' : '') + players.map(function(p,pi){ return '<a href="#p'+pi+'"><span class="dot" style="background:'+playerColor(pi)+'"></span>'+esc(p)+'</a>'; }).join('')   + '<a href="#timeline">📊 进度</a>' + (isS2?'<a href="#s2events">🌬 事件</a>':'') + (isS2?'<a href="#breath">💨 屏息</a>':'') + (swapLog.length?'<a href="#swap">🔄 易位</a>':'') + (coolTable?'<a href="#cooling">⏳ 冷却</a>':'') + '</div>'
  + '<div id="master"><h2>总版</h2><div class="board-wrap"><table>' + masterTable + '</table></div></div>'
  + '<div class="players">' + legend + '</div>'
  + singleBoards
  + s2EventsHTML
  + s2BreathHTML
  + '<div id="timeline">' + timeline + '</div>'
  + (swapTable ? '<div id="swap">' + swapTable + '</div>' : '')
  + (coolTable ? '<div id="cooling">' + coolTable + '</div>' : '')
  + '<div id="detail-modal" class="modal-mask" onclick="closeDetail()"><div class="modal" onclick="event.stopPropagation()"><button class="modal-close" onclick="closeDetail()">×</button><div id="detail-body"></div></div></div>'
  + '<div id="pipinfo"></div>'
  + '<script>window.DETAILS=' + JSON.stringify(DETAILS) + ';'
  + 'function esc2(s){return (s==null?"":String(s)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}'
  + 'function showDetail(type,idx){var d=(type==="m"?window.DETAILS.master:window.DETAILS.players[type.slice(1)])[idx];if(!d)return;var h="<div class=\\"m-cell\\">"+esc2(d.label)+" <small>"+esc2(d.id)+"</small></div>";'
  + 'h+="<div class=\\"m-status\\">"+esc2(d.status)+(d.progress?" "+d.progress+"/"+d.goal:"")+"</div>";'
  + 'h+="<div class=\\"m-row\\"><b>任务</b><div>"+esc2(d.desc)+"</div></div>";'
  + 'if(d.weakened){h+="<div class=\\"m-row\\"><b>已屏息"+(d.weakRound?"·R"+d.weakRound:"")+"</b><div class=\\"m-weak\\">"+esc2(d.weak)+"</div></div>";}'
  + 'else{h+="<div class=\\"m-row\\"><b>💨屏息弱化</b><div class=\\"m-weak\\">"+esc2(d.weak)+(d.same?" <small>(与原任务相同，无额外放宽)</small>":"")+"</div></div>";}'
  + 'document.getElementById("detail-body").innerHTML=h;document.getElementById("detail-modal").classList.add("show");}'
  + 'function closeDetail(){document.getElementById("detail-modal").classList.remove("show");}'
  + 'document.querySelectorAll(".pip").forEach(function(el){el.onclick=function(e){e.stopPropagation();var i=document.getElementById("pipinfo");i.textContent=el.title;i.classList.add("show");var r=el.getBoundingClientRect();i.style.left=Math.min(r.left+10,window.innerWidth-i.offsetWidth-10)+"px";i.style.top=Math.max(r.top-35,10)+"px"}});document.onclick=function(){document.getElementById("pipinfo").classList.remove("show")}</script>'
  + '</body></html>';

var outFile = path.join(path.dirname(stateFile), 'index.html');
fs.writeFileSync(outFile, html, 'utf8');
console.log('已生成: ' + outFile);
