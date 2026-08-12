// restore.js — 回退赛季状态, 保留易位记录
var fs = require('fs');
var path = require('path');

var seasonName = process.argv[2];
var round = process.argv[3];

if (!seasonName) { console.log('用法: node restore.js <赛季名> [回合号|list]'); process.exit(1); }

var statePath = path.join(seasonName, 'state.json');

if (round === 'list') {
  var files = fs.readdirSync(seasonName).filter(function(f) { return f.startsWith('state.json.R'); });
  if (files.length === 0) { console.log('没有备份文件'); process.exit(0); }
  console.log('可用备份:');
  files.sort().forEach(function(f) { console.log('  ' + f.replace('state.json.', '')); });
  process.exit(0);
}

var bakPath = round ? path.join(seasonName, 'state.json.R' + round) : path.join(seasonName, 'state.json.bak');
if (!fs.existsSync(bakPath)) { console.log('备份文件不存在: ' + bakPath); console.log('可用 node restore.js ' + seasonName + ' list 查看'); process.exit(1); }

var currentState = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
var backupState = JSON.parse(fs.readFileSync(bakPath, 'utf8'));

// 保留当前易位状态
var keepCastling = currentState.castling;
var keepPlayerBoards = currentState.playerBoards;

// 恢复历史数据
backupState.castling = keepCastling || backupState.castling;
// playerBoards: 使用回退版本, 但保留易位交换导致的格子变化
if (keepCastling && keepCastling.log) {
  // 易位未变化, 可用回退版本的playerBoards
}

fs.writeFileSync(statePath + '.tmp', JSON.stringify(backupState, null, 2), 'utf8');
try { fs.renameSync(statePath + '.tmp', statePath); } catch(e) { fs.writeFileSync(statePath, JSON.stringify(backupState, null, 2), 'utf8'); }
console.log('已回退到 ' + bakPath);
console.log('易位状态已保留');
