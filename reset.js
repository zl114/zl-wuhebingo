// reset.js — 清除赛季数据, 恢复至刚初始化的状态
var fs = require('fs');
var path = require('path');

var seasonName = process.argv[2];
if (!seasonName) { console.log('用法: node reset.js <赛季名>'); process.exit(1); }

var statePath = path.join(seasonName, 'state.json');
var state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

// 保留任务板和赛季名, 清除其余
state.history = [];
state.playerBoards = {};
state.currentRound = 0;
state.finished = false;
state.winner = null;
state.castling = { triggered: false, triggeredBy: null, triggerRound: null, speedUp: false, players: {}, log: [] };

fs.writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2), 'utf8');
try { fs.renameSync(statePath + '.tmp', statePath); } catch(e) { fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8'); }
console.log('赛季 ' + seasonName + ' 已重置');
console.log('  任务板: 保留 (25格)');
console.log('  历史: 已清除');
console.log('  玩家进度: 已清除');
console.log('  易位: 已清除');
console.log('  回合数: 0');
