// rank.js — 乌合bingo 赛季排行榜
// 用法: node rank.js [赛季名]   (默认 S2)
// 规则: 完赛者(达成获胜条件)置顶, 完赛/未完赛组内均按完成格数降序;
//       完成数相同按最后点亮回合早者优先; 再相同按名字。
//       赛季中/赛季末均可查看 (读取 state.json 当前状态)。
var core = require('./core.js');
var fs = require('fs');
var path = require('path');

var season = process.argv[2] || 'S2';
var statePath = path.join(season, 'state.json');
if (!fs.existsSync(statePath)) {
  console.log('找不到状态文件: ' + statePath);
  process.exit(1);
}
var state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
var pb = state.playerBoards || {};
var names = Object.keys(pb);
if (names.length === 0) {
  console.log('[' + season + '] 暂无玩家数据');
  process.exit(0);
}

// 生成获胜条件文字描述 (与 core.checkWin 同口径)
function winDesc(bin) {
  var descs = [];
  var lines = core.getLines();
  var rows = [], cols = [];
  for (var i = 0; i < 5; i++) {
    if (lines[i].every(function(j) { return bin[j]; })) rows.push('R' + (i + 1));
    if (lines[5 + i].every(function(j) { return bin[j]; })) cols.push('C' + (i + 1));
  }
  if (rows.length && cols.length) descs.push('横' + rows.join('/') + ' 竖' + cols.join('/'));
  if (lines[10].every(function(j) { return bin[j]; }) && lines[11].every(function(j) { return bin[j]; })) {
    descs.push('双对角线');
  }
  for (var r = 0; r <= 2; r++) for (var c = 0; c <= 2; c++) {
    var all = true;
    for (var dr = 0; dr < 3; dr++) for (var dc = 0; dc < 3; dc++) {
      if (!bin[(r + dr) * 5 + (c + dc)]) { all = false; break; }
    }
    if (all) { descs.push('3×3@(' + (r + 1) + ',' + (c + 1) + ')'); }
  }
  return descs;
}

var rows = names.map(function(name) {
  var board = pb[name] || [];
  var bin = board.map(function(c) { return !!(c && c.completed); });
  var lastAt = null;
  board.forEach(function(cell) {
    if (cell && cell.completed && cell.completedAt != null) {
      if (lastAt === null || cell.completedAt > lastAt) lastAt = cell.completedAt;
    }
  });
  return {
    name: name,
    n: board.reduce(function(s, c) { return s + (c && c.completed ? 1 : 0); }, 0),
    won: core.checkWin(bin),
    lastAt: lastAt,
    wins: winDesc(bin)
  };
});

rows.sort(function(a, b) {
  if (a.won !== b.won) return a.won ? -1 : 1;
  if (a.n !== b.n) return b.n - a.n;
  var la = a.lastAt == null ? 999999 : a.lastAt;
  var lb = b.lastAt == null ? 999999 : b.lastAt;
  if (la !== lb) return la - lb;
  return String(a.name).localeCompare(String(b.name), 'zh');
});

console.log('===== 乌合bingo 排行榜 - ' + season + ' =====');
console.log('状态: ' + (state.finished ? '已结束' : '进行中') + ' | 当前回合: R' + state.currentRound +
           (state.winner ? ' | 胜者: ' + state.winner : ''));
console.log('完赛(达成获胜条件)置顶, 组内按完成格数排序');
console.log('');
console.log('名次  玩家              完成格  说明');
console.log('------------------------------------------------');
var rank = 1;
rows.forEach(function(r) {
  var mark;
  if (r.won) {
    mark = '✅ 完赛';
    if (r.wins.length) mark += ' [' + r.wins.join(', ') + ']';
    if (state.winner === r.name) mark += ' ★胜者';
  } else {
    mark = (r.n > 0 ? '未完赛' : '未点亮');
  }
  var rk = String(rank).padEnd(4);
  console.log(rk + String(r.name).padEnd(14) + String(r.n + '/25').padEnd(8) + mark);
  rank++;
});
console.log('');
console.log('注: 完成格数相同按最后点亮回合早者优先; 数据源 ' + statePath);
