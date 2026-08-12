// core.js — 乌合bingo 核心引擎 v2 (zlwuhe公式语言)
const fs = require('fs');

// ===== 宽松JSON解析 (允许多行字符串, 换行自动转\n) =====
function parseJSON(text) {
  let fixed = '', inString = false, escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { fixed += ch; escape = false; continue; }
    if (ch === '\\') { fixed += ch; escape = true; continue; }
    if (ch === '"') { inString = !inString; fixed += ch; continue; }
    if (inString && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      fixed += '\\n';
      continue;
    }
    fixed += ch;
  }
  return JSON.parse(fixed);
}

// ===== 排名分 =====
function rankScore(rank, total) { if (!total || total <= 1) return 1; return (1 - total) * Math.log(rank) / Math.log(total) + total; }

// ===== 公式引擎 (移植自 zlwuhe/settle.js) =====
function parseCSV(text) {
  return text.replace(/\r\n/g, '\n').trim().split('\n').filter(l => l);
}

function parseCSVLine(line) {
  const r = []; let c = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else { if (ch === '"') q = true; else if (ch === ',' || ch === '\t') { r.push(c.trim()); c = ''; } else c += ch; }
  }
  r.push(c.trim()); return r;
}

function evaluateFormula(formula, ctx) {
  const src = formula
    .replace(/\}\s*\n\s*else\b/g, '}else')     // 1a. 保留 }else
    .replace(/\}\s*\n\s*\}\s*else\b/g, '}}else') // 1b. }}else 嵌套
    .replace(/\{\s*\n\s*/g, '{')                 // 2. { 后不插分号
    .replace(/\}\s*\n\s*/g, '};')                // 3. } 后插分号
    .replace(/\n\s*/g, ';')                      // 4. 其余换行 → 分号
    .replace(/\s+/g, '')                         // 5. 清除空白
    .replace(/elseif/g, 'else if')               // 6. 修复 else if 粘连
    .replace(/;\{/g, '{')                        // 7. 修复 ;{ → {
    .replace(/;\}/g, '}');                       // 8. 修复 ;} → }
  if (!src) return ctx.score || 0;
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    // 跳过空格 (else if 修复后可能残留)
    if (ch === ' ' || ch === '\t') { i++; continue; }
    if (/\d/.test(ch) || (ch === '.' && i + 1 < src.length && /\d/.test(src[i + 1]))) { let n = ''; while (i < src.length && /[\d.]/.test(src[i])) n += src[i++]; tokens.push({ t: 'num', v: n }); continue; }
    if (/[a-zA-Z_]/.test(ch)) { let id = ''; while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) id += src[i++]; tokens.push({ t: ['if', 'else', 'while', 'return', 'true', 'false'].includes(id) ? id : 'ident', v: id }); continue; }
    if (ch === '(') { tokens.push({ t: '(', v: '(' }); i++; continue; }
    if (ch === ')') { tokens.push({ t: ')', v: ')' }); i++; continue; }
    if (ch === '{') { tokens.push({ t: '{', v: '{' }); i++; continue; }
    if (ch === '}') { tokens.push({ t: '}', v: '}' }); i++; continue; }
    if (ch === ';') { tokens.push({ t: ';', v: ';' }); i++; continue; }
    if (ch === '=') { i++; tokens.push({ t: src[i] === '=' ? (i++, '==') : '=', v: tokens[tokens.length - 1]?.v }); continue; }
    if (ch === '!') { i++; tokens.push({ t: src[i] === '=' ? (i++, '!=') : '!', v: '!' }); continue; }
    if (ch === '>') { i++; tokens.push({ t: src[i] === '=' ? (i++, '>=') : '>', v: '>' }); continue; }
    if (ch === '<') { i++; tokens.push({ t: src[i] === '=' ? (i++, '<=') : '<', v: '<' }); continue; }
    if (ch === '&') { i++; if (src[i] === '&') { i++; tokens.push({ t: '&&', v: '&&' }); } continue; }
    if (ch === '|') { i++; if (src[i] === '|') { i++; tokens.push({ t: '||', v: '||' }); } continue; }
    tokens.push({ t: ch, v: ch }); i++;
  }
  tokens.push({ t: 'eof', v: '' });
  let pos = 0;
  function peek() { return tokens[pos]; }
  function eat() { return tokens[pos++]; }
  function expectType(t) { if (peek().t !== t) throw new Error('expected ' + t); return eat(); }

  function parseExpr() { return parseLogicOr(); }
  function parseLogicOr() { let l = parseLogicAnd(); while (peek().t === '||') { eat(); l = { t: 'binop', op: '||', l, r: parseLogicAnd() }; } return l; }
  function parseLogicAnd() { let l = parseCmp(); while (peek().t === '&&') { eat(); l = { t: 'binop', op: '&&', l, r: parseCmp() }; } return l; }
  function parseCmp() { let l = parseAdd(); while (['==', '!=', '>', '<', '>=', '<='].includes(peek().t)) { const op = eat().t; l = { t: 'binop', op, l, r: parseAdd() }; } return l; }
  function parseAdd() { let l = parseMul(); while (peek().t === '+' || peek().t === '-') { const op = eat().t; l = { t: 'binop', op, l, r: parseMul() }; } return l; }
  function parseMul() { let l = parseUnary(); while (peek().t === '*' || peek().t === '/' || peek().t === '%') { const op = eat().t; l = { t: 'binop', op, l, r: parseUnary() }; } return l; }
  function parseUnary() { if (peek().t === '-' || peek().t === '!') return { t: 'unary', op: eat().t, v: parseUnary() }; return parsePrimary(); }
  function parsePrimary() {
    const tk = peek();
    if (tk.t === 'num') { eat(); return { t: 'num', v: parseFloat(tk.v) }; }
    if (tk.t === 'true') { eat(); return { t: 'num', v: 1 }; }
    if (tk.t === 'false') { eat(); return { t: 'num', v: 0 }; }
    if (tk.t === 'ident') {
      eat();
      if (peek().t === '[') {
        eat(); const idx = parseExpr(); expectType(']');
        return { t: 'index', v: tk.v, idx };
      }
      if (['floor','ceil','round'].includes(tk.v) && peek().t === '(') {
        eat(); const arg = parseExpr(); expectType(')');
        return { t: 'call', name: tk.v, arg };
      }
      return { t: 'ident', v: tk.v };
    }
    if (tk.t === '(') { eat(); const e = parseExpr(); expectType(')'); return e; }
    throw new Error('unexpected: ' + tk.t);
  }
  function parseBlock() {
    if (peek().t === '{') { eat(); const stmts = []; while (peek().t !== '}' && peek().t !== 'eof') stmts.push(parseStmt()); expectType('}'); return stmts; }
    return [parseStmt()];
  }
  function parseStmt() {
    if (peek().t === ';') { eat(); return { t: 'empty' }; }
    if (peek().t === 'if') { eat(); expectType('('); const cond = parseExpr(); expectType(')'); const body = parseBlock(); let eb = null; if (peek().t === 'else') { eat(); eb = parseBlock(); } return { t: 'if', cond, body, eb }; }
    if (peek().t === 'while') { eat(); expectType('('); const cond = parseExpr(); expectType(')'); const body = parseBlock(); return { t: 'while', cond, body }; }
    if (peek().t === 'return') { eat(); let v = null; if (peek().t !== ';' && peek().t !== '}') v = parseExpr(); if (peek().t === ';') eat(); return { t: 'return', v }; }
    if (peek().t === 'ident' && tokens[pos + 1]?.t === '=') { const name = eat().v; eat(); const val = parseExpr(); if (peek().t === ';') eat(); return { t: 'set', name, val }; }
    const e = parseExpr(); if (peek().t === ';') eat(); return e;
  }
  function parseProgram() { const stmts = []; while (peek().t !== 'eof') stmts.push(parseStmt()); return { t: 'prog', stmts }; }

  let locals = {}, returned = false, retVal = 0;
  function evalNode(n) {
    if (typeof n === 'number') return n;
    switch (n.t) {
      case 'empty': return undefined;
      case 'call': {
        const v = evalNode(n.arg);
        if (n.name === 'floor') return Math.floor(v);
        if (n.name === 'ceil') return Math.ceil(v);
        if (n.name === 'round') return Math.round(v);
        return 0;
      }
      case 'num': return parseFloat(n.v);
      case 'ident': return n.v in locals ? locals[n.v] : (ctx.options[n.v] ?? (ctx[n.v] ?? 0));
      case 'index': {
        const idx = Math.round(evalNode(n.idx));
        if (n.v === 'c' || n.v === 'C') {
          const label = String.fromCharCode(65 + idx);
          if (ctx.options[label] !== undefined) return ctx.options[label];
          return ctx.options[String(idx)] ?? 0;
        }
        if (n.v === 'chose' || n.v === 'CHOSE') {
          const label = String.fromCharCode(65 + idx);
          return ctx['chose_' + label] ?? 0;
        }
        if (n.v === 'gtrank' || n.v === 'GTRANK') {
          const label = String.fromCharCode(65 + idx);
          return ctx['gtrank_' + label] ?? 0;
        }
        if (n.v === 'slrank' || n.v === 'SLRANK') {
          const label = String.fromCharCode(65 + idx);
          return ctx['slrank_' + label] ?? 0;
        }
        return 0;
      }
      case 'unary': { const v = evalNode(n.v); return n.op === '-' ? -v : (v ? 0 : 1); }
      case 'binop': { const l = evalNode(n.l), r = evalNode(n.r); switch (n.op) { case '+': return l + r; case '-': return l - r; case '*': return l * r; case '/': return r === 0 ? 0 : l / r; case '%': return r === 0 ? 0 : l % r;       case '==': return l == r ? 1 : 0; case '!=': return l != r ? 1 : 0; case '>': return l > r ? 1 : 0; case '<': return l < r ? 1 : 0; case '>=': return l >= r ? 1 : 0; case '<=': return l <= r ? 1 : 0; case '&&': return (l && r) ? 1 : 0; case '||': return (l || r) ? 1 : 0; } return 0; }
      case 'set': { const v = evalNode(n.val); locals[n.name] = v; return v; }
      case 'if': {
        if (evalNode(n.cond)) return evalBlock(n.body);
        if (n.eb) return evalBlock(n.eb);
        return undefined;
      }
      case 'while': { let last = 0, limit = 10000; while (evalNode(n.cond)) { if (returned) return retVal; if (--limit < 0) throw new Error('loop limit'); last = evalBlock(n.body); } return last; }
      case 'return': { returned = true; retVal = n.v ? evalNode(n.v) : 0; return retVal; }
      case 'prog': { let last = 0; for (const s of n.stmts) { if (returned) break; const v = evalNode(s); if (v !== undefined) last = v; } return last; }
    }
    return 0;
  }
  function evalBlock(stmts) { let last = 0; for (const s of stmts) { if (returned) break; const v = evalNode(s); if (v !== undefined) last = v; } return last; }

  try {
    const ast = parseProgram();
    const result = evalNode(ast);
    return returned ? retVal : result;
  } catch (e) {
    return ctx.score || 0;
  }
}

// ===== 构建公式上下文 =====
function buildCtx(q, qi, allQ, allStats, allAnswers, score, sorted, rankAnswers, pass, myAnswers, myName) {
  const type = q.type || 'single';
  const stats = allStats[qi];
  const ctx = {
    options: {},
    score,
    total: allAnswers.length,
    my_rank: pass === 1 ? sorted.findIndex(e => e.name === myName) + 1 : allAnswers.length,
  };
  if (stats.counts) for (const [k, v] of Object.entries(stats.counts)) ctx.options[k] = v;

  // 选项人数排行: gtrank_X (多→少), slrank_X (少→多)
  if (stats.counts && (type === 'single' || type === 'multi')) {
    var entries = Object.entries(stats.counts).filter(function(e) { return (q.options || []).some(function(o) { return o.label === e[0]; }); });
    // gtrank: 从多到少
    entries.sort(function(a, b) { return b[1] - a[1]; });
    var gtRank = 1;
    for (var ri = 0; ri < entries.length; ri++) {
      if (ri > 0 && entries[ri][1] < entries[ri-1][1]) gtRank = ri + 1;
      ctx['gtrank_' + entries[ri][0]] = gtRank;
    }
    // slrank: 从少到多
    entries.sort(function(a, b) { return a[1] - b[1]; });
    var slRank = 1;
    for (var ri = 0; ri < entries.length; ri++) {
      if (ri > 0 && entries[ri][1] > entries[ri-1][1]) slRank = ri + 1;
      ctx['slrank_' + entries[ri][0]] = slRank;
    }
  }

  // 跨题引用
  for (let i = 0; i < allQ.length; i++) {
    const aq = allQ[i], at = aq.type || 'single', aa = myAnswers[i];
    const qkey = 'q' + (i + 1);
    if (at === 'single' || at === 'text') {
      ctx[qkey + '_choice'] = aq.options ? aq.options.findIndex(o => o.label === (aa.label || aa.value || '')) : -1;
    } else if (at === 'multi') {
      for (const opt of (aq.options || [])) ctx[qkey + '_chose_' + opt.label] = (aa.labels && aa.labels.includes(opt.label)) ? 1 : 0;
    }
  }

  // rank_N 变量
  if (sorted && rankAnswers) {
    for (let n = 1; n <= Math.min(allAnswers.length, sorted.length); n++) {
      const rn = sorted[n - 1]?.name;
      const raAll = rn ? rankAnswers[rn] : [];
      const rAnswer = raAll[qi];
      if (rAnswer) {
        if (type === 'single' || type === 'text') {
          ctx['rank_' + n] = q.options ? q.options.findIndex(o => o.label === (rAnswer.label || rAnswer.value || '')) : -1;
        } else if (type === 'multi') {
          for (const opt of (q.options || [])) ctx['rank_' + n + '_chose_' + opt.label] = (rAnswer.labels && rAnswer.labels.includes(opt.label)) ? 1 : 0;
        }
      }
      for (let ri = 0; ri < raAll.length; ri++) {
        const rq = allQ[ri], rt = rq.type || 'single', ra = raAll[ri];
        if (!ra) continue;
        const rkey = 'rank_' + n + '_q' + (ri + 1);
        if (rt === 'single' || rt === 'text') {
          ctx[rkey + '_choice'] = rq.options ? rq.options.findIndex(o => o.label === (ra.label || ra.value || '')) : -1;
        } else if (rt === 'multi') {
          for (const opt of (rq.options || [])) ctx[rkey + '_chose_' + opt.label] = (ra.labels && ra.labels.includes(opt.label)) ? 1 : 0;
        }
      }
    }
  }

  // 题型专属变量
  if (type === 'single') {
    ctx.choice = q.options ? q.options.findIndex(o => o.label === myAnswers[qi].label) : -1;
  } else if (type === 'multi') {
    for (const opt of (q.options || [])) ctx['chose_' + opt.label] = (myAnswers[qi].labels && myAnswers[qi].labels.includes(opt.label)) ? 1 : 0;
    if (stats.counts) {
      const entries = Object.entries(stats.counts).filter(([k]) => (q.options || []).some(o => o.label === k));
      const chosen = entries.filter(([, v]) => v > 0);
      ctx.min_count = chosen.length > 0 ? Math.min(...chosen.map(([, v]) => v)) : 0;
      ctx.chose_min = chosen.filter(([k, v]) => v === ctx.min_count).some(([k]) => myAnswers[qi].labels && myAnswers[qi].labels.includes(k)) ? 1 : 0;
    }
    // same_set: 是否只有你选了这套组合 (1=唯一, 0=有重复)
    ctx.same_set = myAnswers[qi].same_set || 0;
    ctx.same_count = myAnswers[qi].same_count || 1;
  } else if (type === 'text') {
    const myVal = myAnswers[qi].value || '';
    ctx.choice = q.options ? q.options.findIndex(o => o.label === myVal) : -1;
    ctx.value = isNaN(parseFloat(myVal)) ? myVal : parseFloat(myVal);
    ctx.sum = stats.textSum || 0;
    // same_count 和 unique 需要用全局数据 (allAnswers是当前玩家数据, 这里改用stats)
    var myValStr = myVal || '';
    ctx.same_count = 0;
    if (stats.counts) ctx.same_count = stats.counts[myValStr] || 0;
    ctx.unique = ctx.same_count === 1 ? 1 : 0;
    ctx.ladder_score = computeLadder(qi, myVal, allAnswers.map(function(a) { return (a.answers||[])[qi] && (a.answers[qi].value || ''); }));
  }
  return ctx;
}

function computeLadder(qi, myVal, allVals) {
  const counts = {};
  for (const v of allVals) { const n = parseInt(v); if (!isNaN(n)) counts[n] = (counts[n] || 0) + 1; }
  let smallestUnique = -1;
  for (let v = 0; v <= 20; v++) { if (counts[v] === 1) { smallestUnique = v; break; } }
  if (smallestUnique < 0) return 0;
  const d = parseInt(myVal) - smallestUnique;
  return (d >= 0 && d <= 4) ? 5 - d : 0;
}

// ===== 两轮计分 =====
function scoreAllQuestions(questions, rawAnswers) {
  // questions: zlwuhe格式题目数组
  // rawAnswers: [{name, answers: [{type,label,labels,value}]}]
  const allQ = questions;
  const allAnswers = rawAnswers.map(r => r.answers);

  // 统计
  const allStats = questions.map((q, qi) => {
    const type = q.type || 'single';
    const ans = rawAnswers.map(r => r.answers[qi] || { type, label: '', labels: [], value: '' });
    if (type === 'single' || type === 'text') {
      const counts = {};
      if (q.options) for (const o of q.options) counts[o.label] = 0;
      var textSum = 0;
      for (const a of ans) {
        const label = a.label || a.value || '';
        if (type === 'text' && a.value) {
          counts[a.value] = (counts[a.value] || 0) + 1;
          textSum += parseFloat(a.value) || 0;
        } else if (label && counts[label] !== undefined) {
          counts[label]++;
        }
      }
      return { counts, textSum };
    }
    if (type === 'multi') {
      const counts = {};
      if (q.options) for (const o of q.options) counts[o.label] = 0;
      for (const a of ans) for (const l of (a.labels || [])) if (counts[l] !== undefined) counts[l]++;
      // sameSets[i]: 第i个玩家的选项组合是否唯一
      var sameSets = ans.map(function(a, i) {
        var mySet = (a.labels || []).sort().join(',');
        var cnt = 0;
        for (var j = 0; j < ans.length; j++) {
          if ((ans[j].labels || []).sort().join(',') === mySet) cnt++;
        }
        return cnt === 1 ? 1 : 0;
      });
      return { counts, sameSets };
    }
    return { counts: {} };
  });

  // 第一轮
  // 预计算多选题 same_set
  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi];
    if (q.type !== 'multi') continue;
    const ans = rawAnswers.map(r => r.answers[qi] || { type: 'multi', labels: [], value: '' });
    for (let pi = 0; pi < rawAnswers.length; pi++) {
      var mySet = (ans[pi].labels || []).sort().join(',');
      var cnt = 0;
      for (var j = 0; j < ans.length; j++) {
        if ((ans[j].labels || []).sort().join(',') === mySet) cnt++;
      }
      rawAnswers[pi].answers[qi].same_set = cnt === 1 ? 1 : 0;
      rawAnswers[pi].answers[qi].same_count = cnt;
    }
  }

  for (const r of rawAnswers) {
    let sc = 0;
    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi];
      const ctx = buildCtx(q, qi, allQ, allStats, rawAnswers, sc, null, null, 0, r.answers, r.name);
      const qs = q.formula ? evaluateFormula(q.formula, ctx) : 0;
      r.qScores = r.qScores || [];
      r.qScores[qi] = qs;
      sc += qs;
    }
    r.totalScore = sc;
  }
  const sorted1 = [...rawAnswers].sort((a, b) => b.totalScore - a.totalScore);
  const rankAns1 = {};
  for (const s of sorted1) rankAns1[s.name] = s.answers;

  // 第二轮
  // T10 特殊处理: my_rank 基于 Q1~Q9 累计分数
  var preT10Scores = rawAnswers.map(function(r) {
    var s = 0;
    for (var qi = 0; qi < questions.length; qi++) {
      if (questions[qi].id === 'T10' || questions[qi].type === 'T10') continue;
      s += (r.qScores[qi] || 0);
    }
    return { name: r.name, score: s };
  });
  preT10Scores.sort(function(a, b) { return b.score - a.score; });
  var preT10Rank = {};
  preT10Scores.forEach(function(e, i) { preT10Rank[e.name] = i + 1; });

  for (const r of rawAnswers) {
    let sc = 0;
    r.qScores = [];
    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi];
      // T10 用 Q1~Q9 排名, 其他用第一轮排名
      var isT10 = q.id === 'T10' || q.type === 'T10';
      var ctx = buildCtx(q, qi, allQ, allStats, rawAnswers, sc, sorted1, rankAns1, 1, r.answers, r.name);
      if (isT10) ctx.my_rank = preT10Rank[r.name] || allAnswers.length;
      const qs = q.formula ? evaluateFormula(q.formula, ctx) : 0;
      r.qScores[qi] = qs;
      sc += qs;
    }
    r.totalScore = sc;
  }
  const final = [...rawAnswers].sort((a, b) => b.totalScore - a.totalScore);
  // 同分共享排名 (精确到2位小数)
  let rank = 1;
  for (let i = 0; i < final.length; i++) {
    if (i > 0 && Math.round(final[i].totalScore * 100) < Math.round(final[i-1].totalScore * 100)) rank = i + 1;
    final[i].rank = rank;
  }
  return { ranked: final, stats: allStats };
}

// ===== T1 组合 =====
function composeT1(bank) {
  const pools = bank.t1Pools;
  const poolOrder = bank.t1PoolOrder;
  const allLabels = bank.t1Labels; // ['A','B','C','D','E','F']
  const options = [];
  const formulaBranches = [];
  const used = {}; // poolName -> Set of used formulas

  for (let i = 0; i < poolOrder.length; i++) {
    const poolName = poolOrder[i];
    const pool = pools[poolName];
    if (!pool || pool.length === 0) continue;
    if (!used[poolName]) used[poolName] = new Set();
    const sub = pool[Math.floor(Math.random() * pool.length)];
    used[poolName].add(sub.formula);
    const label = allLabels[i];
    options.push({ label, text: sub.text.replace(/^[A-F]\./, label + '.'), pool: poolName });
    formulaBranches.push({ idx: i, label, formula: sub.formula, pool: poolName });
  }

  // F池: 随机抽一池, 避开已选的同池子选项
  const fPoolName = poolOrder[Math.floor(Math.random() * poolOrder.length)];
  const fPool = pools[fPoolName];
  const fCandidates = fPool.filter(function(s) { return !(used[fPoolName] && used[fPoolName].has(s.formula)); });
  const fSub = fCandidates.length > 0 ? fCandidates[Math.floor(Math.random() * fCandidates.length)] : fPool[Math.floor(Math.random() * fPool.length)];
  const fLabel = 'F';
  // 修正公式变量: 原公式用的变量(如A/B/C)要替换为F
  var fFormula = fSub.formula;
  // 找到原池的默认标签 (poolOrder中对应poolName的index)
  var poolIdx = poolOrder.indexOf(fPoolName);
  if (poolIdx >= 0) {
    var origLabel = allLabels[poolIdx]; // 原标签 A~E
    // 将公式中的原标签替换为F (注意不要替换标签内的字母如 if(A)...)
    fFormula = fFormula.replace(new RegExp('\\b' + origLabel + '\\b', 'g'), 'F');
  }
  options.push({ label: fLabel, text: fSub.text.replace(/^[A-F]\./, fLabel + '.'), pool: fPoolName });
  formulaBranches.push({ idx: 5, label: fLabel, formula: fFormula, pool: fPoolName });

  // 生成完整公式
  let formula = '';
  for (let i = 0; i < formulaBranches.length; i++) {
    const fb = formulaBranches[i];
    if (i === 0) {
      formula += 'if(choice == ' + fb.idx + ') {\n  ' + fb.formula.replace(/\n/g, '\n  ') + '\n}';
    } else {
      formula += ' else {\n  if(choice == ' + fb.idx + ') {\n    ' + fb.formula.replace(/\n/g, '\n    ') + '\n  }';
    }
  }
  formula += '\n  else { 0 }';
  for (let i = 1; i < formulaBranches.length; i++) formula += ' }';

  return {
    id: 'T1',
    type: 'single',
    text: '经典乌合',
    desc: '请选择一个选项',
    options,
    formula
  };
}

// ===== 任务/棋盘/工具函数 =====
function weightedPick(items, getWeight) {
  const ws = items.map(getWeight);
  const total = ws.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}
function normalInt(mean, stddev) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.max(1, Math.round(mean + stddev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)));
}
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

// ===== 任务库 (从JSON加载, 同时保留硬编码作为fallback) =====
let _taskDefs = null;
function loadTasks(filePath) {
  if (!fs.existsSync(filePath)) return [...TASK_DEFS];
  const data = parseJSON(fs.readFileSync(filePath, 'utf8'));
  _taskDefs = data.tasks || data;
  return _taskDefs;
}

const TASK_DEFS = [
  { id: 'A01', list: 'A', desc: '获得{x}次排名1', paramStyle: 'weighted', paramWeights: [6, 3, 1], paramVals: [1, 2, 3] },
  { id: 'A02', list: 'A', desc: '获得{x}次排名1~3', paramStyle: 'weighted', paramWeights: [3, 4, 6, 3, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A03', list: 'A', desc: '获得{x}次排名1~6', paramStyle: 'weighted', paramWeights: [1, 2, 4, 6, 4, 2, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A04', list: 'A', desc: '任意连续3局排名分之和大于{x}', paramStyle: 'normal', paramMean: 20, paramStddev: 5 },
  { id: 'A05', list: 'A', desc: '总排名分达到{x}', paramStyle: 'normal', paramMean: 40, paramStddev: 13 },
  { id: 'A06', list: 'A', desc: '连续{x}次排名1~6', paramStyle: 'weighted', paramWeights: [4, 1], paramVals: [2, 3] },
  { id: 'A07', list: 'A', desc: '连续{x}次在T1得到前3高的总分数', paramStyle: 'weighted', paramWeights: [6, 3, 1], paramVals: [2, 3, 4] },
  { id: 'A08', list: 'A', desc: '总计{x}次在T1得到前3高的总分数', paramStyle: 'weighted', paramWeights: [3, 4, 6, 3, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A09', list: 'A', desc: '连续{x}次在T2得到前3高的总分数', paramStyle: 'weighted', paramWeights: [6, 3, 1], paramVals: [2, 3, 4] },
  { id: 'A10', list: 'A', desc: '总计{x}次在T2得到前3高的总分数', paramStyle: 'weighted', paramWeights: [3, 4, 6, 3, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A11', list: 'A', desc: '连续{x}次在T3得到前3高的总分数', paramStyle: 'weighted', paramWeights: [6, 3, 1], paramVals: [2, 3, 4] },
  { id: 'A12', list: 'A', desc: '总计{x}次在T3得到前3高的总分数', paramStyle: 'weighted', paramWeights: [3, 4, 6, 3, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A13', list: 'A', desc: '连续{x}次在T4得到前3高的总分数', paramStyle: 'weighted', paramWeights: [6, 3, 1], paramVals: [2, 3, 4] },
  { id: 'A14', list: 'A', desc: '总计{x}次在T4得到前3高的总分数', paramStyle: 'weighted', paramWeights: [3, 4, 6, 3, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A15', list: 'A', desc: '连续{x}次在T5得到前3高的总分数', paramStyle: 'weighted', paramWeights: [6, 3, 1], paramVals: [2, 3, 4] },
  { id: 'A16', list: 'A', desc: '总计{x}次在T5得到前3高的总分数', paramStyle: 'weighted', paramWeights: [3, 4, 6, 3, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A17', list: 'A', desc: '连续{x}次在T6得到前3高的总分数', paramStyle: 'weighted', paramWeights: [6, 3, 1], paramVals: [2, 3, 4] },
  { id: 'A18', list: 'A', desc: '总计{x}次在T6得到前3高的总分数', paramStyle: 'weighted', paramWeights: [3, 4, 6, 3, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A19', list: 'A', desc: '连续{x}次在T7得到前3高的总分数', paramStyle: 'weighted', paramWeights: [6, 3, 1], paramVals: [2, 3, 4] },
  { id: 'A20', list: 'A', desc: '总计{x}次在T7得到前3高的总分数', paramStyle: 'weighted', paramWeights: [3, 4, 6, 3, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A21', list: 'A', desc: '连续{x}次在T8得到前3高的总分数', paramStyle: 'weighted', paramWeights: [6, 3, 1], paramVals: [2, 3, 4] },
  { id: 'A22', list: 'A', desc: '总计{x}次在T8得到前3高的总分数', paramStyle: 'weighted', paramWeights: [3, 4, 6, 3, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A23', list: 'A', desc: '连续{x}次在T9得到前3高的总分数', paramStyle: 'weighted', paramWeights: [6, 3, 1], paramVals: [2, 3, 4] },
  { id: 'A24', list: 'A', desc: '总计{x}次在T9得到前3高的总分数', paramStyle: 'weighted', paramWeights: [3, 4, 6, 3, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A25', list: 'A', desc: '总计{x}次在T1得到前3低的总分数', paramStyle: 'weighted', paramWeights: [6, 4, 4, 2, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A26', list: 'A', desc: '总计{x}次在T2得到前3低的总分数', paramStyle: 'weighted', paramWeights: [6, 4, 4, 2, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A27', list: 'A', desc: '总计{x}次在T3得到前3低的总分数', paramStyle: 'weighted', paramWeights: [6, 4, 4, 2, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A28', list: 'A', desc: '总计{x}次在T4得到前3低的总分数', paramStyle: 'weighted', paramWeights: [6, 4, 4, 2, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A29', list: 'A', desc: '总计{x}次在T5得到前3低的总分数', paramStyle: 'weighted', paramWeights: [6, 4, 4, 2, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A30', list: 'A', desc: '总计{x}次在T6得到前3低的总分数', paramStyle: 'weighted', paramWeights: [6, 4, 4, 2, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A31', list: 'A', desc: '总计{x}次在T7得到前3低的总分数', paramStyle: 'weighted', paramWeights: [6, 4, 4, 2, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A32', list: 'A', desc: '总计{x}次在T8得到前3低的总分数', paramStyle: 'weighted', paramWeights: [6, 4, 4, 2, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A33', list: 'A', desc: '总计{x}次在T9得到前3低的总分数', paramStyle: 'weighted', paramWeights: [6, 4, 4, 2, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A34', list: 'A', desc: '获得{x}次排名4~9', paramStyle: 'weighted', paramWeights: [6, 4, 4, 2, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A35', list: 'A', desc: '获得{x}次排名7~12', paramStyle: 'weighted', paramWeights: [6, 4, 4, 2, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'A36', list: 'A', desc: '获得{x}次排名12', paramStyle: 'weighted', paramWeights: [6, 3, 1], paramVals: [1, 2, 3] },
  { id: 'B01', list: 'B', desc: '在T1中达成{x}次勇气', paramStyle: 'weighted', paramWeights: [6, 4, 4, 2, 2, 1, 1], paramVals: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'B02', list: 'B', desc: '在T1中独享过公正（仅你一人选择某个公正选项）', paramStyle: 'none' },
  { id: 'B03', list: 'B', desc: '单回合在T2~T5中，全部获得前三高的分数', paramStyle: 'none' },
  { id: 'B04', list: 'B', desc: '单回合在T2~T5中，全部获得前三低的分数', paramStyle: 'none' },
  { id: 'B05', list: 'B', desc: '单回合在T2~T5中，全部未获得最高或最低的分数', paramStyle: 'none' },
  { id: 'B06', list: 'B', desc: '单回合在T1~T5完全选同一选项，且最终结算排名为1~6', paramStyle: 'none' },
  { id: 'B07', list: 'B', desc: '单回合在T1~T5完全选不同选项，且最终结算排名为1~6', paramStyle: 'none' },
  { id: 'B08', list: 'B', desc: '累计选择{x}个A选项（含多选）', paramStyle: 'normal', paramMean: 10, paramStddev: 3 },
  { id: 'B09', list: 'B', desc: '累计选择{x}个B选项（含多选）', paramStyle: 'normal', paramMean: 10, paramStddev: 3 },
  { id: 'B10', list: 'B', desc: '累计选择{x}个C选项（含多选）', paramStyle: 'normal', paramMean: 10, paramStddev: 3 },
  { id: 'B11', list: 'B', desc: '累计选择{x}个D选项（含多选）', paramStyle: 'normal', paramMean: 10, paramStddev: 3 },
  { id: 'B12', list: 'B', desc: '累计获得{x}次单题得分倒数第一', paramStyle: 'normal', paramMean: 15, paramStddev: 4 },
  { id: 'B13', list: 'B', desc: '某回合你的作答与另一玩家至少完全重合{x}题', paramStyle: 'weighted', paramWeights: [10, 6, 3, 1], paramVals: [4, 5, 6, 7] },
  { id: 'B14', list: 'B', desc: '在T6回答过0~9所有整数答案', paramStyle: 'none' },
  { id: 'B15', list: 'B', desc: '单回合在T7~T9的选择项数完全相同，且最终结算排名为1~6', paramStyle: 'none' },
  { id: 'B16', list: 'B', desc: '单回合在T7~T9的选择项数完全不相同，且最终结算排名为1~6', paramStyle: 'none' },
  { id: 'B17', list: 'B', desc: '连续3次在除T10外某题获得最高的分数', paramStyle: 'none' },
  { id: 'B18', list: 'B', desc: '连续3次在除T10外某题获得最低的分数', paramStyle: 'none' },
  { id: 'B19', list: 'B', desc: '选择了T10的B选项并成功触发条件', paramStyle: 'none' },
  { id: 'B20', list: 'B', desc: 'T7~T9某题仅选择1个选项且在该题的得分前三高', paramStyle: 'none' },
  { id: 'B21', list: 'B', desc: 'T7~T9某题仅选择1个选项且在该题的得分前三低', paramStyle: 'none' },
  { id: 'B22', list: 'B', desc: '单回合所有题目均未选中人数最多项', paramStyle: 'none' },
  { id: 'B23', list: 'B', desc: '在某题拿到最高分数，且比第二高的玩家至少多获得5分，并列最高不视为完成', paramStyle: 'none' },
  { id: 'B24', list: 'B', desc: '单回合所有题目均未获得恰好0分', paramStyle: 'none' },
  { id: 'B25', list: 'B', desc: '某回合你未完成你的盘面上的任何未完成任务', paramStyle: 'none' },
  { id: 'B26', list: 'B', desc: '你的问卷填写时间在所有人中最短的三位', paramStyle: 'none' },
  { id: 'B27', list: 'B', desc: '某回合你的分数绝对值小于3', paramStyle: 'none' },
  { id: 'B28', list: 'B', desc: '你在T3~T9任一一题结算后排名9~12，但最终结算排名为1~3', paramStyle: 'none' },
  { id: 'B29', list: 'B', desc: '累计{x}个回合你的得分取两位小数（向下取整）包含7', paramStyle: 'weighted', paramWeights: [6, 3, 1], paramVals: [1, 2, 3] },
  { id: 'B30', list: 'B', desc: '在T10中选择B选项并最终结算排名为1', paramStyle: 'none' },
  { id: 'B31', list: 'B', desc: '你全收集第1~4/5~8/9~12区间之一内所有名次', paramStyle: 'none' },
  { id: 'B32', list: 'B', desc: '你全收集第3n+k某一k(0~2)取值的范围内所有名次', paramStyle: 'none' },
  { id: 'B33', list: 'B', desc: '你全收集第4n+k某一k(0~3)取值的范围内所有名次', paramStyle: 'none' },
  { id: 'B34', list: 'B', desc: '你在答题时间<=120s的情况下获得前三（以腾讯问卷数据为准）', paramStyle: 'none' },
];

function getTaskDef(id) { const defs = _taskDefs || TASK_DEFS; return defs.find(t => t.id === id); }
function generateTaskParam(def) {
  if (def.paramStyle === 'weighted') return weightedPick(def.paramVals.map((v, i) => ({ v, w: def.paramWeights[i] })), x => x.w).v;
  if (def.paramStyle === 'normal') return normalInt(def.paramMean, def.paramStddev);
  return null;
}
function taskDisplay(def, param) { let d = def.desc; if (param != null) d = d.replace('{x}', param); return d; }
function createBoard(taskItems) {
  const board = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    const t = taskItems[r * 5 + c]; board.push({ id: t.id, param: t.param });
  }
  return board;
}

// ===== 棋盘检测 =====
function getLines() {
  const lines = [];
  for (let r = 0; r < 5; r++) lines.push([...Array(5)].map((_, c) => r * 5 + c));
  for (let c = 0; c < 5; c++) lines.push([...Array(5)].map((_, r) => r * 5 + c));
  lines.push([0, 6, 12, 18, 24]);
  lines.push([4, 8, 12, 16, 20]);
  return lines;
}
function get2x3Regions() {
  const regions = [];
  for (let r = 0; r + 2 <= 5; r++) for (let c = 0; c + 3 <= 5; c++) {
    const cs = []; for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 3; dc++) cs.push((r + dr) * 5 + (c + dc));
    regions.push(cs);
  }
  for (let r = 0; r + 3 <= 5; r++) for (let c = 0; c + 2 <= 5; c++) {
    const cs = []; for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 2; dc++) cs.push((r + dr) * 5 + (c + dc));
    regions.push(cs);
  }
  return regions;
}
function is2x2Square(cells) {
  if (cells.length !== 4) return false;
  const s = [...cells].sort((a, b) => a - b);
  return s[1] === s[0] + 1 && s[2] === s[0] + 5 && s[3] === s[0] + 6;
}
function checkTrigger(board) {
  const lines = getLines();
  for (const line of lines) if (line.every(i => board[i])) return { triggered: true, type: 'line' };
  const regions = get2x3Regions();
  for (const reg of regions) if (reg.filter(i => board[i]).length >= 5) return { triggered: true, type: '2x3_5' };
  const q4 = regions.filter(reg => { const done = reg.filter(i => board[i]); return done.length >= 4 && !is2x2Square(done); });
  if (q4.length >= 2) return { triggered: true, type: '2x3_4x2' };
  return { triggered: false };
}
function checkWin(board) {
  const lines = getLines();
  let h = false, v = false;
  for (let i = 0; i < 5; i++) { if (lines[i].every(j => board[j])) h = true; if (lines[5 + i].every(j => board[j])) v = true; }
  if (h && v) return true;
  if (lines[10].every(j => board[j]) && lines[11].every(j => board[j])) return true;
  for (let r = 0; r <= 2; r++) for (let c = 0; c <= 2; c++) {
    let all = true;
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) if (!board[(r + dr) * 5 + (c + dc)]) { all = false; break; }
    if (all) return true;
  }
  return false;
}

module.exports = {
  rankScore, evaluateFormula, buildCtx, computeLadder, scoreAllQuestions,
  composeT1, parseCSV, parseCSVLine, parseJSON,
  weightedPick, normalInt, ensureDir,
  TASK_DEFS, getTaskDef, generateTaskParam, taskDisplay, createBoard, loadTasks,
  getLines, get2x3Regions, checkTrigger, checkWin
};
