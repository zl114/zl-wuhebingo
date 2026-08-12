// query.js — 快捷查询
// node query.js <赛季> <命令> [参数]
var fs = require('fs');
var path = require('path');

var season = process.argv[2];
var cmd = process.argv[3];
var arg = process.argv[4];

if (!season) {
  console.log('用法: node query.js <赛季> <命令> [参数]');
  console.log('  status          总览');
  console.log('  player <名>     玩家进度');
  console.log('  task <格>       任务状态(如O)');
  console.log('  castle          易位状态');
  console.log('  round <N>       回合报告');
  console.log('  rank            排名');
  process.exit(0);
}

var stateFile = path.join(season, 'state.json');
if (!fs.existsSync(stateFile)) { console.log('state.json 不存在'); process.exit(1); }
var s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
var core = require('./core');
var cl = 'ABCDEFGHIJKLMNOPQRSTUVWXY';

if (cmd === 'status') {
  var names = Object.keys(s.playerBoards).sort();
  names.forEach(function(n) {
    var b = s.playerBoards[n];
    var done = b.filter(function(c) { return c.completed; }).length;
    var bar = '';
    for (var i = 0; i < 25; i++) bar += b[i].completed ? '#' : (b[i].progress > 0 ? '+' : '.');
    console.log(n.padEnd(14) + done + '/25  ' + bar);
  });
  if (s.winner) console.log('\n胜者: ' + s.winner);

} else if (cmd === 'player') {
  if (!arg && arg !== '0') arg = Object.keys(s.playerBoards).find(function(n) { return n.length <= 1; });
  var matches = Object.keys(s.playerBoards).filter(function(n) { return n.indexOf(arg) >= 0; });
  if (matches.length === 0) { console.log('未找到: ' + arg); process.exit(0); }
  var pn = matches[0];
  var b = s.playerBoards[pn];
  var lm = s.playerLabelMap[pn];
  console.log('\n' + pn + '  进度: ' + b.filter(function(c){return c.completed}).length + '/25');
  if (lm) console.log('标签: ' + lm.join(''));
  for (var i = 0; i < 25; i++) {
    var t = s.board[i];
    var c = b[i];
    var label = lm ? lm[i] : cl[i];
    var goal = c.goal || t.param || 1;
    var status = c.completed ? '✅' : (c.progress > 0 ? '◐' + c.progress + '/' + goal : '⬜');
    var extra = '';
    if (!c.completed && t.id === 'B14' && c.digits) {
      var ds = [];
      for (var d = 0; d <= 9; d++) ds.push(c.digits[d] ? d : '-');
      extra = ' [' + ds.join('') + ']';
    }
    console.log('  ' + label + ' ' + status + '  ' + t.desc + extra);
  }

} else if (cmd === 'task') {
  var cellIdx = cl.indexOf(arg.toUpperCase());
  if (cellIdx < 0) { console.log('无效格子: ' + arg); process.exit(0); }
  var t = s.board[cellIdx];
  console.log('\n' + arg.toUpperCase() + '  ' + t.id + '  ' + t.desc + '  目标: ' + (t.param || '-'));
  console.log('');
  var names = Object.keys(s.playerBoards).sort();
  names.forEach(function(n) {
    var c = s.playerBoards[n][cellIdx];
    var status = c.completed ? '✅' : (c.progress > 0 ? '◐' + c.progress + '/' + (c.goal||t.param||1) : '⬜');
    var extra = '';
    if (t.id === 'B14' && c.digits) {
      var ds = [];
      for (var d = 0; d <= 9; d++) ds.push(c.digits[d] ? d : '-');
      extra = ' [' + ds.join('') + ']';
    }
    console.log('  ' + n.padEnd(14) + status + extra);
  });

} else if (cmd === 'castle') {
  if (!s.castling || !s.castling.players) { console.log('无易位数据'); process.exit(0); }
  console.log('\n易位  speedUp:' + (s.castling.speedUp?'是':'否'));
  console.log('玩家'.padEnd(16) + '次数   冷却  等待');
  console.log('-'.repeat(48));
  for (var pn in s.castling.players) {
    var pd = s.castling.players[pn];
    var tb = s.playerBoards[pn] ? s.playerBoards[pn].map(function(c){return c.completed}) : [];
    var trig = core.checkTrigger(tb).triggered;
    var uses = trig ? (pd.uses + '/1') : '∞';
    var cool = pd.cooldownUntil ? (s.currentRound < pd.cooldownUntil ? 'R' + pd.cooldownUntil : '✅') : '✅';
    var pend = pd.pendingCell != null ? cl[pd.pendingCell] + '@R' + pd.pendingRound : '-';
    console.log(pn.padEnd(16) + uses.toString().padEnd(7) + cool.padEnd(6) + pend);
  }
  console.log('\n交换记录:');
  (s.castling.log || []).forEach(function(l) {
    if (l.act === 'swap') console.log('  ' + l.player + ' ' + l.from + '↔' + l.to + ' @R' + l.round);
  });

} else if (cmd === 'round') {
  var rn = parseInt(arg) || s.currentRound;
  var reportFile = path.join(season, 'round_' + rn, '结算报告.txt');
  if (fs.existsSync(reportFile)) {
    console.log(fs.readFileSync(reportFile, 'utf8'));
  } else {
    console.log('报告不存在: R' + rn);
  }

} else if (cmd === 'rank') {
  var names = Object.keys(s.playerBoards).sort();
  var scores = [];
  names.forEach(function(n) {
    var total = 0;
    if (s.history) {
      s.history.forEach(function(h, ri) {
        if (h.ranked) {
          var entry = h.ranked.find(function(r) { return r.name === n; });
          if (entry && entry.totalScore !== undefined) total += entry.totalScore;
        }
      });
    }
    scores.push({ name: n, score: total });
  });
  scores.sort(function(a, b) { return b.score - a.score; });
  console.log('\n总排名:');
  scores.forEach(function(e, i) {
    console.log((i+1).toString().padEnd(4) + e.name.padEnd(16) + e.score.toFixed(2));
  });

} else {
  console.log('未知命令: ' + cmd);
}
