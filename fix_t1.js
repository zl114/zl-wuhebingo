var fs = require('fs');
var core = require('./core');

var bank = core.parseJSON(fs.readFileSync('题库.json', 'utf8'));

// 从问卷.txt读取原始选项来匹配子选项公式
var surveyLines = fs.readFileSync(process.argv[2] + '/round_1/问卷.txt', 'utf8').split('\n');
var t1Options = [];
for (var i = 0; i < surveyLines.length; i++) {
  var line = surveyLines[i].trim();
  var m = line.match(/^([A-F])\.(.+)/);
  if (m) t1Options.push({ label: m[1], text: m[2] });
  if (t1Options.length === 6) break;
}

// 匹配题库中的子选项
var pools = bank.t1Pools;
var labels = 'ABCDEF';
var formulae = [];
t1Options.forEach(function(opt, i) {
  var found = false;
  for (var poolName in pools) {
    for (var sub of pools[poolName]) {
      if (sub.text.includes(opt.text) || opt.text.includes(sub.text.replace(/^[A-F]\.\s*/, ''))) {
        formulae.push({ formula: sub.formula, pool: poolName });
        found = true;
        break;
      }
    }
    if (found) break;
  }
  if (!found) console.log('WARN: not found for ' + opt.label + ' ' + opt.text);
});

// 构建T1公式
var f = '';
for (var i = 0; i < formulae.length; i++) {
  if (i === 0) {
    f += 'if(choice == ' + i + ') {\n  ' + formulae[i].formula.replace(/\n/g, '\n  ') + '\n}';
  } else {
    f += ' else {\n  if(choice == ' + i + ') {\n    ' + formulae[i].formula.replace(/\n/g, '\n    ') + '\n  }';
  }
}
f += '\n  else { 0 }';
for (var i = 1; i < formulae.length; i++) f += ' }';
f += '\n';

// 更新questions.json
var qFile = process.argv[2] + '/round_1/questions.json';
var questions = JSON.parse(fs.readFileSync(qFile, 'utf8'));
var t1 = questions[0];
t1.formula = f;
t1.options.forEach(function(opt, i) {
  if (t1Options[i]) {
    opt.text = labels[i] + '.' + t1Options[i].text;
    opt.pool = formulae[i] ? formulae[i].pool : '';
  }
});

fs.writeFileSync(qFile, JSON.stringify(questions, null, 2), 'utf8');
console.log('T1 restored from original options');
console.log('Braces:', (f.match(/\{/g) || []).length, 'open', (f.match(/\}/g) || []).length, 'close');
