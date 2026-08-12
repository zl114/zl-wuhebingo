// menu.js — 乌合bingo 交互菜单
var readline = require('readline');
var cp = require('child_process');
var fs = require('fs');
var path = require('path');

var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(p) { return new Promise(function(r) { rl.question(p, r); }); }

async function main() {
  console.log('===== 乌合bingo =====');
  console.log('');
  console.log('1. 初始化赛季');
  console.log('2. 回合抽题');
  console.log('3. 结算');
  console.log('4. 调试题目');
  console.log('5. 查看赛季状态');
  console.log('6. 生成任务板图片');
  console.log('7. 易位指定');
  console.log('8. 修复题目公式');
  console.log('9. 清除赛季数据');
  console.log('10. 管理玩家改名');
  console.log('11. 回退状态');
  console.log('12. 问卷数据查询/下载');
  console.log('13. 问卷满员监控');
  console.log('14. 查看结算报告');
  console.log('15. 排行榜');
  console.log('');

  var c = await ask('选择 (1-15): ');

  if (c === '1') {
    var name = await ask('赛季名: ');
    cp.execSync('node draw.js season "' + name + '"', { stdio: 'inherit', cwd: __dirname });
  } else if (c === '2') {
    var name = await ask('赛季名: ');
    var round = await ask('回合号 (默认1): ') || '1';
    cp.execSync('node draw.js round "' + name + '" ' + round, { stdio: 'inherit', cwd: __dirname });
  } else if (c === '3') {
    var name = await ask('赛季名: ');
    var round = await ask('回合号 (默认1): ') || '1';
    var csvs = [];
    try {
      fs.readdirSync(path.join(name, 'round_' + round)).forEach(function(f){
        if (f.endsWith('.csv') && !/^(example|sample)/i.test(f)) csvs.push(path.join(name, 'round_' + round, f));
      });
    } catch(e) {}
    try {
      fs.readdirSync(name).forEach(function(f){
        if (f.endsWith('.csv') && !/^(example|sample)/i.test(f)) csvs.push(path.join(name, f));
      });
    } catch(e) {}
    try {
      fs.readdirSync('.').forEach(function(f){
        if (f.endsWith('.csv') && !/^(example|sample)/i.test(f)) csvs.push(f);
      });
    } catch(e) {}
    // export 文件夹 (腾讯问卷导出下载目录)
    try {
      fs.readdirSync(path.join(__dirname, 'export')).forEach(function(f){
        if (f.endsWith('.csv') && !/^(example|sample)/i.test(f)) csvs.push(path.join(__dirname, 'export', f));
      });
    } catch(e) {}
    // 去重
    var seen = new Set();
    csvs = csvs.filter(function(p) { var k = path.basename(p); if (seen.has(k)) return false; seen.add(k); return true; });
    // 按修改时间降序 (最新导出在前)
    csvs.sort(function(a, b) {
      try { return fs.statSync(b).mtime - fs.statSync(a).mtime; } catch(e) { return 0; }
    });
    if (csvs.length === 0) { console.log('未找到CSV文件: ' + path.join(name, 'round_' + round) + ' 目录下没有 csv (已排除 example/sample 示例文件)'); console.log('请先把腾讯问卷导出的 CSV 放入该目录再结算'); rl.close(); return; }
    console.log('\n可用 CSV:');
    csvs.forEach(function(f, i) {
      var mt = '';
      try { mt = '  [' + fs.statSync(f).mtime.toLocaleString() + ']'; } catch(e) {}
      console.log('  ' + (i+1) + '. ' + path.basename(f) + '  (' + f + ')' + mt);
    });
    var sel = await ask('\n选择序号 (回车选1): ') || '1';
    var idx = parseInt(sel) - 1;
    if (isNaN(idx) || idx < 0 || idx >= csvs.length) { console.log('无效序号'); rl.close(); return; }
    try {
      cp.execFileSync(process.execPath, ['settle.js', name, round, csvs[idx]], { stdio: 'inherit', cwd: __dirname });
    } catch (e) {
      var msg = String((e.stderr && e.stderr.toString()) || e.message || '');
      if (/已有结算结果/.test(msg)) {
        var force = await ask('⚠️ 该回合已结算过。强制重结会重复抽取事件/历史，确认？(y/N): ');
        if (/^y/i.test(force.trim())) {
          cp.execFileSync(process.execPath, ['settle.js', name, round, csvs[idx], '--force'], { stdio: 'inherit', cwd: __dirname });
        } else {
          console.log('已取消，返回菜单。');
        }
      } else {
        console.log('❌ 结算失败: ' + msg.split('\n')[0]);
      }
    }
  } else if (c === '4') {
    cp.execSync('node debug.js', { stdio: 'inherit', cwd: __dirname });
  } else if (c === '5') {
    var name = await ask('赛季名: ');
    var state = JSON.parse(fs.readFileSync(path.join(name, 'state.json'), 'utf8'));
    console.log('\n赛季: ' + state.season);
    console.log('回合: ' + state.currentRound);
    console.log('已结束: ' + state.finished);
    console.log('胜者: ' + (state.winner || '无'));
    console.log('易位: ' + (state.castling && state.castling.triggered ? '已触发(' + state.castling.triggeredBy + ')' : '未触发'));
    cp.execSync('node status.js "' + name + '/state.json"', { stdio: 'inherit', cwd: __dirname });
  } else if (c === '6') {
    var name = await ask('赛季名: ');
    cp.execSync('node board.js "' + name + '/state.json"', { stdio: 'inherit', cwd: __dirname });
    console.log('浏览器打开 ' + name + '/index.html 即可查看');
  } else if (c === '7') {
    var name = await ask('赛季名: ');
    var round = await ask('回合号: ');
    var dir = path.join(name, 'round_' + round);
    var file = path.join(dir, 'castling.json');
    var existing = {};
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e) {}
    console.log('\n当前易位指定: ' + (Object.keys(existing).length ? JSON.stringify(existing) : '无'));
    console.log('格号: A=0 B=1 C=2 ... Y=24');
    var player = await ask('\n玩家名 (回车跳过): ');
    if (player) {
      var cell = await ask('格号 (0-24): ');
      if (cell) {
        existing[player] = parseInt(cell);
        try { fs.mkdirSync(dir); } catch(e) {}
        fs.writeFileSync(file, JSON.stringify(existing, null, 2), 'utf8');
        console.log('已写入: ' + file);
        console.log('请重新执行结算使易位生效');
      }
    }
  } else if (c === '8') {
    var name = await ask('赛季名: ');
    var round = await ask('回合号: ');
    cp.execSync('node repair.js "' + name + '" ' + round, { stdio: 'inherit', cwd: __dirname });
    console.log('修复完成后请重新执行结算 (菜单选项3)');
  } else if (c === '9') {
    var name = await ask('赛季名: ');
    var confirm = await ask('确定清除 ' + name + ' 的全部数据? 输入 y 确认: ');
    if (confirm.toLowerCase() === 'y') {
      cp.execSync('node reset.js "' + name + '"', { stdio: 'inherit', cwd: __dirname });
    } else {
      console.log('已取消');
    }
  } else if (c === '10') {
    var nf = path.join(__dirname, 'names.json');
    var sf = '';
    var map = {};
    try { map = JSON.parse(fs.readFileSync(nf, 'utf8')); } catch(e) {}
    console.log('\n当前全局改名表:');
    Object.entries(map).forEach(function(e) { console.log('  ' + e[0] + ' -> ' + e[1]); });
    if (Object.keys(map).length === 0) console.log('  (空)');
    console.log('\n格式: {\"CSV中的ID\":\"显示名\"}');
    var inp = await ask('\n输入新映射 (如 123=小明, 回车跳过): ');
    if (inp && inp.includes('=')) {
      var parts = inp.split('=');
      map[parts[0].trim()] = parts[1].trim();
      fs.writeFileSync(nf, JSON.stringify(map, null, 2), 'utf8');
      console.log('已保存到全局: names.json');
    }
  } else if (c === '11') {
    var name = await ask('赛季名: ');
    cp.execSync('node restore.js "' + name + '" list', { stdio: 'inherit', cwd: __dirname });
    var round = await ask('\n回退到哪个回合的备份? (输入R后面的数字): ');
    if (round) {
      var confirm = await ask('确定回退 ' + name + ' 到 R' + round + ' 的状态? (易位保留) 输入 y 确认: ');
      if (confirm.toLowerCase() === 'y') {
        cp.execSync('node restore.js "' + name + '" ' + round, { stdio: 'inherit', cwd: __dirname });
      }
    }
  } else if (c === '12') {
    cp.execSync('node quizdata.js', { stdio: 'inherit', cwd: __dirname });
  } else if (c === '13') {
    var lf = path.join(__dirname, 'zlwuhe', 'links.json');
    var links = null;
    try { links = JSON.parse(fs.readFileSync(lf, 'utf8')); } catch(e) { console.log('读取 links.json 失败: ' + e.message); rl.close(); return; }
    var qitem = (links.items || []).find(function(it) { return /问卷/.test(it.name || '') && it.stat_hash; });
    if (!qitem) { console.log('links.json 中未找到带 stat_hash 的问卷项'); rl.close(); return; }
    console.log('\n当前监控问卷: ' + qitem.name);
    console.log('链接: ' + qitem.url);
    console.log('统计hash: ' + qitem.stat_hash);
    var https = require('https');
    var body = JSON.stringify({});
    var qurl = 'https://wj.qq.com/api/v2/share/survey/' + qitem.stat_hash;
    var options = {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://wj.qq.com/share/survey/' + qitem.stat_hash + '/analytics',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    var req = https.request(qurl, options, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        try {
          var data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          var d = data.data || {};
          console.log('当前回收: ' + d.collected_count + ' 份 (' + (d.title || '未知标题') + ')');
        } catch(e) { console.log('查询失败: ' + e.message); }
        console.log('\n说明: 机器人每5分钟自动检查, 回收满12份自动提醒开对局。');
        console.log('更换新问卷: 修改 ' + lf + ' 中该问卷项的 stat_hash 即可, 机器人自动跟随。');
        rl.close();
      });
    });
    req.on('error', function(e) { console.log('查询失败: ' + e.message); rl.close(); });
    req.write(body);
    req.end();
  } else if (c === '14') {
    var name = await ask('赛季名: ');
    var round = await ask('回合号: ');
    var rp = path.join(name, 'round_' + round, '结算报告.txt');
    try {
      var txt = fs.readFileSync(rp, 'utf8');
      console.log('\n===== round_' + round + ' 结算报告 =====');
      console.log(txt);
    } catch(e) {
      console.log('未找到结算报告: ' + rp);
      var dir = path.join(name, 'round_' + round);
      try {
        console.log('目录内容: ' + fs.readdirSync(dir).join(', '));
      } catch(e2) {
        console.log('目录不存在: ' + dir);
      }
    }
  } else if (c === '15') {
    var name = await ask('赛季名 (默认S2): ') || 'S2';
    cp.execSync('node rank.js "' + name + '"', { stdio: 'inherit', cwd: __dirname });
  }

  rl.close();
}

main();
