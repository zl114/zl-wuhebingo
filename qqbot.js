// qqbot.js — 乌合bingo QQ查询机器人
// 依赖: npm install icqq
// 用法: node qqbot.js <赛季名> <QQ号> [密码]

var fs = require('fs');
var path = require('path');

var season = process.argv[2] || 'rS1';
var qqAccount = parseInt(process.argv[3]) || 0;
var qqPassword = process.argv[4] || '';

if (!qqAccount) {
  console.log('用法: node qqbot.js <赛季名> <QQ号> [密码]');
  console.log('  无密码时扫码登录, 有密码时密码登录');
  process.exit(1);
}

var { createClient } = require('icqq');
var client = createClient({ platform: 4 });

var core = require('./core');
var cl = 'ABCDEFGHIJKLMNOPQRSTUVWXY';

function loadState() {
  var f = path.join(__dirname, season, 'state.json');
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function fmtStatus(s) {
  var names = Object.keys(s.playerBoards).sort();
  var lines = [''];
  names.forEach(function(n) {
    var b = s.playerBoards[n];
    var done = b.filter(function(c) { return c.completed; }).length;
    var bar = '';
    for (var i = 0; i < 25; i++) bar += b[i].completed ? '\u2588' : (b[i].progress > 0 ? '\u25a7' : '\u2591');
    lines.push(n.padEnd(12, ' ') + done + '/25 ' + bar);
  });
  if (s.winner) lines.push('\n\u{1f3c6} ' + s.winner);
  return lines.join('\n');
}

function fmtPlayer(s, name) {
  var matches = Object.keys(s.playerBoards).filter(function(n) { return n.indexOf(name) >= 0; });
  if (matches.length === 0) return '未找到: ' + name;
  var pn = matches[0];
  var b = s.playerBoards[pn];
  var lm = s.playerLabelMap[pn];
  var lines = [pn + '  ' + b.filter(function(c){return c.completed}).length + '/25'];
  for (var i = 0; i < 25; i++) {
    var t = s.board[i];
    var c = b[i];
    var label = lm ? lm[i] : cl[i];
    var status = c.completed ? 'OK' : (c.progress > 0 ? '..' + c.progress : '--');
    var extra = '';
    if (t.id === 'B14' && c.digits) {
      var ds = [];
      for (var d = 0; d <= 9; d++) ds.push(c.digits[d] ? d : '-');
      extra = ' [' + ds.join('') + ']';
    }
    lines.push(label + ' ' + status + ' ' + t.desc.substring(0, 25) + extra);
  }
  return lines.join('\n');
}

function fmtTask(s, cellLetter) {
  var idx = cl.indexOf(cellLetter.toUpperCase());
  if (idx < 0) return '无效格子: ' + cellLetter;
  var t = s.board[idx];
  var lines = [cellLetter.toUpperCase() + ' ' + t.id + ' ' + t.desc];
  var names = Object.keys(s.playerBoards).sort();
  names.forEach(function(n) {
    var c = s.playerBoards[n][idx];
    var status = c.completed ? 'OK' : (c.progress > 0 ? '..' + c.progress + '/' + (c.goal||t.param||1) : '--');
    lines.push(n.padEnd(12, ' ') + status);
  });
  return lines.join('\n');
}

function fmtCastle(s) {
  if (!s.castling || !s.castling.players) return '无易位数据';
  var lines = ['speedUp:' + (s.castling.speedUp?'是':'否')];
  for (var pn in s.castling.players) {
    var pd = s.castling.players[pn];
    var tb = s.playerBoards[pn] ? s.playerBoards[pn].map(function(c){return c.completed}) : [];
    var trig = core.checkTrigger(tb).triggered;
    var uses = trig ? (pd.uses + '/1') : '\u221e';
    var cool = pd.cooldownUntil ? (s.currentRound < pd.cooldownUntil ? 'R' + pd.cooldownUntil : 'OK') : 'OK';
    var pend = pd.pendingCell != null ? cl[pd.pendingCell] + '@R' + pd.pendingRound : '-';
    lines.push(pn.padEnd(12, ' ') + uses.toString().padEnd(5) + cool.padEnd(6) + pend);
  }
  return lines.join('\n');
}

function handleCmd(text) {
  var s = loadState();
  if (!s) return '状态文件未找到';
  text = text.trim();
  var cmd = text.split(/\s+/)[0].toLowerCase();
  var arg = text.substring(cmd.length).trim();
  if (cmd === '!状态' || cmd === '!status') return fmtStatus(s);
  if (cmd === '!玩家' || cmd === '!player') return arg ? fmtPlayer(s, arg) : '用法: !玩家 <名字>';
  if (cmd === '!任务' || cmd === '!task') return arg ? fmtTask(s, arg) : '用法: !任务 <格子字母>';
  if (cmd === '!易位' || cmd === '!castle') return fmtCastle(s);
  if (cmd === '!排名' || cmd === '!rank') {
    var scores = [];
    Object.keys(s.playerBoards).sort().forEach(function(n) {
      var b = s.playerBoards[n];
      scores.push({ name: n, done: b.filter(function(c){return c.completed}).length });
    });
    scores.sort(function(a,b){return b.done - a.done});
    return scores.map(function(e,i){return (i+1)+'. '+e.name.padEnd(12,' ')+e.done+'/25'}).join('\n');
  }
  if (cmd === '!help' || cmd === '!帮助') return '命令:\n!状态 !玩家<名> !任务<格> !易位 !排名';
  return null;
}

client.on('message', function(e) {
  var text = '';
  if (e.message) {
    for (var i = 0; i < e.message.length; i++) {
      if (e.message[i].type === 'text') text += e.message[i].text;
    }
  }
  if (!text) return;
  var reply = handleCmd(text);
  if (reply) e.reply(reply, true);
});

console.log('Connecting... (platform: Android Pad)');
if (qqPassword) {
  client.login(qqAccount, qqPassword).then(function() {
    console.log('Online: ' + client.nickname + '(' + client.uin + ')');
    console.log('Send !help for commands');
  }).catch(function(err) {
    console.log('Login failed: ' + err.message);
    console.log('Try without password for QR scan');
  });
} else {
  client.login(qqAccount).then(function() {
    console.log('Online: ' + client.nickname + '(' + client.uin + ')');
    console.log('Send !help for commands');
  }).catch(function(err) {
    console.log('Login failed: ' + err.message);
    console.log('Try with password: node qqbot.js rS1 ' + qqAccount + ' <password>');
  });
}
