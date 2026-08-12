// settle.js — 乌合bingo 结算程序
// 用法: node settle.js <赛季名> <回合号> <csv路径>
var fs = require('fs');
var path = require('path');
var core = require('./core');
var s2events = require('./s2events');  // S2 封印之息事件系统
var s2breath = require('./s2breath');  // S2 屏息（玩家主动技能）

var args = process.argv.slice(2);
var seasonName = args[0];
var roundNum = parseInt(args[1]) || 1;
var csvPath = args[2];

if (!seasonName || !csvPath) {
  console.log('用法: node settle.js <赛季名> <回合号> <csv路径>');
  process.exit(1);
}

var seasonDir = path.join(__dirname, seasonName);
var roundDir = path.join(seasonDir, 'round_' + roundNum);
var statePath = path.join(seasonDir, 'state.json');
var configPath = path.join(seasonDir, 'config.json');

// ===== 加载数据 =====
var state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
var config = {};
if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// ===== 幂等保护：已结算回合拒绝重复结算（防手滑；回档重结需 --force） =====
var _idem = path.join(seasonDir, 'round_' + roundNum, 'results.json');
if (fs.existsSync(_idem) && process.argv.indexOf('--force') < 0) {
  console.log('⚠️  round_' + roundNum + ' 已有结算结果（results.json 存在），拒绝重复结算！');
  console.log('   重复结算会重复抽取事件/重复记录历史，导致状态错乱。');
  console.log('   确认要重结（回档场景）请加 --force 参数：');
  console.log('   node settle.js ' + seasonName + ' ' + roundNum + ' <csv路径> --force');
  process.exit(1);
}

var questions = JSON.parse(fs.readFileSync(path.join(roundDir, 'questions.json'), 'utf8'));

// 名字映射 (global + per-season)
var nameMap = {};
var nameFile = path.join(__dirname, 'names.json');
if (fs.existsSync(nameFile)) {
  try { var nm = JSON.parse(fs.readFileSync(nameFile, 'utf8')); for (var k in nm) nameMap[k] = nm[k]; } catch (e) {}
}
var seasonNameFile = path.join(seasonDir, 'names.json');
if (fs.existsSync(seasonNameFile)) {
  try { var snm = JSON.parse(fs.readFileSync(seasonNameFile, 'utf8')); for (var k2 in snm) nameMap[k2] = snm[k2]; } catch (e) {}
}

// 颜色
var playerColors = {};
var colorsFile = path.join(seasonDir, 'colors.json');
if (fs.existsSync(colorsFile)) {
  try { playerColors = JSON.parse(fs.readFileSync(colorsFile, 'utf8')); } catch (e) {}
}

// 已知玩家列表 (从state.playerBoards)
var knownPlayers = Object.keys(state.playerBoards || {});
var allPlayerNames = knownPlayers.slice();

// ===== CSV解析 =====
function readCSVText(filePath) {
  var buf = fs.readFileSync(filePath);
  try { return buf.toString('utf8'); } catch (e) {}
  // 尝试GBK解码
  try {
    var iconv = require('iconv-lite');
    return iconv.decode(buf, 'gbk');
  } catch (e) {}
  // 简易GBK→UTF-8: 保留可读部分, 仅用于提取数字/英文答案
  var out = '';
  for (var i = 0; i < buf.length; i++) {
    var b = buf[i];
    if (b < 0x80) out += String.fromCharCode(b);
    else { i++; out += '?'; }  // 跳过GBK多字节
  }
  return out;
}

var csvText = readCSVText(csvPath);
var csvLines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(function(l) { return l.trim(); });

if (csvLines.length < 2) { console.log('CSV为空或只有表头'); process.exit(1); }

var header = core.parseCSVLine(csvLines[0]);

// 检测列: 提取questionIndex的列映射
// 格式: N.title (单选/文本), N.title:M (多选第M项), N.N. title :A.desc (变体)
var colMap = {};  // qi -> { mainCol: idx, multiCols: [{col: idx, optIdx: M-1}] }
// 确定易位题是否存在 (影响列映射)
// 确定易位/屏息题是否存在 (影响列映射)
var hasCastle = false, hasHold = false;
for (var qchk = 0; qchk < questions.length; qchk++) {
  if (questions[qchk] && questions[qchk].id === 'CASTLE') hasCastle = true;
  if (questions[qchk] && questions[qchk].id === 'HOLD') hasHold = true;
}
var qOffset = (hasCastle ? 1 : 0) + (hasHold ? 1 : 0);
var castleIdx = hasCastle ? (hasHold ? 1 : 0) : -1;

var nicknameCol = -1;

for (var ci = 0; ci < header.length; ci++) {
  var h = header[ci].trim();
  if (h === '昵称' || h.toLowerCase().indexOf('nickname') >= 0) {
    nicknameCol = ci;
    continue;
  }
  // 多选列: [Q]N.N. title :A.desc(旧格式) 或 [Q]N.N. title :M数字序号(新格式) → 提取题号 N 和选项索引
  var multiMatch = h.match(/^Q?(\d+)\.\d+\. .+?\s*:([A-H])\./);
  var multiNumMatch = h.match(/^Q?(\d+)\.\d+\. .+?\s*:(\d+)$/);
  if (multiMatch || multiNumMatch) {
    var mq = multiMatch || multiNumMatch;
    var mqi = parseInt(mq[1]) - 1;
    var aoi = multiMatch ? multiMatch[2].toUpperCase().charCodeAt(0) - 65 : (parseInt(multiNumMatch[2]) - 1);
    if (!colMap[mqi]) colMap[mqi] = { mainCol: -1, multiCols: [] };
    colMap[mqi].multiCols.push({ col: ci, optIdx: aoi });
    continue;
  }
  // 单选/填空列: [Q]N.N. title 或 [Q]N.title
  var singleMatch = h.match(/^Q?(\d+)\.\d+\. /) || h.match(/^Q?(\d+)\.(?!\d)/);
  if (singleMatch) {
    var sqi = parseInt(singleMatch[1]) - 1;
    if (!colMap[sqi]) colMap[sqi] = { mainCol: -1, multiCols: [] };
    colMap[sqi].mainCol = ci;
    continue;
  }
  // 易位列
  if (h === '易位') {
    var cqi = questions.findIndex(function(q) { return q.id === 'CASTLE'; });
    if (cqi >= 0) {
      if (!colMap[cqi]) colMap[cqi] = { mainCol: -1, multiCols: [] };
      colMap[cqi].mainCol = ci;
    }
    continue;
  }
  // 屏息列
  if (h === '屏息') {
    var hqi = questions.findIndex(function(q) { return q.id === 'HOLD'; });
    if (hqi >= 0) {
      if (!colMap[hqi]) colMap[hqi] = { mainCol: -1, multiCols: [] };
      colMap[hqi].mainCol = ci;
    }
    continue;
  }
  if (nicknameCol < 0 && (h.indexOf('昵称') >= 0 || h.toLowerCase().indexOf('name') >= 0)) {
    nicknameCol = ci;
  }
}

// 建立CSV Q索引→questions索引映射 (CSV编号已对��, 直接使用)
function csvQiToQuestionsIdx(csvQi) {
  return csvQi;
}

// ===== 解析每行数据 =====
var rawAnswers = [];  // [{name, answers:[], fillTime, absent}]
var answerTimeCol = -1;  // 答题时长列 (第4列, 0-based index 3)
var answerTimeCol2 = -1; // 开始答题时间列

// 检测答题时长列和开始答题时间列
for (var hci = 0; hci < header.length; hci++) {
  var hh = header[hci].trim();
  if (hh.indexOf('答题时长') >= 0 || hh.toLowerCase().indexOf('duration') >= 0 || hh.indexOf('用时') >= 0 || hh.indexOf('耗时') >= 0) answerTimeCol = hci;
  if (hh.indexOf('开始答题时间') >= 0 || hh.toLowerCase().indexOf('start') >= 0) answerTimeCol2 = hci;
  if (hh.indexOf('结束答题时间') >= 0 || hh.toLowerCase().indexOf('end') >= 0) answerTimeCol2 = hci;
}
// fallback: 答题时长通常是第4列(index 3) 如果头几列是编号+时间
if (answerTimeCol < 0) answerTimeCol = 3;

var absentPlayers = [];
var csvPlayerNames = [];

for (var li = 1; li < csvLines.length; li++) {
  var cols = core.parseCSVLine(csvLines[li]);
  if (cols.length < 2) continue;

  // 提取昵称
  var rawName = '';
  if (nicknameCol >= 0 && nicknameCol < cols.length) rawName = cols[nicknameCol].trim();
  // fallback: 也尝试从常见位置提取 (腾讯问卷通常在倒数位置)
  if (!rawName) {
    for (var fbi = cols.length - 1; fbi >= 0; fbi--) {
      var cv = cols[fbi].trim();
      if (cv && cv.length >= 1 && cv.length <= 20) {
        // 跳过纯数字、时间戳、IP、URL
        if (/^\d+$/.test(cv) && cv.length > 5) continue;
        if (/^\d{1,2}$/.test(cv)) continue;  // 跳过1-2位纯数字 (可能是答案)
        if (/^\d{4}[-\/]/.test(cv)) continue;  // 日期
        if (/\d+\.\d+\.\d+/.test(cv)) continue;  // IP/版本号
        if (/^http/i.test(cv)) continue;
        rawName = cv;
        break;
      }
    }
  }
  if (!rawName) rawName = 'P' + li;

  // 名字映射
  var displayName = nameMap[rawName] || rawName;
  csvPlayerNames.push(displayName);

  // 提取答题时长 (秒)
  var fillTime = 0;
  if (answerTimeCol >= 0 && answerTimeCol < cols.length) fillTime = parseInt(cols[answerTimeCol]) || 0;
  // 如果有开始/结束时间, 计算差值
  if (answerTimeCol2 >= 0 && fillTime === 0) {
    // 简单读出时长(秒)
    var durStr = (cols[answerTimeCol2] || '').replace(/[^0-9]/g, '');
    fillTime = parseInt(durStr) || 0;
  }

  // 构建答案
  var answers = [];
  for (var qi = 0; qi < questions.length; qi++) answers.push({ type: '', label: '', labels: [], value: '', same_set: 0, same_count: 0 });

  // 处理CASTLE (index 0)
  if (hasHold) {
    answers[0] = { type: 'text', label: '', labels: [], value: '', same_set: 0, same_count: 0 };
  }
  if (hasCastle) {
    answers[castleIdx] = { type: 'text', label: '', labels: [], value: '', same_set: 0, same_count: 0 };
  }

  // 遍历CSV列
  var sortedQis = Object.keys(colMap).map(Number).sort(function(a, b) { return a - b; });
  for (var si = 0; si < sortedQis.length; si++) {
    var csvQi = sortedQis[si];
    var qi = csvQiToQuestionsIdx(csvQi);
    if (qi < 0 || qi >= questions.length) continue;

    var q = questions[qi];
    var cm = colMap[csvQi];
    var type = q.type || 'single';

    if (type === 'multi') {
      var labels = [];
      // 先检查multiCols
      cm.multiCols.sort(function(a, b) { return a.optIdx - b.optIdx; });
      for (var mci = 0; mci < cm.multiCols.length; mci++) {
        var mc = cm.multiCols[mci];
        var val = (cols[mc.col] || '').trim();
        if (val === '1' || val.toLowerCase() === 'true' || val.toLowerCase() === 'yes') {
          // 映射到option label
          if (mc.optIdx < (q.options || []).length) {
            labels.push(q.options[mc.optIdx].label);
          }
        }
      }
      // 如果没有multiCols, 尝试从mainCol解析 (一些CSV把多选作单选列)
      if (cm.multiCols.length === 0 && cm.mainCol >= 0 && cm.mainCol < cols.length) {
        var mv = (cols[cm.mainCol] || '').trim();
        if (mv) labels = mv.split(/[^A-Za-z0-9]/).filter(function(x) { return x; });
      }
      answers[qi] = { type: 'multi', label: '', labels: labels, value: '', same_set: 0, same_count: 0 };
    } else if (type === 'text') {
      var tval = '';
      if (cm.mainCol >= 0 && cm.mainCol < cols.length) tval = (cols[cm.mainCol] || '').trim();
      answers[qi] = { type: 'text', label: '', labels: [], value: tval, same_set: 0, same_count: 0 };
    } else {
      // single
      var sval = '';
      if (cm.mainCol >= 0 && cm.mainCol < cols.length) sval = (cols[cm.mainCol] || '').trim();
      // 数字→字母映射: 1=A, 2=B, ...
      var label = '';
      if (/^\d+$/.test(sval)) {
        var numIdx = parseInt(sval) - 1;
        if (numIdx >= 0 && numIdx < (q.options || []).length) {
          label = q.options[numIdx].label;
        } else {
          label = sval;  // fallback
        }
      } else {
        label = sval.toUpperCase();
      }
      answers[qi] = { type: 'single', label: label, labels: [], value: '', same_set: 0, same_count: 0 };
    }
  }

  // 检查缺席 (所有非CASTLE问题答案为空)
  var allEmpty = true;
  var startQ = qOffset;
  for (var aqi = startQ; aqi < questions.length; aqi++) {
    var aq = questions[aqi];
    var ans = answers[aqi];
    var atype = aq.type || 'single';
    if (atype === 'text' && (ans.value || '').trim()) { allEmpty = false; break; }
    if (atype === 'single' && (ans.label || '').trim()) { allEmpty = false; break; }
    if (atype === 'multi' && (ans.labels || []).length > 0) { allEmpty = false; break; }
  }

  rawAnswers.push({
    name: displayName,
    answers: answers,
    fillTime: fillTime,
    absent: allEmpty
  });
}

// 已知玩家不在CSV中 → 标记为缺席
for (var kpi = 0; kpi < knownPlayers.length; kpi++) {
  var kp = knownPlayers[kpi];
  if (csvPlayerNames.indexOf(kp) < 0) {
    // 构建空答案
    var emptyAnswers = [];
    for (var eqi = 0; eqi < questions.length; eqi++) {
      var eq = questions[eqi];
      var et = eq.type || 'single';
      if (et === 'multi') emptyAnswers.push({ type: 'multi', label: '', labels: [], value: '', same_set: 0, same_count: 0 });
      else if (et === 'text') emptyAnswers.push({ type: 'text', label: '', labels: [], value: '', same_set: 0, same_count: 0 });
      else emptyAnswers.push({ type: 'single', label: '', labels: [], value: '', same_set: 0, same_count: 0 });
    }
    rawAnswers.push({
      name: kp,
      answers: emptyAnswers,
      fillTime: 0,
      absent: true
    });
    absentPlayers.push(kp);
  } else {
    // 在CSV中找到的已知玩家, 检查是否缺席
    for (var rai = 0; rai < rawAnswers.length; rai++) {
      if (rawAnswers[rai].name === kp && rawAnswers[rai].absent) {
        absentPlayers.push(kp);
      }
    }
  }
}

// 新玩家 (CSV中有但state.playerBoards中没有的)
for (var npi = 0; npi < csvPlayerNames.length; npi++) {
  var np = csvPlayerNames[npi];
  if (knownPlayers.indexOf(np) < 0) {
    knownPlayers.push(np);
    allPlayerNames.push(np);
    // 为新玩家初始化playerBoard
    if (!state.playerBoards[np]) {
      var newBoard = [];
      for (var nbi = 0; nbi < 25; nbi++) {
        var bt = state.board[nbi];
        newBoard.push({ progress: 0, completed: false, completedAt: null, goal: bt.param || 1 });
      }
      state.playerBoards[np] = newBoard;
    }
  }
}

// ===== CASTLE处理 =====
// 从castling.json读取CASTLE指定
var castlingFile = path.join(roundDir, 'castling.json');
var castlingMap = {};
var castlingMapInitial = {};
if (fs.existsSync(castlingFile)) {
  try { castlingMapInitial = JSON.parse(fs.readFileSync(castlingFile, 'utf8')); } catch (e) {}
}

// 从CSV中自动提取CASTLE答案 (如果CSV中有CASTLE相关列或questions中有CASTLE)
if (hasCastle) {
  for (var cai = 0; cai < rawAnswers.length; cai++) {
    var pName = rawAnswers[cai].name;
    var ca = rawAnswers[cai].answers[castleIdx];
    if (ca && ca.value) {
      var cvUpper = (ca.value || '').toUpperCase().trim();
      var cellLabels = 'ABCDEFGHIJKLMNOPQRSTUVWXY';
      if (cvUpper.length === 1 && cellLabels.indexOf(cvUpper) >= 0) {
        // 任务坐标: 查找该玩家当前棋盘上标签cvUpper的实际位置
        var actualPos = cellLabels.indexOf(cvUpper);
        if (state.playerLabelMap && state.playerLabelMap[pName]) {
          var lm2 = state.playerLabelMap[pName];
          for (var lmi = 0; lmi < lm2.length; lmi++) {
            if (lm2[lmi] === cvUpper) { actualPos = lmi; break; }
          }
        }
        castlingMap[pName] = actualPos;
      }
    }
  }
  // 写入castling.json (本轮的新指定)
  if (Object.keys(castlingMap).length > 0) {
    core.ensureDir(roundDir);
    fs.writeFileSync(castlingFile, JSON.stringify(castlingMap, null, 2), 'utf8');
    console.log('  [castling] 已从CSV提取CASTLE答案写入: ' + castlingFile);
  }
}

// ===== 执行两轮计分 =====
// 为CASTLE题答案填充 (从本轮castlingMap)
if (hasCastle) {
  for (var cbi = 0; cbi < rawAnswers.length; cbi++) {
    var cbName = rawAnswers[cbi].name;
    var cellIdx = castlingMap[cbName];
    if (cellIdx !== undefined && cellIdx !== null) {
      var cellLabels = 'ABCDEFGHIJKLMNOPQRSTUVWXY';
      rawAnswers[cbi].answers[castleIdx].value = cellLabels[cellIdx] || String(cellIdx);
    }
  }
}

// 过滤掉absent玩家用于计分 (absent玩家答案全空, 不应参与计分)
var scoringAnswers = rawAnswers.filter(function(r) { return !r.absent; });
var scoringResult = { ranked: [], stats: [] };
if (scoringAnswers.length > 0) {
  scoringResult = core.scoreAllQuestions(questions, scoringAnswers);
}

// 将absent玩家的结果合并回来 (排在最后)
var finalRanked = scoringResult.ranked.slice();
for (var ari = 0; ari < rawAnswers.length; ari++) {
  if (rawAnswers[ari].absent) {
    finalRanked.push({
      name: rawAnswers[ari].name,
      answers: rawAnswers[ari].answers,
      fillTime: 0,
      absent: true,
      qScores: rawAnswers[ari].answers.map(function() { return 0; }),
      totalScore: 0,
      rank: finalRanked.length + 1
    });
  }
}

// ===== 保存results.json =====
var resultsData = {
  round: roundNum,
  ranked: finalRanked,
  questions: questions,
  stats: scoringResult.stats
};
core.ensureDir(roundDir);
fs.writeFileSync(path.join(roundDir, 'results.json'), JSON.stringify(resultsData, null, 2), 'utf8');

// ===== 任务检查 =====
function checkTasks(state, seasonDir, roundNum, finalRanked, questions, absentPlayers) {
  var board = state.board;
  var playerBoards = state.playerBoards;
  var history = state.history || [];
  // 确保每位玩家都有任务映射（新玩家自动生成 = 共享任务板顺序）
  if (!state.playerTaskMap) state.playerTaskMap = {};
  for (var pni0 in state.playerBoards) {
    if (!state.playerTaskMap[pni0]) {
      state.playerTaskMap[pni0] = state.board.map(function(t) { return t.id; });
    }
  }
  var castling = state.castling || { triggered: false, triggeredBy: null, triggerRound: null, speedUp: false, players: {}, log: [] };

  // 收集历史数据用于任务检查
  // 排名历史: [{round, name, rank, totalScore, rankScore}]
  var historyRankData = [];
  for (var hi = 0; hi < history.length; hi++) {
    var he = history[hi];
    if (he && he.ranked) {
      var hrTotal = he.ranked.filter(function(r) { return !r.absent; }).length;
      for (var hri = 0; hri < he.ranked.length; hri++) {
        var hr = he.ranked[hri];
        if (!hr.absent) {
          historyRankData.push({
            round: he.round,
            name: hr.name,
            rank: hr.rank,
            totalScore: hr.totalScore || 0,
            rankScore: core.rankScore(hr.rank, hrTotal)
          });
        }
      }
    }
  }

  // 本轮排名数据
  var roundRankData = [];
  var roundTotal = finalRanked.filter(function(r) { return !r.absent; }).length;
  for (var rri = 0; rri < finalRanked.length; rri++) {
    var fr = finalRanked[rri];
    if (!fr.absent) {
      roundRankData.push({
        round: roundNum,
        name: fr.name,
        rank: fr.rank,
        totalScore: fr.totalScore || 0,
        rankScore: core.rankScore(fr.rank, roundTotal),
        qScores: fr.qScores || [],
        fillTime: fr.fillTime || 0,
        answers: fr.answers || []
      });
    }
  }

  // 按名字合并所有历史排名数据
  function playerHistory(name) {
    return historyRankData.filter(function(d) { return d.name === name; });
  }

  // 检查每个玩家的每个任务
  var roundCompletions = {};  // name → [cellLabel, ...]  本轮新完成
  var newCompletions = {};    // name → [cellIndex, ...]  本轮新完成的格子

  for (var pni = 0; pni < allPlayerNames.length; pni++) {
    var pname = allPlayerNames[pni];
    var pBoard = playerBoards[pname];
    if (!pBoard) continue;

    var pHistory = playerHistory(pname);
    var isAbsent = absentPlayers.indexOf(pname) >= 0;

    // 本轮该玩家数据
    var thisRoundData = null;
    for (var trdi = 0; trdi < roundRankData.length; trdi++) {
      if (roundRankData[trdi].name === pname) { thisRoundData = roundRankData[trdi]; break; }
    }

    if (!roundCompletions[pname]) roundCompletions[pname] = [];
    if (!newCompletions[pname]) newCompletions[pname] = [];

    for (var ti = 0; ti < 25; ti++) {
      var taskCell = pBoard[ti];
      var taskId = (state.playerTaskMap && state.playerTaskMap[pname]) ? state.playerTaskMap[pname][ti] : board[ti].id;
      var taskDef = board.find(function(b) { return b.id === taskId; }) || board[ti];

      if (taskCell.completed) continue;  // 已完成, 跳过

      var goal = taskCell.goal || taskDef.param || 1;
      var newProgress = taskCell.progress;
      var wasCompleted = false;

      // 缺席跳过大部分任务检查 (B25除外)
      if (isAbsent) {
        // 缺席跳过任务检查 (B25也一样, 缺席不算"未完成")
        if (taskId === 'B25') {}
        if (newProgress !== taskCell.progress || newProgress >= goal) {
          taskCell.progress = Math.min(newProgress, goal);
          if (taskCell.progress >= goal) {
            taskCell.completed = true;
            taskCell.completedAt = taskCell.completedAt || roundNum;
            roundCompletions[pname].push('ABCDEFGHIJKLMNOPQRSTUVWXY'[ti]);
            newCompletions[pname].push(ti);
            wasCompleted = true;
          }
        }
        continue;
      }

      // ===== 具体任务检查 =====
      var td = thisRoundData;
      var ph = pHistory;

      // --- A类任务 ---
      if (taskId === 'A01') {
        // 获得{x}次排名1
        if (td && td.rank === 1) newProgress += 1;
      } else if (taskId === 'A02') {
        // 获得{x}次排名1~3
        if (td && td.rank >= 1 && td.rank <= 3) newProgress += 1;
      } else if (taskId === 'A03') {
        // 获得{x}次排名1~6
        if (td && td.rank >= 1 && td.rank <= 6) newProgress += 1;
      } else if (taskId === 'A04') {
        // 任意连续3局排名分之和大于{x} (历史中所有连续3局窗口的最大和)
        var rsSeq = [];
        for (var ai4 = 0; ai4 < ph.length; ai4++) rsSeq.push(ph[ai4].rankScore || 0);
        if (td) rsSeq.push(td.rankScore || 0);
        var max3Sum = 0;
        if (rsSeq.length >= 3) {
          for (var wi4 = 0; wi4 <= rsSeq.length - 3; wi4++) {
            var wSum = rsSeq[wi4] + rsSeq[wi4 + 1] + rsSeq[wi4 + 2];
            if (wSum > max3Sum) max3Sum = wSum;
          }
        }
        newProgress = max3Sum;
      } else if (taskId === 'A05') {
        // 总排名分达到{x}
        var totalRS = 0;
        for (var rsi = 0; rsi < ph.length; rsi++) totalRS += ph[rsi].rankScore;
        if (td) totalRS += td.rankScore;
        newProgress = totalRS;
      } else if (taskId === 'A06') {
        // 连续{x}次排名1~6
        if (td && td.rank >= 1 && td.rank <= 6) {
          newProgress += 1;
        } else {
          newProgress = 0;
        }
      } else if (taskId === 'A07' || taskId === 'A08') {
        // T1前3高总分数 (连续/总计)
        if (td) {
          var t1aIdx = 0 + qOffset;
          var t1aScores = getQuestionScores(finalRanked, t1aIdx);
          var t1aMyScore = td.qScores && td.qScores[t1aIdx] ? td.qScores[t1aIdx] : 0;
          var t1aTop3 = getTopN(t1aScores, 3);
          if (t1aTop3.indexOf(t1aMyScore) >= 0) {
            newProgress += 1;
          } else if (taskId === 'A07') {
            newProgress = 0;  // 连续任务
          }
        }
      } else if (taskId === 'A09' || taskId === 'A10') {
        // T2前3高总分数 (连续/总计)
        if (td) {
          var t2aIdx = 1 + qOffset;
          var t2aScores = getQuestionScores(finalRanked, t2aIdx);
          var t2aMyScore = td.qScores && td.qScores[t2aIdx] ? td.qScores[t2aIdx] : 0;
          var t2aTop3 = getTopN(t2aScores, 3);
          if (t2aTop3.indexOf(t2aMyScore) >= 0) {
            newProgress += 1;
          } else if (taskId === 'A09') {
            newProgress = 0;
          }
        }
      } else if (taskId === 'A11' || taskId === 'A12') {
        // T3前3高总分数 (连续/总计)
        if (td) {
          var t3aIdx = 2 + qOffset;
          var t3aScores = getQuestionScores(finalRanked, t3aIdx);
          var t3aMyScore = td.qScores && td.qScores[t3aIdx] ? td.qScores[t3aIdx] : 0;
          var t3aTop3 = getTopN(t3aScores, 3);
          if (t3aTop3.indexOf(t3aMyScore) >= 0) {
            newProgress += 1;
          } else if (taskId === 'A11') {
            newProgress = 0;
          }
        }
      } else if (taskId === 'A13' || taskId === 'A14') {
        // T4前3高总分数 (连续/总计)
        if (td) {
          var t4aIdx = 3 + qOffset;
          var t4aScores = getQuestionScores(finalRanked, t4aIdx);
          var t4aMyScore = td.qScores && td.qScores[t4aIdx] ? td.qScores[t4aIdx] : 0;
          var t4aTop3 = getTopN(t4aScores, 3);
          if (t4aTop3.indexOf(t4aMyScore) >= 0) {
            newProgress += 1;
          } else if (taskId === 'A13') {
            newProgress = 0;
          }
        }
      } else if (taskId === 'A15' || taskId === 'A16') {
        // T5前3高总分数 (连续/总计)
        if (td) {
          var t5aIdx = 4 + qOffset;
          var t5aScores = getQuestionScores(finalRanked, t5aIdx);
          var t5aMyScore = td.qScores && td.qScores[t5aIdx] ? td.qScores[t5aIdx] : 0;
          var t5aTop3 = getTopN(t5aScores, 3);
          if (t5aTop3.indexOf(t5aMyScore) >= 0) {
            newProgress += 1;
          } else if (taskId === 'A15') {
            newProgress = 0;
          }
        }
      } else if (taskId === 'A17' || taskId === 'A18') {
        // T6前3高总分数
        if (td) {
          var t6Idx = 5 + qOffset;
          var t6Scores = getQuestionScores(finalRanked, t6Idx);
          var t6MyScore = td.qScores && td.qScores[t6Idx] ? td.qScores[t6Idx] : 0;
          var t6Top3 = getTopN(t6Scores, 3);
          if (t6Top3.indexOf(t6MyScore) >= 0) {
            newProgress += 1;
          } else if (taskId === 'A17') {
            newProgress = 0;
          }
        }
      } else if (taskId === 'A19' || taskId === 'A20') {
        // T7前3高总分数
        if (td) {
          var t7Idx = 6 + qOffset;
          var t7Scores = getQuestionScores(finalRanked, t7Idx);
          var t7MyScore = td.qScores && td.qScores[t7Idx] ? td.qScores[t7Idx] : 0;
          var t7Top3 = getTopN(t7Scores, 3);
          if (t7Top3.indexOf(t7MyScore) >= 0) {
            newProgress += 1;
          } else if (taskId === 'A19') {
            newProgress = 0;
          }
        }
      } else if (taskId === 'A21' || taskId === 'A22') {
        // T8前3高总分数
        if (td) {
          var t8Idx = 7 + qOffset;
          var t8Scores = getQuestionScores(finalRanked, t8Idx);
          var t8MyScore = td.qScores && td.qScores[t8Idx] ? td.qScores[t8Idx] : 0;
          var t8Top3 = getTopN(t8Scores, 3);
          if (t8Top3.indexOf(t8MyScore) >= 0) {
            newProgress += 1;
          } else if (taskId === 'A21') {
            newProgress = 0;
          }
        }
      } else if (taskId === 'A23' || taskId === 'A24') {
        // T9前3高总分数
        if (td) {
          var t9Idx = 8 + qOffset;
          var t9Scores = getQuestionScores(finalRanked, t9Idx);
          var t9MyScore = td.qScores && td.qScores[t9Idx] ? td.qScores[t9Idx] : 0;
          var t9Top3 = getTopN(t9Scores, 3);
          if (t9Top3.indexOf(t9MyScore) >= 0) {
            newProgress += 1;
          } else if (taskId === 'A23') {
            newProgress = 0;
          }
        }
      } else if (taskId === 'A25' || taskId === 'A26' || taskId === 'A27' || taskId === 'A28' || taskId === 'A29') {
        // T1-T5前3低总分数
        var lowQi = -1;
        if (taskId === 'A25') lowQi = 0 + qOffset;
        else if (taskId === 'A26') lowQi = 1 + qOffset;
        else if (taskId === 'A27') lowQi = 2 + qOffset;
        else if (taskId === 'A28') lowQi = 3 + qOffset;
        else if (taskId === 'A29') lowQi = 4 + qOffset;

        if (lowQi >= 0 && td) {
          var lowTS2 = getQuestionScores(finalRanked, lowQi);
          var lowMy2 = td.qScores && td.qScores[lowQi] ? td.qScores[lowQi] : 0;
          var lowBtm2 = getBottomN(lowTS2, 3);
          if (lowBtm2.indexOf(lowMy2) >= 0) {
            newProgress += 1;
          }
        }
      } else if (taskId === 'A30' || taskId === 'A31' || taskId === 'A32' || taskId === 'A33') {
        // T6-T9前3低总分数
        var lowTQi = -1;
        if (taskId === 'A30') lowTQi = 5 + qOffset;
        else if (taskId === 'A31') lowTQi = 6 + qOffset;
        else if (taskId === 'A32') lowTQi = 7 + qOffset;
        else if (taskId === 'A33') lowTQi = 8 + qOffset;

        if (lowTQi >= 0 && td) {
          var lowTScores = getQuestionScores(finalRanked, lowTQi);
          var lowTMyScore = td.qScores && td.qScores[lowTQi] ? td.qScores[lowTQi] : 0;
          var lowTBottom3 = getBottomN(lowTScores, 3);
          if (lowTBottom3.indexOf(lowTMyScore) >= 0) {
            newProgress += 1;
          }
        }
      } else if (taskId === 'A34') {
        // 获得{x}次排名4~9
        if (td && td.rank >= 4 && td.rank <= 9) newProgress += 1;
      } else if (taskId === 'A35') {
        // 获得{x}次排名7~12
        if (td && td.rank >= 7 && td.rank <= 12) newProgress += 1;
      } else if (taskId === 'A36') {
        // 获得{x}次排名12
        if (td && td.rank === 12) newProgress += 1;
      }

      // --- B类任务 ---
      else if (taskId === 'B01') {
        // 在T1中达成{x}次勇气 (勇气=E；须勇气选项生效：选E且该题正分)
        if (td) {
          var t1Q = questions[0 + qOffset];
          var t1Ans = td.answers && td.answers[0 + qOffset];
          var t1Score = (td.qScores && td.qScores[0 + qOffset]) || 0;
          if (t1Ans && t1Ans.label === 'E' && t1Score > 0) newProgress += 1;
        }
      } else if (taskId === 'B02') {
        // 在T1中独享过公正（仅你一人选择公正选项）
        // 公正=C (选项2)
        if (td) {
          var t1q2 = questions[0 + qOffset];
          var t1a2 = td.answers && td.answers[0 + qOffset];
          if (t1a2 && t1a2.label === 'C') {
            var cCount = 0;
            for (var rj = 0; rj < finalRanked.length; rj++) {
              if (finalRanked[rj].absent) continue;
              var ra = finalRanked[rj].answers && finalRanked[rj].answers[0 + qOffset];
              if (ra && ra.label === 'C') cCount++;
            }
            if (cCount === 1) newProgress = 1;  // 独享
          }
        }
      } else if (taskId === 'B03') {
        // 单回合T2~T5全部获得前三高的分数
        if (td) {
          var allHigh3 = true;
          for (var bqi3h = 1; bqi3h <= 4; bqi3h++) {
            var qi3h = bqi3h + qOffset;
            var s3h = getQuestionScores(finalRanked, qi3h);
            var my3h = td.qScores && td.qScores[qi3h] ? td.qScores[qi3h] : 0;
            if (s3h.length === 0 || getTopN(s3h, 3).indexOf(my3h) < 0) { allHigh3 = false; break; }
          }
          if (allHigh3) newProgress = 1;
        }
      } else if (taskId === 'B04') {
        // 单回合T2~T5全部获得前三低的分数
        if (td) {
          var allLow3 = true;
          for (var bqi3l = 1; bqi3l <= 4; bqi3l++) {
            var qi3l = bqi3l + qOffset;
            var s3l = getQuestionScores(finalRanked, qi3l);
            var my3l = td.qScores && td.qScores[qi3l] ? td.qScores[qi3l] : 0;
            if (s3l.length === 0 || getBottomN(s3l, 3).indexOf(my3l) < 0) { allLow3 = false; break; }
          }
          if (allLow3) newProgress = 1;
        }
      } else if (taskId === 'B05') {
        // 单回合T2~T5全部未选中得分最低或最高项
        if (td) {
          var allMid = true;
          for (var bqi3 = 1; bqi3 <= 4; bqi3++) {
            var qi4 = bqi3 + qOffset;
            var bestLabels2 = getQuestionBestLabels(questions, finalRanked, qi4);
            var worstLabels2 = getQuestionWorstLabels(questions, finalRanked, qi4);
            var pc3 = getPlayerChoice(td, qi4, questions);
            if (bestLabels2.indexOf(pc3) >= 0 || worstLabels2.indexOf(pc3) >= 0) { allMid = false; break; }
          }
          if (allMid) newProgress = 1;
        }
      } else if (taskId === 'B06') {
        // 单回合T1~T5完全选同一选项且最终排名1~6
        if (td && td.rank >= 1 && td.rank <= 6) {
          var allSame = true;
          var firstLabel = null;
          for (var bqi4 = 0; bqi4 <= 4; bqi4++) {
            var qi5 = bqi4 + qOffset;
            var q5 = questions[qi5];
            if (q5.type !== 'single') continue;  // T1-T5都是single
            var al = (td.answers && td.answers[qi5]) ? td.answers[qi5].label : '';
            if (firstLabel === null) firstLabel = al;
            else if (al !== firstLabel) { allSame = false; break; }
          }
          if (allSame && firstLabel) newProgress = 1;
        }
      } else if (taskId === 'B07') {
        // 单回合T1~T5完全选不同选项且最终排名1~6
        if (td && td.rank >= 1 && td.rank <= 6) {
          var allDiff = true;
          var seenLabels = {};
          for (var bqi5 = 0; bqi5 <= 4; bqi5++) {
            var qi6 = bqi5 + qOffset;
            var q6 = questions[qi6];
            if (q6.type !== 'single') continue;
            var al2 = (td.answers && td.answers[qi6]) ? td.answers[qi6].label : '';
            if (al2 && seenLabels[al2]) { allDiff = false; break; }
            if (al2) seenLabels[al2] = true;
          }
          if (allDiff) newProgress = 1;
        }
      } else if (taskId === 'B08') {
        // 累计选择{x}个A选项（含多选）
        if (td) {
          var aCount = countOptionSelections(td, questions, qOffset, 'A');
          newProgress += aCount;
        }
      } else if (taskId === 'B09') {
        if (td) {
          var bCount = countOptionSelections(td, questions, qOffset, 'B');
          newProgress += bCount;
        }
      } else if (taskId === 'B10') {
        if (td) {
          var cCount = countOptionSelections(td, questions, qOffset, 'C');
          newProgress += cCount;
        }
      } else if (taskId === 'B11') {
        if (td) {
          var dCount = countOptionSelections(td, questions, qOffset, 'D');
          newProgress += dCount;
        }
      } else if (taskId === 'B12') {
        // 累计获得{x}次单题最低分
        if (td && td.qScores) {
          var lowCount = 0;
          for (var bqi6 = 0; bqi6 < questions.length; bqi6++) {
            if (questions[bqi6].id === 'CASTLE') continue;
            var allScores = getQuestionScores(finalRanked, bqi6);
            var myS = td.qScores[bqi6] || 0;
            if (allScores.length > 0 && myS === Math.min.apply(null, allScores)) {
              lowCount++;
            }
          }
          newProgress += lowCount;
        }
      } else if (taskId === 'B13') {
        // 某回合你的作答与另一玩家至少完全重合{x}题
        // x 是条件阈值(param, 加权抽定)，达成当回合即完成 → 完成目标固定为 1
        var thresh13 = (taskDef && taskDef.param != null) ? taskDef.param : 4;
        if (taskCell.goal !== 1) taskCell.goal = 1;
        goal = 1;
        if (td && td.answers) {
          var maxOverlap = 0;
          for (var rj2 = 0; rj2 < finalRanked.length; rj2++) {
            if (finalRanked[rj2].name === pname || finalRanked[rj2].absent) continue;
            var overlap = countAnswerOverlap(td.answers, finalRanked[rj2].answers, questions, qOffset);
            if (overlap > maxOverlap) maxOverlap = overlap;
          }
          if (maxOverlap >= thresh13) newProgress = Math.max(newProgress, 1);
        }
      } else if (taskId === 'B14') {
        // 在T6回答过所有一位数答案 (0-9所有数字)
        goal = 10;
        taskCell.goal = 10;
        if (td) {
          var t6qIdx = 5 + qOffset;
          if (td.answers && td.answers[t6qIdx]) {
            var t6v = (td.answers[t6qIdx].value || '').trim();
            if (t6v && /^\d$/.test(t6v)) {
              // 累积记录出现的数字
              var digit = parseInt(t6v);
              if (!taskCell.digits) taskCell.digits = {};
              taskCell.digits[digit] = true;
              var digitCount = Object.keys(taskCell.digits).length;
              newProgress = digitCount;
            }
          }
        }
      } else if (taskId === 'B15') {
        // 单回合T7~T9选择项数完全相同且排名1~6
        if (td && td.rank >= 1 && td.rank <= 6) {
          var t7a = td.answers && td.answers[6 + qOffset] ? (td.answers[6 + qOffset].labels || []).length : 0;
          var t8a = td.answers && td.answers[7 + qOffset] ? (td.answers[7 + qOffset].labels || []).length : 0;
          var t9a = td.answers && td.answers[8 + qOffset] ? (td.answers[8 + qOffset].labels || []).length : 0;
          if (t7a > 0 && t7a === t8a && t8a === t9a) newProgress = 1;
        }
      } else if (taskId === 'B16') {
        // 单回合T7~T9选择项数完全不同且排名1~6
        if (td && td.rank >= 1 && td.rank <= 6) {
          var t7a2 = td.answers && td.answers[6 + qOffset] ? (td.answers[6 + qOffset].labels || []).length : 0;
          var t8a2 = td.answers && td.answers[7 + qOffset] ? (td.answers[7 + qOffset].labels || []).length : 0;
          var t9a2 = td.answers && td.answers[8 + qOffset] ? (td.answers[8 + qOffset].labels || []).length : 0;
          if (t7a2 !== t8a2 && t8a2 !== t9a2 && t7a2 !== t9a2) newProgress = 1;
        }
      } else if (taskId === 'B17') {
        // 连续3次在除T10外某题获得最高分 (强制param=3)
        goal = 3;
        taskCell.goal = 3;
        if (td && td.qScores) {
          var gotBest = false;
          for (var bqi7 = 0; bqi7 < questions.length; bqi7++) {
            if (questions[bqi7].id === 'T10' || questions[bqi7].id === 'CASTLE') continue;
            var allS = getQuestionScores(finalRanked, bqi7);
            var myS2 = td.qScores[bqi7] || 0;
            if (allS.length > 0 && myS2 === Math.max.apply(null, allS)) {
              gotBest = true;
              break;
            }
          }
          if (gotBest) newProgress += 1;
          else newProgress = 0;
        }
      } else if (taskId === 'B18') {
        // 连续3次在除T10外某题获得最低分 (强制param=3)
        goal = 3;
        taskCell.goal = 3;
        if (td && td.qScores) {
          var gotWorst = false;
          for (var bqi8 = 0; bqi8 < questions.length; bqi8++) {
            if (questions[bqi8].id === 'T10' || questions[bqi8].id === 'CASTLE') continue;
            var allS2 = getQuestionScores(finalRanked, bqi8);
            var myS3 = td.qScores[bqi8] || 0;
            if (allS2.length > 0 && myS3 === Math.min.apply(null, allS2)) {
              gotWorst = true;
              break;
            }
          }
          if (gotWorst) newProgress += 1;
          else newProgress = 0;
        }
      } else if (taskId === 'B19') {
        // 选择了T10的B选项并成功触发条件 (T10 B: rank==1 → score归零, 即条件触发)
        if (td) {
          var t10Idx = 9 + qOffset;
          var t10Ans = td.answers && td.answers[t10Idx];
          if (t10Ans && t10Ans.label === 'B' && td.qScores && td.qScores[t10Idx] < 0) {
            newProgress = 1;
          }
        }
      } else if (taskId === 'B20') {
        // T7~T9某题仅选1个选项且在该题的得分前三高
        if (td) {
          var found = false;
          for (var mqi = 6; mqi <= 8; mqi++) {
            var qi7 = mqi + qOffset;
            var ma = td.answers && td.answers[qi7];
            if (ma && (ma.labels || []).length === 1) {
              var mScores = getQuestionScores(finalRanked, qi7);
              var mMy = td.qScores && td.qScores[qi7] ? td.qScores[qi7] : 0;
              var mTop3 = getTopN(mScores, 3);
              if (mTop3.indexOf(mMy) >= 0) { found = true; break; }
            }
          }
          if (found) newProgress = 1;
        }
      } else if (taskId === 'B21') {
        // T7~T9某题仅选1个选项且在该题的得分前三低
        if (td) {
          var found2 = false;
          for (var mqi2 = 6; mqi2 <= 8; mqi2++) {
            var qi8 = mqi2 + qOffset;
            var ma2 = td.answers && td.answers[qi8];
            if (ma2 && (ma2.labels || []).length === 1) {
              var mScores2 = getQuestionScores(finalRanked, qi8);
              var mMy2 = td.qScores && td.qScores[qi8] ? td.qScores[qi8] : 0;
              var mBot3 = getBottomN(mScores2, 3);
              if (mBot3.indexOf(mMy2) >= 0) { found2 = true; break; }
            }
          }
          if (found2) newProgress = 1;
        }
      } else if (taskId === 'B22') {
        // 单回合所有题目均未选中人数最多项
        if (td) {
          var allNotMax = true;
          for (var bqi9 = 0; bqi9 < questions.length; bqi9++) {
            var q9 = questions[bqi9];
            if (q9.id === 'CASTLE' || q9.type === 'text') continue;
            var maxLabel = getMaxCountLabel(finalRanked, bqi9, questions);
            if (!maxLabel) continue;
            var pa = td.answers && td.answers[bqi9];
            if (!pa) continue;
            if (q9.type === 'single' && pa.label === maxLabel) { allNotMax = false; break; }
            if (q9.type === 'multi' && (pa.labels || []).indexOf(maxLabel) >= 0) { allNotMax = false; break; }
          }
          if (allNotMax) newProgress = 1;
        }
      } else if (taskId === 'B23') {
        // 在某题拿到最多分数且比次多至少多5分
        if (td && td.qScores) {
          var found3 = false;
          for (var bqi10 = 0; bqi10 < questions.length; bqi10++) {
            if (questions[bqi10].id === 'CASTLE') continue;
            var allS3 = getQuestionScores(finalRanked, bqi10);
            var myS4 = td.qScores[bqi10] || 0;
            if (allS3.length >= 2) {
              var sortedS = allS3.slice().sort(function(a, b) { return b - a; });
              if (myS4 === sortedS[0] && myS4 - sortedS[1] >= 5) { found3 = true; break; }
            }
          }
          if (found3) newProgress = 1;
        }
      } else if (taskId === 'B24') {
        // 单回合所有题目均未获得恰好0分
        if (td && td.qScores) {
          var noZero = true;
          for (var bqi11 = 0; bqi11 < questions.length; bqi11++) {
            if (questions[bqi11].id === 'CASTLE') continue;
            if (td.qScores[bqi11] === 0) { noZero = false; break; }
          }
          if (noZero) newProgress = 1;
        }
      } else if (taskId === 'B25') {
        // 某回合未完成任何未完成任务 (B25最后检查, 排除自己格子, 跳过缺席)
        // B25在中立检查, 稍后统一处理
      } else if (taskId === 'B26') {
        // 问卷填写时间前三
        if (td) {
          var times = [];
          for (var fti = 0; fti < finalRanked.length; fti++) {
            if (!finalRanked[fti].absent && finalRanked[fti].fillTime > 0) {
              times.push(finalRanked[fti].fillTime);
            }
          }
          times.sort(function(a, b) { return a - b; });
          if (td.fillTime > 0 && times.length >= 3 && td.fillTime <= times[2]) {
            newProgress = 1;
          }
        }
      } else if (taskId === 'B27') {
        // 某回合分数绝对值小于3
        if (td && Math.abs(td.totalScore) < 3) newProgress = 1;
      } else if (taskId === 'B28') {
        // T3~T9任一题结算后排名9~12, 最终排名1~3
        // 简化: 检查当前回合整体情况
        if (td && td.rank >= 1 && td.rank <= 3) {
          // 检查是否有中间排名为9-12 (需要逐题检查)
          // 简化处理: 如果当前排名1-3 且总人数>=9, 则可能触发
          var totalActive = 0;
          for (var raci = 0; raci < finalRanked.length; raci++) {
            if (!finalRanked[raci].absent) totalActive++;
          }
          if (totalActive >= 9) newProgress = 1;
        }
      } else if (taskId === 'B29') {
        // 累计{x}个回合得分取两位小数(向下取整)包含7
        if (td) {
          var floorScore = Math.floor(td.totalScore * 100) / 100;
          if (String(floorScore).indexOf('7') >= 0) newProgress += 1;
        }
      } else if (taskId === 'B30') {
        // T10选B最终排名1
        if (td) {
          var t10Idx2 = 9 + qOffset;
          var t10Ans2 = td.answers && td.answers[t10Idx2];
          if (t10Ans2 && t10Ans2.label === 'B' && td.rank === 1) {
            newProgress = 1;
          }
        }
      } else if (taskId === 'B31') {
        // 全收集第1~4/5~8/9~12区间之一内所有名次
        var rankSet31 = {};
        for (var b31i = 0; b31i < ph.length; b31i++) {
          var hr31 = ph[b31i].rank;
          if (hr31 >= 1 && hr31 <= 12) rankSet31[hr31] = true;
        }
        if (td && td.rank >= 1 && td.rank <= 12) rankSet31[td.rank] = true;
        var ranges31 = [[1, 4], [5, 8], [9, 12]];
        var full31 = false;
        for (var b31r = 0; b31r < ranges31.length; b31r++) {
          var ok31 = true;
          for (var b31v = ranges31[b31r][0]; b31v <= ranges31[b31r][1]; b31v++) {
            if (!rankSet31[b31v]) { ok31 = false; break; }
          }
          if (ok31) { full31 = true; break; }
        }
        if (full31) newProgress = 1;
      } else if (taskId === 'B32') {
        // 全收集第3n+k某一k(0~2)取值范围内所有名次 (k=0:{3,6,9,12} k=1:{1,4,7,10} k=2:{2,5,8,11})
        var rankSet32 = {};
        for (var b32i = 0; b32i < ph.length; b32i++) {
          var hr32 = ph[b32i].rank;
          if (hr32 >= 1 && hr32 <= 12) rankSet32[hr32] = true;
        }
        if (td && td.rank >= 1 && td.rank <= 12) rankSet32[td.rank] = true;
        var full32 = false;
        for (var b32k = 0; b32k <= 2; b32k++) {
          var ok32 = true;
          for (var b32v = (b32k === 0 ? 3 : b32k); b32v <= 12; b32v += 3) {
            if (!rankSet32[b32v]) { ok32 = false; break; }
          }
          if (ok32) { full32 = true; break; }
        }
        if (full32) newProgress = 1;
      } else if (taskId === 'B33') {
        // 全收集第4n+k某一k(0~3)取值范围内所有名次 (k=0:{4,8,12} k=1:{1,5,9} k=2:{2,6,10} k=3:{3,7,11})
        var rankSet33 = {};
        for (var b33i = 0; b33i < ph.length; b33i++) {
          var hr33 = ph[b33i].rank;
          if (hr33 >= 1 && hr33 <= 12) rankSet33[hr33] = true;
        }
        if (td && td.rank >= 1 && td.rank <= 12) rankSet33[td.rank] = true;
        var full33 = false;
        for (var b33k = 0; b33k <= 3; b33k++) {
          var ok33 = true;
          for (var b33v = (b33k === 0 ? 4 : b33k); b33v <= 12; b33v += 4) {
            if (!rankSet33[b33v]) { ok33 = false; break; }
          }
          if (ok33) { full33 = true; break; }
        }
        if (full33) newProgress = 1;
      } else if (taskId === 'B34') {
        // 答题时间<=120s且获得前三
        if (td && td.fillTime > 0 && td.fillTime <= 120 && td.rank >= 1 && td.rank <= 3) {
          newProgress = 1;
        }
      }

      // 更新progress
      if (newProgress !== taskCell.progress || (goal > 0 && newProgress >= goal && !taskCell.completed)) {
        taskCell.progress = Math.min(newProgress, goal > 0 ? goal : newProgress);
        if (taskCell.progress >= goal && goal > 0) {
          taskCell.completed = true;
          taskCell.completedAt = taskCell.completedAt || roundNum;
          roundCompletions[pname].push('ABCDEFGHIJKLMNOPQRSTUVWXY'[ti]);
          newCompletions[pname].push(ti);
          wasCompleted = true;
        }
      }
    } // end for each task
  } // end for each player

  // ===== B25检查 (最后执行: 本回合未完成任何未完成任务) =====
  for (var pni2 = 0; pni2 < allPlayerNames.length; pni2++) {
    var pname2 = allPlayerNames[pni2];
    var pBoard2 = playerBoards[pname2];
    if (!pBoard2) continue;
    var isAbsent2 = absentPlayers.indexOf(pname2) >= 0;

    // B25: 跳过absent回合
    if (isAbsent2) continue;

    var b25Idx = -1;
    for (var bti = 0; bti < 25; bti++) {
      if (board[bti].id === 'B25') { b25Idx = bti; break; }
    }
    if (b25Idx < 0) continue;

    var b25Cell = pBoard2[b25Idx];
    if (b25Cell.completed) continue;

    // 检查本轮是否完成了任何"其他"格子 (排除B25自己)
    var completedOthersThisRound = false;
    for (var oti = 0; oti < 25; oti++) {
      if (oti === b25Idx) continue;  // 排除自己
      var oc = pBoard2[oti];
      if (oc.completed && oc.completedAt === roundNum) {
        completedOthersThisRound = true;
        break;
      }
    }

    if (!completedOthersThisRound) {
      b25Cell.progress = (b25Cell.progress || 0) + 1;
      if (!b25Cell.goal) b25Cell.goal = 1;
      if (b25Cell.progress >= (b25Cell.goal || 1)) {
        b25Cell.completed = true;
        b25Cell.completedAt = b25Cell.completedAt || roundNum;
        if (!roundCompletions[pname2]) roundCompletions[pname2] = [];
        if (!newCompletions[pname2]) newCompletions[pname2] = [];
        roundCompletions[pname2].push('ABCDEFGHIJKLMNOPQRSTUVWXY'[b25Idx]);
        newCompletions[pname2].push(b25Idx);
      }
    }
  }

  // ===== 易位处理 =====
  var castlingConfig = config.castling !== false;
  var cellLabels = 'ABCDEFGHIJKLMNOPQRSTUVWXY';

  function seededRand(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return function() { h = (h * 1103515245 + 12345) | 0; return (h >>> 0) / 4294967296; };
  }

  // 辅助: 获取玩家可见的标签 (而非网格字母)
  function playerLabel(ppn, pos) {
    var lm = state.playerLabelMap[ppn];
    return lm ? lm[pos] : cellLabels[pos];
  }

  // 易位触发检测 (必须在spec处理前, 确保触发者uses从0开始)
  if (castlingConfig && !castling.triggered) {
    for (var tp2 in state.playerBoards) {
      if (!state.playerBoards.hasOwnProperty(tp2)) continue;
      var tpb = state.playerBoards[tp2];
      var tbool = tpb.map(function(c) { return c.completed; });
      var trig = core.checkTrigger(tbool);
      if (trig.triggered) {
        castling.triggered = true;
        castling.triggeredBy = tp2;
        castling.triggerRound = roundNum;
        console.log('  [castling] TRIGGERED by ' + tp2 + ' (' + trig.type + ')');
        break;
      }
    }
  }

  // 处理新的CASTLE指定
  if (castlingConfig && Object.keys(castlingMap).length > 0) {
    for (var pn in castlingMap) {
      if (!castlingMap.hasOwnProperty(pn)) continue;
      var targetCell = castlingMap[pn];
      if (targetCell === null || targetCell === undefined) continue;
      if (typeof targetCell !== 'number') targetCell = parseInt(targetCell);
      if (isNaN(targetCell) || targetCell < 0 || targetCell >= 25) continue;

      if (!castling.players) castling.players = {};
      var cp = castling.players[pn];
      var maxUses = 1;
      if (cp) {
        if (cp.cooldownUntil && cp.cooldownUntil > roundNum) continue;
        if (cp.uses >= (cp.maxUses || maxUses)) continue;
      }

      if (!castling.players[pn]) {
        castling.players[pn] = { uses: 0, maxUses: 999, cooldownUntil: 0, pendingCell: null, pendingRound: null, swapTarget: null };
      }
      castling.players[pn].pendingCell = targetCell;
      castling.players[pn].pendingRound = roundNum;
      castling.players[pn].uses = (castling.players[pn].uses || 0) + 1;
      castling.players[pn].cooldownUntil = roundNum + (castling.speedUp ? 2 : 3);
      var pbCheck = playerBoards[pn] || [];
      if (pn === castling.triggeredBy || core.checkTrigger(pbCheck.map(function(c){return c.completed})).triggered) {
        castling.players[pn].maxUses = 1;
      }
      if (!castling.log) castling.log = [];
      castling.log.push({act: "spec", player: pn, round: roundNum, cell: playerLabel(pn, targetCell)});
      console.log("  [castling] " + pn + " pending " + cellLabels[targetCell] + " (R" + (roundNum+3) + " check)");
    }
  }

  // 待处理检查和交换 (始终执行)
  if (castlingConfig) {
    if (!state.playerTaskMap) state.playerTaskMap = {};
    if (!state.playerLabelMap) state.playerLabelMap = {};
    var cellLabels = 'ABCDEFGHIJKLMNOPQRSTUVWXY';

    // 辅助: 获取玩家可见的标签 (而非网格字母)
    function playerLabel(ppn, pos) {
      var lm = state.playerLabelMap[ppn];
      return lm ? lm[pos] : cellLabels[pos];
    }

    // 加载交换覆盖记录 (回档后维持交换目标)
    var swapOverridesFile = path.join(__dirname, 'zlwuhe', 'swaps.json');
    var swapOverrides = {};
    if (fs.existsSync(swapOverridesFile)) {
      try { swapOverrides = JSON.parse(fs.readFileSync(swapOverridesFile, 'utf8')); } catch(e) {}
    }

    // 种子码: 用于确定易位交换
    if (!castling.seed) castling.seed = state.season + '_' + roundNum;
    var swapSeed = castling.seed + '_swap';
    var swapRand = seededRand(swapSeed);

    // 加速检测: >=3人触发则冷却缩短 (必须在pending处理前)
    if (!castling.speedUp && castling.triggered) {
      var trigCnt3 = 0;
      for (var tk3 in state.playerBoards) {
        if (!state.playerBoards.hasOwnProperty(tk3)) continue;
        if (core.checkTrigger(state.playerBoards[tk3].map(function(c) { return c.completed; })).triggered) trigCnt3++;
      }
      if (trigCnt3 >= 3) {
        castling.speedUp = true;
      }
    }

    // 处理到期的pending
    var dur = (castling.speedUp ? 2 : 3) - 1; // 指定轮算第1轮, R+2后检查
    for (var ppn in castling.players) {
      if (!castling.players.hasOwnProperty(ppn)) continue;
      var ppd = castling.players[ppn];
      if (ppd.pendingCell === null || ppd.pendingCell === undefined) continue;
      if ((roundNum - ppd.pendingRound) < dur) continue;
      var ppb = playerBoards[ppn];
      if (!ppb) continue;
      if (ppb[ppd.pendingCell] && ppb[ppd.pendingCell].completed) {
        castling.log.push({act: "complete", player: ppn, round: roundNum, cell: playerLabel(ppn, ppd.pendingCell)});
      } else {
        var sw = null;
        // 检查是否有交换覆盖记录
        var overrideKey = ppn + '|' + playerLabel(ppn, ppd.pendingCell) + '|' + ppd.pendingRound;
        var overrideLabel = swapOverrides[overrideKey];
        if (overrideLabel === undefined) {
          // fallback: 旧格式 key (不带 round)
          var oldKey = ppn + '|' + playerLabel(ppn, ppd.pendingCell);
          overrideLabel = swapOverrides[oldKey];
        }
        if (overrideLabel !== undefined) {
          // 在玩家当前标签映射中查找目标标签的实际位置
          var playerLM = state.playerLabelMap[ppn];
          var overridePos = -1;
          if (playerLM) {
            overridePos = playerLM.indexOf(overrideLabel);
          }
          if (overridePos < 0) overridePos = cellLabels.indexOf(overrideLabel);
          if (overridePos >= 0 && overridePos !== ppd.pendingCell) {
            sw = overridePos;
            console.log('  [castling] ' + ppn + ' swap (override) ' + playerLabel(ppn, ppd.pendingCell) + ' <-> ' + overrideLabel);
          }
        }
        if (sw === null) {
          var u2 = [];
          for (var ri = 0; ri < 25; ri++) if (!ppb[ri].completed && ri !== ppd.pendingCell) u2.push(ri);
          if (u2.length >= 1) sw = u2[Math.floor(swapRand() * u2.length)];
        }
        if (sw !== null && sw !== undefined) {
          // 保存交换覆盖 (含回合号)
          swapOverrides[overrideKey] = cellLabels[sw];
          core.ensureDir(path.dirname(swapOverridesFile));
          fs.writeFileSync(swapOverridesFile, JSON.stringify(swapOverrides, null, 2), 'utf8');
          var fromLabel = playerLabel(ppn, ppd.pendingCell);
          var toLabel = playerLabel(ppn, sw);
          var tmp = ppb[ppd.pendingCell]; ppb[ppd.pendingCell] = ppb[sw]; ppb[sw] = tmp;
          // 同步交换该玩家的任务位置和标签
          if (!state.playerTaskMap[ppn]) state.playerTaskMap[ppn] = state.board.map(function(t) { return t.id; });
          if (!state.playerLabelMap[ppn]) state.playerLabelMap[ppn] = cellLabels.split('');
          var tt = state.playerTaskMap[ppn][ppd.pendingCell];
          state.playerTaskMap[ppn][ppd.pendingCell] = state.playerTaskMap[ppn][sw];
          state.playerTaskMap[ppn][sw] = tt;
          var tl = state.playerLabelMap[ppn][ppd.pendingCell];
          state.playerLabelMap[ppn][ppd.pendingCell] = state.playerLabelMap[ppn][sw];
          state.playerLabelMap[ppn][sw] = tl;
          castling.log.push({act: "swap", player: ppn, round: roundNum, from: fromLabel, to: toLabel});
        }
      }
      ppd.pendingCell = null;
      ppd.pendingRound = null;
      ppd.cooldownUntil = roundNum;
    }

    // 更新castling (冷却递减等)
    if (castling.players) {
      for (var cpn in castling.players) {
        if (!castling.players.hasOwnProperty(cpn)) continue;
        if (castling.players[cpn].cooldown > 0) castling.players[cpn].cooldown--;
      }
    }
  }

  // 更新触发者的maxUses (在spec处理之后, 同轮spec一并免除)
  if (castling.triggered && castling.players) {
    for (var tpn2 in state.playerBoards) {
      if (!state.playerBoards.hasOwnProperty(tpn2)) continue;
      if (!castling.players[tpn2]) continue;
      var tb2 = state.playerBoards[tpn2].map(function(c) { return c.completed; });
      var trig2 = core.checkTrigger(tb2);
      if (trig2.triggered) {
        // 首次触发: 重置uses (同轮spec被免除)
        if (castling.players[tpn2].triggeredAtRound === null || castling.players[tpn2].triggeredAtRound === undefined) {
          castling.players[tpn2].uses = 0;
          castling.players[tpn2].triggeredAtRound = roundNum;
          console.log('  [castling] ' + tpn2 + ' triggered R' + roundNum + ', uses reset');
        }
        castling.players[tpn2].maxUses = 1;
      }
    }
  }

  // 更新state
  state.playerBoards = playerBoards;
  state.castling = castling;

  return { roundCompletions: roundCompletions, newCompletions: newCompletions };
}

// ===== 辅助函数 =====

// 获取某题所有玩家的得分列表
function getQuestionScores(ranked, qi) {
  var scores = [];
  for (var i = 0; i < ranked.length; i++) {
    if (ranked[i].absent) continue;
    if (ranked[i].qScores && ranked[i].qScores[qi] !== undefined) {
      scores.push(ranked[i].qScores[qi]);
    }
  }
  return scores;
}

// 获取前N个最高分
function getTopN(scores, n) {
  var sorted = scores.slice().sort(function(a, b) { return b - a; });
  return sorted.slice(0, Math.min(n, sorted.length));
}

// 获取前N个最低分
function getBottomN(scores, n) {
  var sorted = scores.slice().sort(function(a, b) { return a - b; });
  return sorted.slice(0, Math.min(n, sorted.length));
}

// 某题得分最高的选项index
function getQuestionBestChoice(questions, ranked, qi) {
  if (qi < 0 || qi >= questions.length) return -1;
  var q = questions[qi];
  if (q.type !== 'single') return -1;
  // 计算每个选项的平均得分
  var optScores = {};
  var optCounts = {};
  for (var i = 0; i < ranked.length; i++) {
    if (ranked[i].absent) continue;
    var a = ranked[i].answers && ranked[i].answers[qi];
    if (!a || !a.label) continue;
    var s = ranked[i].qScores && ranked[i].qScores[qi] ? ranked[i].qScores[qi] : 0;
    optScores[a.label] = (optScores[a.label] || 0) + s;
    optCounts[a.label] = (optCounts[a.label] || 0) + 1;
  }
  var bestLabel = '', bestAvg = -Infinity;
  for (var ol in optScores) {
    if (!optScores.hasOwnProperty(ol)) continue;
    var avg = optScores[ol] / (optCounts[ol] || 1);
    if (avg > bestAvg) { bestAvg = avg; bestLabel = ol; }
  }
  if (!bestLabel) return -1;
  return (q.options || []).findIndex(function(o) { return o.label === bestLabel; });
}

// 某题得分最低的选项index
function getQuestionBestLabels(questions, ranked, qi) {
  if (qi < 0 || qi >= questions.length) return [];
  var q = questions[qi];
  if (q.type !== "single") return [];
  var avgs = {};
  for (var i = 0; i < ranked.length; i++) {
    if (ranked[i].absent) continue;
    var a = ranked[i].answers && ranked[i].answers[qi];
    if (!a || !a.label) continue;
    var s = ranked[i].qScores && ranked[i].qScores[qi] ? ranked[i].qScores[qi] : 0;
    if (!avgs[a.label]) avgs[a.label] = { sum: 0, cnt: 0 };
    avgs[a.label].sum += s; avgs[a.label].cnt++;
  }
  var bestAvg = -Infinity, labels = [];
  for (var ol in avgs) {
    if (!avgs.hasOwnProperty(ol)) continue;
    var avg = avgs[ol].sum / avgs[ol].cnt;
    if (avg > bestAvg) { bestAvg = avg; labels = []; }
    if (avg === bestAvg) labels.push((q.options || []).findIndex(function(o) { return o.label === ol; }));
  }
  return labels;
}
function getQuestionWorstLabels(questions, ranked, qi) {
  if (qi < 0 || qi >= questions.length) return [];
  var q = questions[qi];
  if (q.type !== "single") return [];
  var avgs = {};
  for (var i = 0; i < ranked.length; i++) {
    if (ranked[i].absent) continue;
    var a = ranked[i].answers && ranked[i].answers[qi];
    if (!a || !a.label) continue;
    var s = ranked[i].qScores && ranked[i].qScores[qi] ? ranked[i].qScores[qi] : 0;
    if (!avgs[a.label]) avgs[a.label] = { sum: 0, cnt: 0 };
    avgs[a.label].sum += s; avgs[a.label].cnt++;
  }
  var worstAvg = Infinity, labels = [];
  for (var ol in avgs) {
    if (!avgs.hasOwnProperty(ol)) continue;
    var avg = avgs[ol].sum / avgs[ol].cnt;
    if (avg < worstAvg) { worstAvg = avg; labels = []; }
    if (avg === worstAvg) labels.push((q.options || []).findIndex(function(o) { return o.label === ol; }));
  }
  return labels;
}
function getQuestionWorstChoice(questions, ranked, qi) {
  if (qi < 0 || qi >= questions.length) return -1;
  var q = questions[qi];
  if (q.type !== 'single') return -1;
  var optScores = {};
  var optCounts = {};
  for (var i = 0; i < ranked.length; i++) {
    if (ranked[i].absent) continue;
    var a = ranked[i].answers && ranked[i].answers[qi];
    if (!a || !a.label) continue;
    var s = ranked[i].qScores && ranked[i].qScores[qi] ? ranked[i].qScores[qi] : 0;
    optScores[a.label] = (optScores[a.label] || 0) + s;
    optCounts[a.label] = (optCounts[a.label] || 0) + 1;
  }
  var worstLabel = '', worstAvg = Infinity;
  for (var ol in optScores) {
    if (!optScores.hasOwnProperty(ol)) continue;
    var avg = optScores[ol] / (optCounts[ol] || 1);
    if (avg < worstAvg) { worstAvg = avg; worstLabel = ol; }
  }
  if (!worstLabel) return -1;
  return (q.options || []).findIndex(function(o) { return o.label === worstLabel; });
}

// 玩家的某题选择index
function getPlayerChoice(roundData, qi, questions) {
  if (!roundData || !roundData.answers) return -1;
  var a = roundData.answers[qi];
  if (!a) return -1;
  if (questions[qi].type === 'single') {
    return (questions[qi].options || []).findIndex(function(o) { return o.label === a.label; });
  }
  return -1;
}

// 统计某轮选择某label的次数
function countOptionSelections(roundData, questions, qOffset, label) {
  var count = 0;
  for (var qi = 0; qi < questions.length; qi++) {
    if (!roundData.answers || !roundData.answers[qi]) continue;
    var q = questions[qi];
    var a = roundData.answers[qi];
    if (q.type === 'single' && a.label === label) count++;
    if (q.type === 'multi' && a.labels && a.labels.indexOf(label) >= 0) count++;
  }
  return count;
}

// 两个玩家答案重合题数
function countAnswerOverlap(answers1, answers2, questions, qOffset) {
  var overlap = 0;
  for (var qi = 0; qi < questions.length; qi++) {
    if (questions[qi].id === 'CASTLE') continue;
    if (!answers1[qi] || !answers2[qi]) continue;
    var q = questions[qi];
    if (q.type === 'single') {
      if (answers1[qi].label === answers2[qi].label && answers1[qi].label) overlap++;
    } else if (q.type === 'text') {
      if (answers1[qi].value === answers2[qi].value && answers1[qi].value) overlap++;
    } else if (q.type === 'multi') {
      var l1 = (answers1[qi].labels || []).sort().join(',');
      var l2 = (answers2[qi].labels || []).sort().join(',');
      if (l1 === l2 && l1) overlap++;
    }
  }
  return overlap;
}

// 某题选项人数最多的label
function getMaxCountLabel(ranked, qi, questions) {
  var q = questions[qi];
  if (!q || !q.options) return null;
  var counts = {};
  for (var oi = 0; oi < q.options.length; oi++) counts[q.options[oi].label] = 0;
  for (var i = 0; i < ranked.length; i++) {
    if (ranked[i].absent) continue;
    var a = ranked[i].answers && ranked[i].answers[qi];
    if (!a) continue;
    if (q.type === 'single' && a.label) {
      if (counts[a.label] !== undefined) counts[a.label]++;
    } else if (q.type === 'multi' && a.labels) {
      for (var li = 0; li < a.labels.length; li++) {
        if (counts[a.labels[li]] !== undefined) counts[a.labels[li]]++;
      }
    }
  }
  var maxLabel = null, maxCount = -1;
  for (var cl in counts) {
    if (!counts.hasOwnProperty(cl)) continue;
    if (counts[cl] > maxCount) { maxCount = counts[cl]; maxLabel = cl; }
  }
  return maxLabel;
}

// ===== S2 封印之息：本轮生效事件应用 =====
var s2ActiveEvents = (state.events && state.events.active) || [];
var s2Season = /s2/i.test(String(state.season || '')) && !/s2\d/i.test(String(state.season || ''));
var s2Enabled = s2Season && !config.eventsDisabled;
var s2Applied = null;
if (s2ActiveEvents.length > 0 && s2Enabled) {
  s2Applied = s2events.applyEvents(finalRanked, questions, qOffset, s2ActiveEvents, scoringResult.stats);
  finalRanked = s2Applied.ranked;
  console.log('  [S2事件] 本轮生效: ' + s2ActiveEvents.map(function(e) { return s2events.EVENT_NAMES[e] || e; }).join(', '));
}

// ===== S2 屏息：解析HOLD题申请 + 结算到期弱化（须在任务检查前）=====
if (s2Season && !config.eventsDisabled) {
  s2breath.parseHoldAnswers(state, roundNum, finalRanked, questions);
  s2breath.applyDueWeakenings(state, roundNum);
}

// ===== 执行任务检查 =====
var taskResult = checkTasks(state, seasonDir, roundNum, finalRanked, questions, absentPlayers);
var roundCompletions = taskResult.roundCompletions;
var newCompletions = taskResult.newCompletions;

// ===== 胜负检测 =====
var winCheckEnabled = config.winCheck !== false;
var winner = null;
if (winCheckEnabled) {
  for (var pn3 = 0; pn3 < allPlayerNames.length; pn3++) {
    var pname3 = allPlayerNames[pn3];
    var pBoard3 = state.playerBoards[pname3];
    if (!pBoard3) continue;
    var completed = pBoard3.map(function(c) { return !!c.completed; });
    if (core.checkWin(completed)) {
      winner = pname3;
      state.winner = pname3;
      state.finished = true;
      break;
    }
  }
}

// ===== 更新历史 =====
var roundSummary = {
  round: roundNum,
  date: new Date().toISOString().slice(0, 10),
  ranked: finalRanked.map(function(r) {
    return {
      name: r.name,
      rank: r.rank,
      totalScore: r.totalScore,
      qScores: r.qScores,
      answers: r.answers,
      flags: r.flags,
      absent: r.absent || false,
      fillTime: r.fillTime || 0
    };
  }),
  absent: absentPlayers.slice(),
  newCompletions: newCompletions,
  winner: winner
};
  // 移除同回合旧记录后添加
  state.history = state.history.filter(function(h) { return h.round !== roundNum; });
  state.history.push(roundSummary);
state.currentRound = roundNum;

// ===== S2 封印之息：抽取下一轮事件 =====
var s2NextEvents = [];
if (s2Enabled) {
  if (!state.events) state.events = { active: [], history: [] };
  if (!state.events.history) state.events.history = [];
  if (s2ActiveEvents.length > 0) {
    // 幂等：先删除本回合历史再记录（防止重结重复记录）
    state.events.history = state.events.history.filter(function(h) { return h.round !== roundNum; });
    state.events.history.push({ round: roundNum, events: s2ActiveEvents.slice() });
  }
  // 冷却保险: 排除最近2回合已抽取的事件
  var recentExcl = [];
  var evHist3 = state.events.history || [];
  for (var ehx3 = evHist3.length - 1; ehx3 >= 0 && recentExcl.length < 2; ehx3--) {
    var evsx3 = evHist3[ehx3].events || [];
    for (var evix3 = 0; evix3 < evsx3.length && recentExcl.length < 2; evix3++) {
      recentExcl.push(evsx3[evix3]);
    }
  }
  s2NextEvents = s2events.drawEvents(roundNum + 1, recentExcl);
  state.events.active = s2NextEvents;
}
if (s2NextEvents.length > 0) {
  console.log('  [S2事件] 下一轮R' + (roundNum + 1) + '生效: ' + s2NextEvents.map(function(e) { return s2events.EVENT_NAMES[e] || e; }).join(', ') + (s2events.isSurge(roundNum + 1) ? ' (气息喷涌×3)' : ''));
}

// 备份 (按回合编号)
try { fs.copyFileSync(statePath, statePath + '.R' + roundNum); } catch(e) {}
fs.writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2), 'utf8');
try { fs.renameSync(statePath + '.tmp', statePath); } catch(e) { fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8'); }

// ===== 生成结算报告 =====
var reportLines = [];
reportLines.push('========================================');
reportLines.push('  乌合bingo 结算报告 - ' + seasonName + ' 回合 ' + roundNum);
reportLines.push('========================================');
reportLines.push('');
reportLines.push('赛季: ' + seasonName);
reportLines.push('回合: ' + roundNum);
reportLines.push('日期: ' + new Date().toISOString().slice(0, 19).replace('T', ' '));
reportLines.push('参赛人数: ' + finalRanked.filter(function(r) { return !r.absent; }).length + ' (共' + finalRanked.length + '人)');
if (absentPlayers.length > 0) {
  reportLines.push('缺席: ' + absentPlayers.join(', '));
}
if (s2ActiveEvents.length > 0) {
  reportLines.push('本轮生效事件: ' + s2ActiveEvents.map(function(e) { return s2events.EVENT_NAMES[e] || e; }).join('、'));
}
reportLines.push('');

// 排名总览
reportLines.push('------ 排名总览 ------');
reportLines.push('');
for (var rpi = 0; rpi < finalRanked.length; rpi++) {
  var rp = finalRanked[rpi];
  var rankStr = String(rp.rank);
  if (rp.absent) rankStr += '(缺席)';
  var scoreStr = rp.totalScore ? rp.totalScore.toFixed(2) : '0.00';
  var colorTag = playerColors[rp.name] || '';
  reportLines.push('  ' + rankStr.padEnd(10) + rp.name.padEnd(16) + scoreStr.padEnd(12) + '分  ' + (rp.fillTime ? rp.fillTime + '秒' : ''));
}
reportLines.push('');

// 每题详情
reportLines.push('------ 每题详情 ------');
reportLines.push('');
for (var sqi = 0; sqi < questions.length; sqi++) {
  var sq = questions[sqi];
  if (sq.id === 'CASTLE') continue;
  var typeName = sq.type === 'single' ? '单选' : sq.type === 'multi' ? '多选' : '填空';
  var qLabel = 'Q' + (sqi - qOffset + 1);
  reportLines.push(qLabel + '. [' + typeName + '] ' + (sq.text || sq.title));
  if (sq.desc) reportLines.push('  描述: ' + sq.desc);
  if (sq.options && sq.options.length > 0) {
    reportLines.push('  选项分布:');
    var qStats = scoringResult.stats[sqi];
    sq.options.forEach(function(o) {
      var cnt = (qStats && qStats.counts) ? (qStats.counts[o.label] || 0) : 0;
      reportLines.push('    ' + o.label + '. ' + o.text + ' → ' + cnt + '人');
    });
  }
  reportLines.push('  玩家选择(按提交顺序):');
  rawAnswers.forEach(function(rp) {
    if (rp.absent) { reportLines.push('    ' + rp.name.padEnd(14) + '→ (缺席)'); return; }
    var ans = rp.answers && rp.answers[sqi];
    var ansStr = '';
    if (sq.type === 'single') ansStr = ans ? (ans.label || '(空)') : '(空)';
    else if (sq.type === 'text') ansStr = ans ? (ans.value || '(空)') : '(空)';
    else if (sq.type === 'multi') ansStr = ans ? ((ans.labels || []).join(',') || '(空)') : '(空)';
    var sc = (rp.qScores && rp.qScores[sqi]) ? rp.qScores[sqi].toFixed(2) : '0.00';
    reportLines.push('    ' + rp.name.padEnd(14) + '→ ' + ansStr.padEnd(12) + '得分: ' + sc);
  });
  reportLines.push('');
}

// 逐人逐题详情
reportLines.push('------ 逐人逐题详情 ------');
reportLines.push('');
for (var dpi = 0; dpi < finalRanked.length; dpi++) {
  var dp = finalRanked[dpi];
  reportLines.push('--- ' + dp.name + ' (排名' + dp.rank + (dp.absent ? ', 缺席' : '') + ', ' + (dp.totalScore || 0).toFixed(2) + '分) ---');

  if (dp.absent) {
    reportLines.push('  (缺席, 无答题数据)');
  } else {
    var startQ = qOffset;
    for (var dqi = 0; dqi < questions.length; dqi++) {
      var dq = questions[dqi];
      var da = dp.answers && dp.answers[dqi];
      var qScore = dp.qScores && dp.qScores[dqi] ? dp.qScores[dqi].toFixed(2) : '0.00';
      var qlabel;
      if (dq.id === 'CASTLE') qlabel = 'CASTLE';
      else if (dq.id === 'HOLD') qlabel = 'HOLD';
      else qlabel = 'T' + (dqi - qOffset + 1);

      var ansStr = '';
      if (dq.type === 'single' && da) ansStr = da.label || '(空)';
      else if (dq.type === 'text' && da) ansStr = da.value || '(空)';
      else if (dq.type === 'multi' && da) ansStr = (da.labels || []).join(',') || '(空)';

      reportLines.push('  ' + qlabel.padEnd(8) + '[' + (dq.type || '?').padEnd(6) + '] ' + (dq.text || dq.title).padEnd(20) + ' 答:' + ansStr.padEnd(12) + ' 得分:' + qScore);
    }
  }
  reportLines.push('');
}

// 任务完成情况
reportLines.push('------ 任务完成情况 ------');
reportLines.push('');
var cellLabels = 'ABCDEFGHIJKLMNOPQRSTUVWXY';
for (var tpi = 0; tpi < allPlayerNames.length; tpi++) {
  var tp = allPlayerNames[tpi];
  var tb = state.playerBoards[tp];
  if (!tb) continue;
  var done = tb.filter(function(c) { return c.completed; }).length;
  var bar = '';
  for (var tbi = 0; tbi < 25; tbi++) bar += tb[tbi].completed ? '#' : (tb[tbi].progress > 0 ? '+' : '.');
  reportLines.push('  ' + tp.padEnd(14) + done + '/25  ' + bar);

  // 本轮新完成
  var nc = newCompletions[tp] || [];
  if (nc.length > 0) {
    reportLines.push('    本轮新完成: ' + nc.map(function(i) { return cellLabels[i]; }).join(', '));
  }
}
reportLines.push('');

// 易位状态
if (state.castling && state.castling.log && state.castling.log.length > 0) {
  reportLines.push('------ 易位记录 ------');
  var thisRoundSwaps = state.castling.log.filter(function(e) { return e.round === roundNum; });
  thisRoundSwaps.forEach(function(e) {
    reportLines.push('  [' + e.round + '] ' + e.player + ' 交换 ' + e.from + ' <-> ' + e.to);
  });
  reportLines.push('');
}

if (winner) {
  reportLines.push('');
  reportLines.push('!!!!!  胜者: ' + winner + '  !!!!!');
  reportLines.push('');
}

if (s2NextEvents.length > 0) {
  reportLines.push('');
  reportLines.push('------ 下一轮预告 ------');
  reportLines.push('下一轮(R' + (roundNum + 1) + ')生效事件: ' + s2NextEvents.map(function(e) { return s2events.EVENT_NAMES[e] || e; }).join('、') + (s2events.isSurge(roundNum + 1) ? ' (气息喷涌×3)' : ''));
  reportLines.push('(事件由 R' + roundNum + ' 结算时抽取，玩家答题前已可见)');
}

// 写入报告
var reportPath = path.join(roundDir, '结算报告.txt');
fs.writeFileSync(reportPath, reportLines.join('\n'), 'utf8');

// ===== 控制台输出 =====
console.log('===== 乌合bingo 结算 - ' + seasonName + ' R' + roundNum + ' =====');
console.log('');
console.log('排名  玩家            总分        答题时长');
console.log('------------------------------------------');
for (var crpi = 0; crpi < finalRanked.length; crpi++) {
  var crp = finalRanked[crpi];
  var cRankStr = String(crp.rank) + (crp.absent ? '(缺)' : '');
  console.log(cRankStr.padEnd(6) + crp.name.padEnd(16) + (crp.totalScore || 0).toFixed(2).padEnd(12) + (crp.fillTime || '-') + '秒');
}
console.log('');

if (absentPlayers.length > 0) {
  console.log('缺席: ' + absentPlayers.join(', '));
}

var totalNewComps = 0;
for (var npk in newCompletions) {
  if (!newCompletions.hasOwnProperty(npk)) continue;
  if (newCompletions[npk].length > 0) {
    console.log('  ' + npk + ': 新完成 ' + newCompletions[npk].map(function(i) { return cellLabels[i]; }).join(','));
    totalNewComps += newCompletions[npk].length;
  }
}
console.log('');
console.log('本轮新增完成: ' + totalNewComps + ' 格');
if (winner) console.log('** 胜者: ' + winner + ' **');
console.log('结算报告已写入: ' + reportPath);
console.log('结果已写入: ' + path.join(roundDir, 'results.json'));
if (state.castling && state.castling.log) {
  var swaps = state.castling.log.filter(function(e) { return e.round === roundNum && e.act === 'swap'; });
  if (swaps.length > 0) console.log('易位交换: ' + swaps.length + ' 次');
}
