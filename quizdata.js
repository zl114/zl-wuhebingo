// quizdata.js — wuhebingo 专属: 腾讯问卷回收数据 查询/下载
// 用法:
//   node quizdata.js               直接查询 wuhebingo 当前问卷 (R11)
//   node quizdata.js <hash>        查询指定问卷 (备用)
//   node quizdata.js <hash> --csv  查询并直接导出 CSV 到 export/
// wuhebingo 当前问卷的腾讯问卷分享统计 hash (兜底用, 一般自动从 links.json 读取):
var DEFAULT_HASH = 'aRroKGBrPJ';
var LINKS_FILE = require('path').join(__dirname, 'zlwuhe', 'links.json');
var https = require('https');
var fs = require('fs');
var path = require('path');
var readline = require('readline');

// 动态读取 links.json 中当前问卷 (name 含"问卷"且带 stat_hash) 的统计 hash
function loadCurrentHash() {
  try {
    var links = JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8'));
    var it = (links.items || []).find(function(x) {
      return /问卷/.test(x.name || '') && x.stat_hash;
    });
    if (it && it.stat_hash) return it.stat_hash;
  } catch (e) {}
  return null;
}

var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(p) { return new Promise(function(r) {
  if (rl.closed) return r('');
  var done = false;
  function fin(v) { if (!done) { done = true; r(v); } }
  rl.question(p, fin);
  rl.once('close', function() { fin(''); });
}); }

var EXPORT_DIR = path.join(__dirname, 'export');

// ---- 请求公开 API ----
function postJson(hash, apiPath) {
  return new Promise(function(resolve, reject) {
    var body = Buffer.from('{}');
    var req = https.request({
      hostname: 'wj.qq.com',
      path: '/api/v2/share/survey/' + hash + apiPath,
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://wj.qq.com/share/survey/' + hash + '/analytics',
        'Content-Type': 'application/json',
        'Content-Length': body.length
      }
    }, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(new Error('JSON解析失败: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---- 编码: 文本题答案合并; 其它题取选中项文本 ----
// 过滤问卷编辑残留等伪影值 (如 "]" "[" 空串)
function cleanText(v) {
  v = String(v == null ? '' : v).trim();
  if (!v || v === ']' || v === '[' || v === '[]' || v === 'null' || v === 'undefined') return '';
  return v;
}
// ---- 编码: 单选/多选输出字母编码(与结算报告一致), 文本题输出原文 ----
// 选项文本形如 "A.谨慎(...)" / "B.团结(...)", 取前缀字母; 无前缀时按索引 A/B/C...
function optionCode(text, idx) {
  text = String(text == null ? '' : text);
  var m = text.match(/^\s*([A-Za-z])\s*[\.．、]/);
  if (m) return m[1].toUpperCase();
  return String.fromCharCode(65 + (idx % 26));
}
function collectAnswers(rec, qids) {
  var map = {};
  (rec.answer || []).forEach(function(page) {
    (page.questions || []).forEach(function(q) {
      if (q.type === 'text' || q.type === 'textarea') {
        map[q.id] = cleanText(q.text);
      } else {
        map[q.id] = { type: q.type, selIds: (q.options || []).filter(function(o) { return o.checked; }).map(function(o) { return o.id; }) };
      }
    });
  });
  return map;
}

// 列顺序: 优先用问卷定义(question_ids 权威顺序), 避免因部分提交缺题导致错位
function qidsOrder(recs, surveyQuestions) {
  if (surveyQuestions && surveyQuestions.length) return surveyQuestions.slice();
  var order = [];
  var seen = {};
  recs.forEach(function(rec) {
    (rec.answer || []).forEach(function(page) {
      (page.questions || []).forEach(function(q) {
        if (!seen[q.id]) { seen[q.id] = true; order.push(q); }
      });
    });
  });
  return order;
}

// ---- 显示明细 ----
function showDetail(recs, title) {
  var order = qidsOrder(recs);
  var textQ = order.filter(function(q) { return q.type === 'text' || q.type === 'textarea'; });
  console.log('\n===== ' + title + ' =====');
  console.log('回收数: ' + recs.length);
  console.log('题目数: ' + order.length + ' (文本题 ' + textQ.length + ' 道)');
  console.log('');
  recs.forEach(function(rec, i) {
    var map = collectAnswers(rec, order);
    var codes = textQ.map(function(q) { return map[q.id]; }).filter(Boolean);
    console.log(
      (i + 1) + '. ' + (rec.respondent_nickname || '(匿名)') +
      '  QQ=' + (rec.qq || '-') +
      '  编码=[' + (codes.join(',') || '无') + ']' +
      '  用时=' + rec.duration + 's' +
      '  ' + rec.ended_at
    );
  });
  return { order: order, textQ: textQ };
}

// ---- 导出 CSV ----
function exportCsv(hash, desc, recs, order) {
  try { fs.mkdirSync(EXPORT_DIR, { recursive: true }); } catch (e) {}
  var ts = new Date();
  function p2(n) { return ('0' + n).slice(-2); }
  var stamp = ts.getFullYear() + p2(ts.getMonth() + 1) + p2(ts.getDate()) + '_' + p2(ts.getHours()) + p2(ts.getMinutes()) + p2(ts.getSeconds());
  var safe = (desc || hash).replace(/[\\\/:*?"<>|]/g, '_').slice(0, 40);
  var file = path.join(EXPORT_DIR, safe + '_' + stamp + '.csv');

  function esc(v) {
    v = String(v == null ? '' : v);
    if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }
  var head = ['序号', '昵称', 'QQ', '提交时间', '用时(s)', 'IP', '城市'];
  // 表头: 单选/文本题一列; 多选按选项拆列(如 Q8.伊甸园:1 / :2 / :3), 与 example.csv 一致
  var qhead = [];
  order.forEach(function(q, i) {
    var base = 'Q' + (i + 1) + (q.title ? '.' + q.title : '');
    if (q.type === 'checkbox') {
      (q.options || []).forEach(function(o, j) { qhead.push(base + ':' + (j + 1)); });
    } else {
      qhead.push(base);
    }
  });
  var lines = [[...head, ...qhead].join(',')];
  recs.forEach(function(rec, i) {
    var map = collectAnswers(rec, order);
    var row = [
      i + 1, rec.respondent_nickname || '', rec.qq || '', rec.ended_at || '',
      rec.duration || '', rec.ip || '', rec.city || ''
    ];
    order.forEach(function(q) {
      var v = map[q.id];
      if (v == null) { row.push(''); return; }              // 该提交无此题(问卷中途编辑)
      if (typeof v === 'string') { row.push(v); return; }   // 文本题原文
      var opts = q.options || [];
      if (q.type === 'radio') {
        var selId = v.selIds[0];
        var idx = -1;
        opts.forEach(function(o, j) { if (o.id === selId) idx = j; });
        row.push(idx >= 0 ? idx + 1 : '');                  // 单选: 选项序号(1-based), 同 example.csv
      } else if (q.type === 'checkbox') {
        opts.forEach(function(o) { row.push(v.selIds.indexOf(o.id) >= 0 ? 1 : ''); });  // 多选: 每选项一列, 1/空
      }
    });
    lines.push(row.map(esc).join(','));
  });
  fs.writeFileSync(file, '\ufeff' + lines.join('\r\n'), 'utf8');
  return file;
}

// ---- 主流程 ----
async function main() {
  var args = process.argv.slice(2);
  var wantCsv = args.indexOf('--csv') >= 0;
  args = args.filter(function(a) { return a !== '--csv'; });
  var hash = args[0] || loadCurrentHash() || DEFAULT_HASH;
  var isInteractive = args.length === 0;
  if (!args[0]) console.log('当前问卷: ' + hash + ' (自动读取 links.json)');

  var survey = await postJson(hash, '');
  if (!survey.data || survey.data.collected_count === undefined) {
    console.log('查询失败: ' + JSON.stringify(survey.error || survey).slice(0, 200));
    rl.close();
    return;
  }
  var title = survey.data.title || '';
  var coll = await postJson(hash, '/collection');
  var recs = (coll.data && coll.data.data) || [];
  var order = qidsOrder(recs, (survey.data && survey.data.questions) || null);

  showDetail(recs, title);

  if (wantCsv) {
    var file = exportCsv(hash, title, recs, order);
    console.log('\n已导出: ' + file + '  (' + recs.length + ' 条)');
  } else if (isInteractive) {
    var again = await ask('\n是否导出 CSV? (y/n): ');
    if (again.toLowerCase() === 'y') {
      var file = exportCsv(hash, title, recs, order);
      console.log('已导出: ' + file + '  (' + recs.length + ' 条)');
    }
  }
  rl.close();
}

main().catch(function(e) { console.error('错误: ' + e.message); rl.close(); });
