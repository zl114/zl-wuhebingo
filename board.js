// board.js — 生成任务板仪表盘 (总版 + 单人版)
var fs = require('fs');
var path = require('path');

var stateFile = process.argv[2];
if (!stateFile) { console.log('用法: node board.js <赛季名>/state.json'); process.exit(1); }

var state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
var board = state.board;
var playerBoards = state.playerBoards || {};
var players = Object.keys(playerBoards).sort();
var COLORS = ['#e94560','#f39c12','#2ecc71','#3498db','#9b59b6','#1abc9c','#e74c3c','#f1c40f','#e67e22','#00bcd4','#8bc34a','#ff6f00'];

// 读取玩家自定义颜色
var colorsFile = path.join(path.dirname(stateFile), 'colors.json');
var playerColors = {};
if (fs.existsSync(colorsFile)) {
  try { playerColors = JSON.parse(fs.readFileSync(colorsFile, 'utf8')); } catch(e) {}
}

function playerColor(pi) {
  var name = players[pi];
  return playerColors[name] || COLORS[pi % COLORS.length];
}

function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

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
      var label = 'ABCDEFGHIJKLMNOPQRSTUVWXY'[pd.pendingCell];
      // 检查该玩家此格是否已完成
      var playerBd = (state.playerBoards || {})[e[0]];
      if (playerBd && playerBd[pd.pendingCell] && playerBd[pd.pendingCell].completed) return; // 已完成，不显示
      if (!pendingInfo[label]) pendingInfo[label] = [];
      pendingInfo[label].push(e[0] + ' (R' + (pd.cooldownUntil || (pd.pendingRound + 3)) + '到期)');
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
    pips += '<div class="pip' + (done?' on':'') + '" style="background:' + bg + ';opacity:' + (done||cell.progress>0?1:0.3) + '" title="' + title + '" onclick="this.classList.toggle(\'zoom\')"></div>';
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
  return '<td class="cell' + swapClass + doneClass + pendingClass + '" title="' + esc(displayTask.desc) + swapTitle + (pendingClass?' pending':'') + '"><div class="label">' + label + '</div><div class="desc">' + esc(displayTask.desc) + '</div><div class="pips">' + pips + '</div></td>';
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
    coolTable += '<tr><td>' + esc(e[0]) + '</td>';
    coolTable += '<td>' + pd.uses + '/' + (pd.maxUses >= 999 ? '∞' : pd.maxUses) + '</td>';
    coolTable += '<td>' + (pd.cooldownUntil ? (state.currentRound < pd.cooldownUntil ? '⏳R' + pd.cooldownUntil : '✅') : '✅') + '</td>';
    coolTable += '<td>' + (pd.pendingCell != null ? label[pd.pendingCell] : '-') + '</td>';
    coolTable += '<td>' + (pd.pendingRound ? 'R' + pd.pendingRound : '-') + '</td></tr>';
  });
  coolTable += '</table>';
  if (castling.speedUp) coolTable += '<p style="text-align:center;color:#f39c12;margin-top:4px">⚡ 已加速 (≥5人触发, 冷却缩短至2回合)</p>';
}

// ====== HTML ======
// 读取赛季配置
var config = {};
var configFile = path.join(path.dirname(stateFile), 'config.json');
if (fs.existsSync(configFile)) {
  try { config = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch(e) {}
}

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
  + '.cell{width:130px;height:100px;border:2px solid #30363d;padding:5px 6px;vertical-align:top;font-size:10px;background:#161b22;position:relative}'
  + '.cell.swapped{border-color:#d35400}'
  + '.cell.pending{border-color:#f39c12;border-style:dashed}'
  + '.cell.swapped .label{color:#d35400}'
  + '.label{font-size:12px;font-weight:bold;color:#e94560;margin-bottom:2px}'
  + '.desc{line-height:1.25;margin-bottom:3px;height:32px;overflow:hidden}'
  + '.pips{display:flex;flex-wrap:wrap;gap:2px;position:absolute;bottom:4px;left:6px;right:6px}'
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
  + '.single-table .cell{width:140px;height:105px}'
  + '.cell.done{background:#1a2f1a;outline:2px solid #2ecc71;outline-offset:-1px;z-index:1;position:relative}'
  + '.timeline-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}'
  + '.timeline{margin:10px auto}'
  + '.timeline td,.timeline th{padding:3px 6px;border:1px solid #30363d;font-size:11px;text-align:center}'
  + '.timeline th{background:#161b22;color:#8b949e}'
  + '.timeline td:first-child{text-align:left;padding-right:12px;position:sticky;left:0;background:#161b22;z-index:1}'
  + '@media(min-width:768px){body{padding:20px}.cell{width:160px;height:110px;font-size:11px}.label{font-size:14px}.pip{width:13px;height:13px}.player{font-size:13px}.single-table .cell{width:170px;height:115px}}'
  + '@media(min-width:1024px){.cell{width:180px;height:120px}}'
  + '@media print{body{background:#fff;color:#000}.cell{background:#fff;border-color:#ccc}}'
  + '</style></head><body>'
  + '<h1>乌合bingo - ' + state.season + '</h1>'
  + '<div class="sub">回合 ' + state.currentRound + ' · ' + players.length + ' 人 · ' + (state.finished?'已结束 · 胜者: '+(state.winner||''):'进行中')
  + (config.castling === false ? ' · 易位:关' : '') + (config.winCheck === false ? ' · 获胜:关' : '') + '</div>'
  + '<div class="nav"><a href="#master">📋 总版</a>' + players.map(function(p,pi){ return '<a href="#p'+pi+'"><span class="dot" style="background:'+playerColor(pi)+'"></span>'+esc(p)+'</a>'; }).join('')   + '<a href="#timeline">📊 进度</a>' + (swapLog.length?'<a href="#swap">🔄 易位</a>':'') + (coolTable?'<a href="#cooling">⏳ 冷却</a>':'') + '</div>'
  + '<div id="master"><h2>总版</h2><div class="board-wrap"><table>' + masterTable + '</table></div></div>'
  + '<div class="players">' + legend + '</div>'
  + singleBoards
  + '<div id="timeline">' + timeline + '</div>'
  + (swapTable ? '<div id="swap">' + swapTable + '</div>' : '')
  + (coolTable ? '<div id="cooling">' + coolTable + '</div>' : '')
  + '<div id="pipinfo"></div>'
  + '<script>document.querySelectorAll(".pip").forEach(function(el){el.onclick=function(e){e.stopPropagation();var i=document.getElementById("pipinfo");i.textContent=el.title;i.classList.add("show");var r=el.getBoundingClientRect();i.style.left=Math.min(r.left+10,window.innerWidth-i.offsetWidth-10)+"px";i.style.top=Math.max(r.top-35,10)+"px"}});document.onclick=function(){document.getElementById("pipinfo").classList.remove("show")}</script>'
  + '</body></html>';

var outFile = path.join(path.dirname(stateFile), '任务板.html');
fs.writeFileSync(outFile, html, 'utf8');
console.log('已生成: ' + outFile);
