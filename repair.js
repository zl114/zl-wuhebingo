// repair.js — 用题库最新formula修复questions.json, 保留题目不变
var fs = require('fs');
var path = require('path');
var core = require('./core');

var seasonName = process.argv[2];
var roundNum = process.argv[3];
if (!seasonName || !roundNum) { console.log('用法: node repair.js <赛季名> <回合号>'); process.exit(1); }

var qFile = path.join(seasonName, 'round_' + roundNum, 'questions.json');
var bankFile = '题库.json';

var questions = JSON.parse(fs.readFileSync(qFile, 'utf8'));
var bank = core.parseJSON(fs.readFileSync(bankFile, 'utf8'));
var pool = bank.questions || [];

var fixed = 0;
questions.forEach(function(q, qi) {
  if (q.type === 'T1' || q.id === 'T1') {
    // 只修复右括号数量，不改变子选项
    // composeT1 bug: 6分支只需5层闭合(首分支自带})，多了一个}
    var open = (q.formula.match(/\{/g) || []).length;
    var close = (q.formula.match(/\}/g) || []).length;
    if (close > open) {
      // 去除末尾多余的}
      var idx = q.formula.lastIndexOf('}');
      if (idx > 0) {
        q.formula = q.formula.substring(0, idx) + q.formula.substring(idx + 1);
        fixed++;
        console.log('  Q' + (qi+1) + ' T1 经典乌合 fixed (extra } removed)');
      }
    }
    return;
  }
  // 按id匹配
  var match = pool.find(function(bq) { return bq.id === q.id; });
  // 按text匹配（去掉后缀如(T8)）
  if (!match) {
    var plainText = (q.text || '').replace(/\s*\(T\d+\)$/, '');
    match = pool.find(function(bq) { return bq.text === plainText || bq.text === q.text; });
  }
  if (match && match.formula && match.formula !== q.formula) {
    q.formula = match.formula;
    fixed++;
    console.log('  Q' + (qi+1) + ' ' + (q.text||q.id) + ' formula updated');
  }
});

fs.writeFileSync(qFile, JSON.stringify(questions, null, 2), 'utf8');
console.log('\n已修复 ' + fixed + ' 道题的公式');
console.log('请重新执行结算使任务结果更新');
