// debug.js — 乌合bingo 调试工具
// 用法: node debug.js <题号> [答案] [人数]   快捷/随机模式
//       node debug.js                       交互模式
// 人数默认从CSV读取, 未指定则默认12

var fs = require('fs');
var path = require('path');
var core = require('./core');

var args = process.argv.slice(2);
var MAX_PLAYERS = 24;

function printResults(q, raw) {
  var result = core.scoreAllQuestions([q], raw);
  console.log('\n===== 结算结果 =====');
  console.log('题目: ' + (q.text || q.title) + ' [' + q.type + ']  玩家: ' + raw.length);
  var st = result.stats[0];
  if (st && st.counts) console.log('选项分布: ' + JSON.stringify(st.counts));
  result.ranked.forEach(function(p) {
    var a = p.answers[0];
    var s = a.label || a.value || (a.labels || []).join(',') || '(空)';
    console.log('  ' + p.name.padEnd(6) + s.padEnd(16) + (p.qScores[0] || 0).toFixed(2));
  });
  console.log('');
}

function randomAnswer(q) {
  var opts = q.options || [];
  if (q.type === 'multi') {
    var minS = q.minSel || 1;
    var maxS = q.maxSel || opts.length;
    var cnt = minS + Math.floor(Math.random() * (maxS - minS + 1));
    var shuffled = opts.map(function(o){return o.label}).sort(function(){return Math.random() - 0.5});
    var picked = shuffled.slice(0, Math.min(cnt, shuffled.length));
    return { type: 'multi', label: '', labels: picked, value: '' };
  } else if (q.type === 'text') {
    var lo = q.minFill || 0;
    var hi = q.maxFill || 20;
    var v = lo + Math.floor(Math.random() * (hi - lo + 1));
    return { type: 'text', label: '', labels: [], value: String(v) };
  } else {
    var label = opts[Math.floor(Math.random() * opts.length)].label;
    return { type: 'single', label: label, labels: [], value: '' };
  }
}

// === 快捷/随机模式 ===
if (args.length >= 1) {
  var bank = core.parseJSON(fs.readFileSync(path.join(__dirname, '题库.json'), 'utf8'));
  var questions = bank.questions || [];
  var idx = parseInt(args[0]) - 1;
  if (isNaN(idx) || idx < 0 || idx >= questions.length) { console.log('无效题号'); process.exit(1); }
  var q = questions[idx];
  var count = parseInt(args[2]) || 12;

  if (args.length >= 2) {
    var answersStr = args[1];
    var parts;
    if (q.type === 'multi') {
      parts = answersStr.split(/[, ]+/).filter(function(x){return x});
    } else {
      parts = answersStr.split('');
    }
    count = Math.min(parts.length, count, MAX_PLAYERS);
    var raw = [];
    for (var i = 0; i < count; i++) {
      var seg = parts[i].toUpperCase();
      var ans;
      if (q.type === 'multi') {
        ans = { type: 'multi', label: '', labels: seg.split('').filter(function(x){return x}), value: '' };
      } else if (q.type === 'text') {
        ans = { type: 'text', label: '', labels: [], value: seg };
      } else {
        ans = { type: 'single', label: seg, labels: [], value: '' };
      }
      raw.push({ name: 'P' + (i + 1), answers: [ans] });
    }
    printResults(q, raw);
  } else {
    console.log('随机模式 — ' + (q.text || q.title) + ' [' + q.type + ']  ' + count + '人');
    var raw = [];
    for (var i = 0; i < count; i++) {
      raw.push({ name: 'P' + (i + 1), answers: [randomAnswer(q)] });
    }
    printResults(q, raw);
  }
  process.exit(0);
}

// === 交互模式 ===
var readline = require('readline');

async function main() {
  var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  function ask(p) { return new Promise(function(r) { rl.question(p, r); }); }
  try {
    console.log('===== 乌合bingo 调试工具 =====');
    var bank = core.parseJSON(fs.readFileSync(path.join(__dirname, '题库.json'), 'utf8'));
    var questions = bank.questions || [];

    questions.forEach(function(q, i) {
      console.log('  ' + (i + 1) + '. [' + (q.type || '?') + '] ' + (q.text || q.title));
    });

    var s = await ask('\n选择题号 (如 3=手动, 3r=随机): ');
    var isRandom = s.toLowerCase().endsWith('r');
    var idx = parseInt(isRandom ? s.slice(0, -1) : s) - 1;
    if (isNaN(idx) || idx < 0 || idx >= questions.length) { console.log('无效题号'); rl.close(); return; }
    var q = questions[idx];

    var nStr = await ask('人数 (默认12): ');
    var N = parseInt(nStr) || 12;
    if (N < 1) N = 1; if (N > MAX_PLAYERS) N = MAX_PLAYERS;

    if (isRandom) {
      console.log('\n随机模式 — ' + (q.text || q.title) + ' [' + q.type + ']  ' + N + '人');
      var raw = [];
      for (var i = 0; i < N; i++) {
        raw.push({ name: 'P' + (i + 1), answers: [randomAnswer(q)] });
      }
      printResults(q, raw);
      var again = await ask('再来一次? (y=回列表/n=退出/s=再随机): ');
      rl.close();
      if (again.toLowerCase() === 's') { setImmediate(function(){retryRandom(idx, N)}); return; }
      if (again.toLowerCase() === 'y') { setImmediate(main); return; }
      return;
    }

    console.log('\n' + (q.text || q.title) + '  [' + q.type + ']  ' + N + '人');
    if (q.options) q.options.forEach(function(o) { console.log('  ' + o.text); });
    console.log('\n输入' + N + '个玩家的选择 (每行一个):');

    var raw = [];
    for (var i = 0; i < N; i++) {
      var inp = (await ask('P' + (i + 1) + '/' + N + ': ')).trim();
      var ans;
      if (q.type === 'multi') {
        ans = { type: 'multi', label: '', labels: inp ? inp.toUpperCase().split(/[^A-Z0-9]/).filter(function(x){return x}) : [], value: '' };
      } else if (q.type === 'text') {
        ans = { type: 'text', label: '', labels: [], value: inp };
      } else {
        ans = { type: 'single', label: inp.toUpperCase(), labels: [], value: '' };
      }
      raw.push({ name: 'P' + (i + 1), answers: [ans] });
    }

    printResults(q, raw);

    var again = await ask('再来一次? (y=回列表/n=退出/s=同题重输/r=同题随机): ');
    rl.close();
    if (again.toLowerCase() === 'r') { setImmediate(function(){retryRandom(idx, N)}); return; }
    if (again.toLowerCase() === 's') { setImmediate(function(){retryManual(idx, N)}); return; }
    if (again.toLowerCase() === 'y') { setImmediate(main); return; }
  } catch (e) {
    console.error('错误:', e.message);
    rl.close();
  }
}

async function retryManual(qi, N) { setImmediate(function(){mainManual(qi, N)}); }
async function retryRandom(qi, N) { setImmediate(function(){mainRandom(qi, N)}); }

async function mainManual(qi, N) {
  var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  function ask(p) { return new Promise(function(r) { rl.question(p, r); }); }
  try {
    var bank = core.parseJSON(fs.readFileSync(path.join(__dirname, '题库.json'), 'utf8'));
    var q = bank.questions[qi];
    console.log('\n' + (q.text || q.title) + '  [' + q.type + ']  ' + N + '人');
    if (q.options) q.options.forEach(function(o) { console.log('  ' + o.text); });
    console.log('\n输入' + N + '个玩家的选择 (每行一个):');
    var raw = [];
    for (var i = 0; i < N; i++) {
      var inp = (await ask('P' + (i + 1) + '/' + N + ': ')).trim();
      var ans;
      if (q.type === 'multi') {
        ans = { type: 'multi', label: '', labels: inp ? inp.toUpperCase().split(/[^A-Z0-9]/).filter(function(x){return x}) : [], value: '' };
      } else if (q.type === 'text') {
        ans = { type: 'text', label: '', labels: [], value: inp };
      } else {
        ans = { type: 'single', label: inp.toUpperCase(), labels: [], value: '' };
      }
      raw.push({ name: 'P' + (i + 1), answers: [ans] });
    }
    printResults(q, raw);
    var again = await ask('再来一次? (y=回列表/n=退出/s=同题重输/r=同题随机): ');
    rl.close();
    if (again.toLowerCase() === 'r') { setImmediate(function(){retryRandom(qi, N)}); return; }
    if (again.toLowerCase() === 's') { setImmediate(function(){retryManual(qi, N)}); return; }
    if (again.toLowerCase() === 'y') { setImmediate(main); return; }
  } catch (e) {
    console.error('错误:', e.message);
    rl.close();
  }
}

async function mainRandom(qi, N) {
  var bank = core.parseJSON(fs.readFileSync(path.join(__dirname, '题库.json'), 'utf8'));
  var q = bank.questions[qi];
  console.log('\n随机模式 — ' + (q.text || q.title) + ' [' + q.type + ']  ' + N + '人');
  var raw = [];
  for (var i = 0; i < N; i++) {
    raw.push({ name: 'P' + (i + 1), answers: [randomAnswer(q)] });
  }
  printResults(q, raw);
  var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  function ask(p) { return new Promise(function(r) { rl.question(p, r); }); }
  var again = await ask('再来一次? (y=回列表/n=退出/s=再随机): ');
  rl.close();
  if (again.toLowerCase() === 's') { setImmediate(function(){retryRandom(qi, N)}); return; }
  if (again.toLowerCase() === 'y') { setImmediate(main); return; }
}

if (args.length === 0) main();
