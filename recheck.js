// recheck.js — 清空历史, 用answer.csv重新结算所有回合
var fs = require('fs');
var path = require('path');

var seasonName = process.argv[2];
if (!seasonName) { console.log('用法: node recheck.js <赛季名>'); process.exit(1); }

var statePath = path.join(seasonName, 'state.json');
var state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

// 备份旧数据
var backup = JSON.parse(JSON.stringify(state));
state.history = [];
state.playerBoards = {};
state.playerTaskMap = {};
state.playerLabelMap = {};
state.currentRound = 0;
state.finished = false;
state.winner = null;
state.castling = { triggered: false, triggeredBy: null, triggerRound: null, speedUp: false, players: {}, log: [] };
fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
console.log('已重置状态 (保留任务板和易位)');

// 逐轮重新结算
var cp = require('child_process');
var roundDirs = fs.readdirSync(seasonName).filter(function(f) { return f.match(/^round_\d+$/); });
roundDirs.sort(function(a, b) {
  return parseInt(a.split('_')[1]) - parseInt(b.split('_')[1]);
});

roundDirs.forEach(function(rd) {
  var rn = rd.split('_')[1];
  var csvs = fs.readdirSync(path.join(seasonName, rd)).filter(function(f) { return f.endsWith('.csv'); });
  if (csvs.length === 0) return;
  var csv = path.join(seasonName, rd, csvs[0]);
  console.log('Round ' + rn + ' ...');
  try {
    cp.execSync('node settle.js ' + seasonName + ' ' + rn + ' "' + csv + '"', { stdio: 'inherit', cwd: __dirname });
  } catch (e) {
    console.log('  Round ' + rn + ' 出错:', e.message);
  }
});

console.log('\n全部重新结算完成');
var newState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
console.log('回合数:', newState.currentRound);
console.log('玩家任务完成:');
Object.entries(newState.playerBoards || {}).forEach(function(e) {
  console.log('  ' + e[0] + ': ' + e[1].filter(function(c) { return c.completed; }).length + '/25');
});
