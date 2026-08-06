var s = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
if (!s.playerBoards || !Object.keys(s.playerBoards).length) {
  console.log('无玩家数据');
  process.exit(0);
}
var names = Object.keys(s.playerBoards).sort();
var labels = 'ABCDEFGHIJKLMNOPQRSTUVWXY';

console.log('\n===== 任务完成情况 =====');
names.forEach(function(n) {
  var b = s.playerBoards[n];
  var done = b.filter(function(c) { return c.completed; }).length;
  var bar = '';
  for (var i = 0; i < 25; i++) bar += b[i].completed ? '#' : (b[i].progress > 0 ? '+' : '.');
  console.log('  ' + n.padEnd(14) + done + '/25  ' + bar);
});

// 每个玩家的进度详情
var showPlayer = process.argv[3];
if (!showPlayer) {
  console.log('\n(加玩家名参数查看详情, 如: node status.js rS1/state.json 尧)');
} else {
  var b = s.playerBoards[showPlayer];
  if (!b) { console.log('玩家不存在'); process.exit(0); }
  console.log('\n===== ' + showPlayer + ' 进度详情 =====');
  for (var i = 0; i < 25; i++) {
    var t = s.board[i];
    var c = b[i];
    var goal = c.goal || t.param || 1;
    var status = c.completed ? '✅' : (c.progress > 0 ? '🔄 ' + c.progress + '/' + goal : '⬜');
    console.log('  ' + labels[i] + ' ' + status + '  ' + t.desc + '  (目标: ' + goal + ')');
  }
}

if (s.castling && s.castling.log && s.castling.log.length) {
  console.log('\n===== 易位记录 =====');
  s.castling.log.forEach(function(e) {
    var label = ' [' + e.round + '] ';
    if (e.act === 'spec') label += e.player + ' 指定 ' + e.cell;
    else if (e.act === 'swap') label += e.player + ' 交换 ' + e.from + ' <-> ' + e.to;
    else if (e.act === 'complete') label += e.player + ' ' + e.cell + ' 已完成';
    console.log('  ' + label);
  });
}
