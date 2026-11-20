/* core.js — 나의 가계부: 데이터 모델 · 계산 로직 (DOM 없음, 테스트 가능) */
(function (root) {
  'use strict';

  var SCHEMA = 1;
  var STORE_KEY = 'mymoney-v1';

  /* ---------------- 숫자 · 날짜 도우미 ---------------- */

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function comma(n) {
    var v = Math.round(num(n));
    var s = String(Math.abs(v));
    return (v < 0 ? '-' : '') + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function won(n) {
    return comma(Math.round(num(n))) + '원';
  }

  function trim1(x) {
    var s = (Math.round(x * 10) / 10).toFixed(1);
    return s.replace(/\.0$/, '');
  }

  /* 달력 칸에 들어가는 짧은 금액: 1.2만 / 12만 / 1.1억 */
  function wonShort(n) {
    var v = Math.round(num(n));
    var a = Math.abs(v);
    var sign = v < 0 ? '-' : '';
    if (a >= 100000000) {
      var e = a / 100000000;
      return sign + (e >= 10 ? Math.round(e) : trim1(e)) + '억';
    }
    if (a >= 10000) {
      var m = a / 10000;
      return sign + (m >= 10 ? Math.round(m) : trim1(m)) + '만';
    }
    return sign + comma(a);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function todayISO(d) {
    var t = d || new Date();
    return t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate());
  }

  function nowTime(d) {
    var t = d || new Date();
    return pad2(t.getHours()) + ':' + pad2(t.getMinutes());
  }

  function validDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  function ymOf(date) { return String(date).slice(0, 7); }

  function addMonths(ym, delta) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    var d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function daysInMonth(ym) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    return new Date(y, m, 0).getDate();
  }

  function monthEnd(ym) { return ym + '-' + pad2(daysInMonth(ym)); }

  function monthDiff(fromYm, toYm) {
    return (+toYm.slice(0, 4) - +fromYm.slice(0, 4)) * 12 + (+toYm.slice(5, 7) - +fromYm.slice(5, 7));
  }

  function monthLabel(ym) { return ym.slice(0, 4) + '년 ' + (+ym.slice(5, 7)) + '월'; }

  function monthLabelShort(ym) { return (+ym.slice(5, 7)) + '월'; }

  function dowNames() { return ['일', '월', '화', '수', '목', '금', '토']; }

  function dowOf(date) {
    var y = +date.slice(0, 4), m = +date.slice(5, 7), d = +date.slice(8, 10);
    return new Date(y, m - 1, d).getDay();
  }

  function dateLabelKo(date) {
    if (!validDate(date)) return date;
    return (+date.slice(5, 7)) + '월 ' + (+date.slice(8, 10)) + '일 (' + dowNames()[dowOf(date)] + ')';
  }

  function uid(prefix) {
    return (prefix || 'x') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function clampDay(ym, day) {
    var last = daysInMonth(ym);
    var d = Math.round(num(day));
    if (d < 1) d = 1;
    if (d > last) d = last;
    return d;
  }

  /* ---------------- 계좌 유형 ---------------- */

  var ACCOUNT_TYPES = [
    { key: 'checking', label: '입출금', emoji: '🏦', liab: false, group: 'asset' },
    { key: 'savings', label: '예·적금', emoji: '🐷', liab: false, group: 'asset' },
    { key: 'investment', label: '투자', emoji: '📈', liab: false, group: 'asset' },
    { key: 'cash', label: '현금', emoji: '💵', liab: false, group: 'asset' },
    { key: 'other', label: '기타 자산', emoji: '📦', liab: false, group: 'asset' },
    { key: 'card', label: '신용카드', emoji: '💳', liab: true, group: 'liab' },
    { key: 'loan', label: '대출', emoji: '🏛️', liab: true, group: 'liab' }
  ];

  function typeMeta(key) {
    for (var i = 0; i < ACCOUNT_TYPES.length; i++) if (ACCOUNT_TYPES[i].key === key) return ACCOUNT_TYPES[i];
    return ACCOUNT_TYPES[0];
  }

  function isLiab(type) { return typeMeta(type).liab; }

  /* ---------------- 기본 카테고리 ---------------- */

  var CAT_COLORS = ['#F0704D', '#B9793F', '#4C8DFF', '#E2599E', '#43B39B', '#8A6BDF',
    '#E45757', '#F2A63B', '#D96BA0', '#5A78D6', '#9AA3B8', '#2FA97C', '#3C9AE0', '#7E8AA8'];

  var DEFAULT_CATS = [
    { id: 'c_food', name: '식비', type: 'expense', emoji: '🍚', color: '#F0704D' },
    { id: 'c_cafe', name: '카페', type: 'expense', emoji: '☕', color: '#B9793F' },
    { id: 'c_trans', name: '교통', type: 'expense', emoji: '🚌', color: '#4C8DFF' },
    { id: 'c_shop', name: '쇼핑', type: 'expense', emoji: '🛍', color: '#E2599E' },
    { id: 'c_life', name: '생활', type: 'expense', emoji: '🧴', color: '#43B39B' },
    { id: 'c_home', name: '주거·통신', type: 'expense', emoji: '🏠', color: '#8A6BDF' },
    { id: 'c_med', name: '의료', type: 'expense', emoji: '💊', color: '#E45757' },
    { id: 'c_fun', name: '문화·여가', type: 'expense', emoji: '🎬', color: '#F2A63B' },
    { id: 'c_gift', name: '선물·경조사', type: 'expense', emoji: '🎁', color: '#D96BA0' },
    { id: 'c_edu', name: '교육', type: 'expense', emoji: '📚', color: '#5A78D6' },
    { id: 'c_etc', name: '기타', type: 'expense', emoji: '📌', color: '#9AA3B8' },
    { id: 'i_salary', name: '월급', type: 'income', emoji: '💼', color: '#2FA97C' },
    { id: 'i_allow', name: '용돈', type: 'income', emoji: '👛', color: '#46B7A0' },
    { id: 'i_side', name: '부수입', type: 'income', emoji: '💡', color: '#3C9AE0' },
    { id: 'i_fin', name: '이자·배당', type: 'income', emoji: '📈', color: '#5C7CFA' },
    { id: 'i_etc', name: '기타수입', type: 'income', emoji: '➕', color: '#7E8AA8' }
  ];

  function defaultCats() {
    return DEFAULT_CATS.map(function (c) { return { id: c.id, name: c.name, type: c.type, emoji: c.emoji, color: c.color, custom: false }; });
  }

  function makeCat(name, type, emoji, seed) {
    var color = CAT_COLORS[Math.abs(seed || 0) % CAT_COLORS.length];
    return { id: uid(type === 'income' ? 'ic' : 'cc'), name: name, type: type, emoji: emoji || (type === 'income' ? '➕' : '🏷'), color: color, custom: true };
  }

  /* ---------------- 상태 ---------------- */

  function freshState() {
    return {
      v: SCHEMA,
      settings: { sample: false, onboarded: false, createdAt: new Date().toISOString() },
      accounts: [
        { id: 'acc_checking', name: '입출금 계좌', type: 'checking', opening: 0, order: 0, active: true, memo: '' },
        { id: 'acc_cash', name: '현금', type: 'cash', opening: 0, order: 1, active: true, memo: '' },
        { id: 'acc_card', name: '신용카드', type: 'card', opening: 0, order: 2, active: true, memo: '' }
      ],
      categories: defaultCats(),
      txns: [],
      budgets: {},
      recurring: []
    };
  }

  /* ---------------- 계좌 잔액 ---------------- */

  /* 계좌 하나에 거래들이 만든 순변화 (개시 잔액 제외) */
  function accountFlow(state, accId, type, upto) {
    var liab = isLiab(type);
    var sum = 0;
    var list = state.txns || [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (upto && t.date > upto) continue;
      var amt = num(t.amount);
      if (t.type === 'expense') {
        if (t.accountId === accId) sum += liab ? amt : -amt;
      } else if (t.type === 'income') {
        if (t.accountId === accId) sum += liab ? -amt : amt;
      } else if (t.type === 'transfer') {
        if (t.accountId === accId) sum += liab ? amt : -amt;
        if (t.toAccountId === accId) {
          var toLiab = isLiab((findAccount(state, t.toAccountId) || {}).type || 'checking');
          sum += toLiab ? -amt : amt;
        }
      }
    }
    return sum;
  }

  function findAccount(state, id) {
    var list = state.accounts || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function findCat(state, id) {
    var list = state.categories || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* 잔액: 자산은 보유액, 부채는 갚아야 할 금액(양수) */
  function accountBalance(state, accId, upto) {
    var acc = findAccount(state, accId);
    if (!acc) return 0;
    return num(acc.opening) + accountFlow(state, accId, acc.type, upto);
  }

  /* 목표 잔액에 맞춰 개시 잔액을 조정 (거래 내역은 그대로 유지) */
  function setAccountBalance(state, accId, target, typeOverride) {
    var acc = findAccount(state, accId);
    if (!acc) return null;
    var type = typeOverride || acc.type;
    var flow = accountFlow(state, accId, type);
    acc.opening = Math.round(num(target) - flow);
    return acc;
  }

  function sortedAccounts(state, includeHidden) {
    return (state.accounts || [])
      .filter(function (a) { return includeHidden || a.active !== false; })
      .slice()
      .sort(function (a, b) {
        var ga = isLiab(a.type) ? 1 : 0, gb = isLiab(b.type) ? 1 : 0;
        if (ga !== gb) return ga - gb;
        return num(a.order) - num(b.order);
      });
  }

  /* ---------------- 순자산 ---------------- */

  function netWorth(state, upto) {
    var assets = 0, liabs = 0, byType = {}, rows = [];
    var accounts = state.accounts || [];
    for (var i = 0; i < accounts.length; i++) {
      var a = accounts[i];
      var bal = accountBalance(state, a.id, upto);
      var liab = isLiab(a.type);
      if (a.active !== false) {
        if (liab) liabs += bal; else assets += bal;
        var k = a.type;
        if (!byType[k]) byType[k] = { type: k, label: typeMeta(k).label, emoji: typeMeta(k).emoji, amount: 0, liab: liab };
        byType[k].amount += bal;
      }
      rows.push({ account: a, balance: bal, liab: liab });
    }
    return { assets: assets, liabs: liabs, net: assets - liabs, byType: byType, rows: rows };
  }

  /* ---------------- 월 집계 ---------------- */

  function txnsInMonth(state, ym) {
    return (state.txns || []).filter(function (t) { return ymOf(t.date) === ym; });
  }

  function summary(state, ym) {
    var out = {
      ym: ym, income: 0, expense: 0, net: 0, transfer: 0, count: 0,
      byDay: {}, expenseByCat: {}, incomeByCat: {}, expenseByAccount: {}, incomeByAccount: {}
    };
    var list = txnsInMonth(state, ym);
    for (var i = 0; i < list.length; i++) {
      var t = list[i], amt = num(t.amount);
      var d = t.date;
      if (!out.byDay[d]) out.byDay[d] = { income: 0, expense: 0, count: 0 };
      if (t.type === 'expense') {
        out.expense += amt; out.count++;
        out.byDay[d].expense += amt; out.byDay[d].count++;
        out.expenseByCat[t.categoryId] = num(out.expenseByCat[t.categoryId]) + amt;
        out.expenseByAccount[t.accountId] = num(out.expenseByAccount[t.accountId]) + amt;
      } else if (t.type === 'income') {
        out.income += amt; out.count++;
        out.byDay[d].income += amt; out.byDay[d].count++;
        out.incomeByCat[t.categoryId] = num(out.incomeByCat[t.categoryId]) + amt;
        out.incomeByAccount[t.accountId] = num(out.incomeByAccount[t.accountId]) + amt;
      } else if (t.type === 'transfer') {
        out.transfer += amt; out.count++;
        out.byDay[d].count++;
      }
    }
    out.net = out.income - out.expense;
    return out;
  }

  function categoryBreakdown(state, ym, type) {
    type = type || 'expense';
    var cur = summary(state, ym);
    var prev = summary(state, addMonths(ym, -1));
    var map = type === 'income' ? cur.incomeByCat : cur.expenseByCat;
    var prevMap = type === 'income' ? prev.incomeByCat : prev.expenseByCat;
    var total = type === 'income' ? cur.income : cur.expense;
    var rows = [];
    Object.keys(map).forEach(function (cid) {
      if (!num(map[cid])) return;
      var cat = findCat(state, cid);
      var amount = num(map[cid]);
      var prevAmt = num(prevMap[cid]);
      rows.push({
        categoryId: cid,
        name: cat ? cat.name : '미분류',
        emoji: cat ? cat.emoji : '❓',
        color: cat ? cat.color : '#9AA3B8',
        amount: amount,
        pct: total > 0 ? (amount / total * 100) : 0,
        prevAmount: prevAmt,
        deltaPct: prevAmt > 0 ? ((amount - prevAmt) / prevAmt * 100) : null,
        deltaAmount: amount - prevAmt
      });
    });
    if (!rows.length && total > 0) {
      rows.push({ categoryId: '', name: '미분류', emoji: '❓', color: '#9AA3B8', amount: total, pct: 100, prevAmount: num(prev.total), deltaPct: null, deltaAmount: total });
    }
    rows.sort(function (a, b) { return b.amount - a.amount; });
    return rows;
  }

  /* 결제수단(계좌)별 지출 */
  function accountBreakdown(state, ym) {
    var cur = summary(state, ym);
    var rows = [];
    Object.keys(cur.expenseByAccount).forEach(function (aid) {
      var acc = findAccount(state, aid);
      var amount = num(cur.expenseByAccount[aid]);
      if (!amount) return;
      rows.push({
        accountId: aid,
        name: acc ? acc.name : '알 수 없는 계좌',
        type: acc ? acc.type : 'checking',
        typeLabel: typeMeta(acc ? acc.type : 'checking').label,
        emoji: typeMeta(acc ? acc.type : 'checking').emoji,
        amount: amount,
        pct: cur.expense > 0 ? amount / cur.expense * 100 : 0
      });
    });
    rows.sort(function (a, b) { return b.amount - a.amount; });
    return rows;
  }

  function monthlyTrend(state, endYm, n) {
    n = n || 6;
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var ym = addMonths(endYm, -i);
      var s = summary(state, ym);
      out.push({ ym: ym, income: s.income, expense: s.expense, net: s.net });
    }
    return out;
  }

  function netWorthTrend(state, endYm, n, uptoDay) {
    n = n || 12;
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var ym = addMonths(endYm, -i);
      var cutoff = (i === 0) ? (uptoDay || monthEnd(ym)) : monthEnd(ym);
      if (i === 0 && cutoff > monthEnd(ym)) cutoff = monthEnd(ym);
      var nw = netWorth(state, cutoff);
      out.push({ ym: ym, assets: nw.assets, liabs: nw.liabs, net: nw.net });
    }
    return out;
  }

  /* ---------------- 예산 ---------------- */

  function budgetOf(state, ym) {
    var b = (state.budgets || {})[ym] || {};
    return { total: num(b.total), cats: b.cats || {} };
  }

  function budgetUsage(state, ym) {
    var b = budgetOf(state, ym);
    var s = summary(state, ym);
    var cats = [];
    Object.keys(b.cats).forEach(function (cid) {
      var budget = num(b.cats[cid]);
      if (!budget) return;
      var cat = findCat(state, cid);
      var spent = num(s.expenseByCat[cid]);
      cats.push({
        categoryId: cid,
        name: cat ? cat.name : '미분류',
        emoji: cat ? cat.emoji : '❓',
        color: cat ? cat.color : '#9AA3B8',
        budget: budget, spent: spent,
        pct: budget > 0 ? spent / budget * 100 : 0,
        left: budget - spent
      });
    });
    cats.sort(function (a, b) { return b.pct - a.pct; });
    return {
      total: b.total,
      spent: s.expense,
      left: b.total - s.expense,
      pct: b.total > 0 ? s.expense / b.total * 100 : 0,
      cats: cats,
      hasBudget: b.total > 0 || cats.length > 0
    };
  }

  /* ---------------- 고정비 ---------------- */

  function recurringPending(state, ym) {
    var list = (state.recurring || []).filter(function (r) { return r.active !== false; });
    return list.filter(function (r) {
      return !(state.txns || []).some(function (t) { return t.rid === r.id && ymOf(t.date) === ym; });
    });
  }

  function applyRecurring(state, ym) {
    var pending = recurringPending(state, ym);
    var made = [];
    pending.forEach(function (r) {
      var day = clampDay(ym, r.day);
      var t = {
        id: uid('t'),
        type: r.type === 'income' ? 'income' : 'expense',
        amount: Math.abs(Math.round(num(r.amount))),
        date: ym + '-' + pad2(day),
        time: r.time || '09:00',
        categoryId: r.categoryId || '',
        accountId: r.accountId || '',
        toAccountId: '',
        memo: r.name || '고정비',
        createdAt: new Date().toISOString(),
        src: 'recurring',
        rid: r.id
      };
      if (t.amount > 0) { state.txns.push(t); made.push(t); }
    });
    return made;
  }

  /* ---------------- CSV ---------------- */

  function detectDelimiter(text) {
    var head = String(text || '').split(/\r?\n/).slice(0, 6).join('\n');
    var counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
    var inQ = false;
    for (var i = 0; i < head.length; i++) {
      var ch = head[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (inQ) continue;
      if (counts[ch] !== undefined) counts[ch]++;
    }
    var best = ',', bestN = -1;
    Object.keys(counts).forEach(function (k) {
      if (counts[k] > bestN) { bestN = counts[k]; best = k; }
    });
    return best;
  }

  function parseCSV(text) {
    text = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    var delim = detectDelimiter(text);
    var rows = [], row = [], field = '', inQ = false, i = 0;
    while (i < text.length) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQ = true; i++; continue; }
      if (ch === delim) { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; i++; continue; }
      field += ch; i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
    return { rows: rows, delimiter: delim };
  }

  function parseAmount(v) {
    if (v == null) return null;
    var s = String(v).trim();
    if (!s) return null;
    s = s.replace(/[\s\u00A0₩원]/g, '').replace(/,/g, '');
    if (!s) return null;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/^[-−–]/.test(s)) { neg = true; s = s.replace(/^[-−–]/, ''); }
    else if (/^\+/.test(s)) { s = s.slice(1); }
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    var n = Math.round(parseFloat(s));
    return neg ? -n : n;
  }

  function ymd(y, m, d) {
    var s = y + '-' + pad2(m) + '-' + pad2(d);
    return validDate(s) ? s : null;
  }

  function parseDateCell(v) {
    if (v == null) return null;
    var s = String(v).trim();
    if (!s) return null;
    s = s.replace(/[T]\d{1,2}:\d{2}(:\d{2})?.*$/, '').replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, '');
    var m;
    if ((m = s.match(/^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})일?$/))) return ymd(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return ymd(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{2})[-./](\d{1,2})[-./](\d{1,2})$/))) {
      var yy = +m[1];
      return ymd(yy < 70 ? 2000 + yy : (yy < 100 ? 1900 + yy : yy), +m[2], +m[3]);
    }
    if ((m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/))) return ymd(+m[3], +m[1], +m[2]);
    return null;
  }

  function headerGuess(header) {
    var map = {};
    header.forEach(function (h, idx) {
      var s = String(h || '').toLowerCase().replace(/\s/g, '');
      if (map.date === undefined && /(날짜|일자|거래일|date)/.test(s)) map.date = idx;
      if (map.memo === undefined && /(메모|내용|적요|사용처|가맹점|memo|desc)/.test(s)) map.memo = idx;
      if (map.category === undefined && /(카테고리|분류|항목|category)/.test(s)) map.category = idx;
      if (map.toAccount === undefined && /(받는\s*계좌|받는계좌|입금계좌|to\s*account)/.test(s)) map.toAccount = idx;
      else if (map.account === undefined && /(결제수단|계좌|카드|통장|account|payment)/.test(s)) map.account = idx;
      if (map.type === undefined && /(구분|유형|타입|type)/.test(s)) map.type = idx;
      if (map.expense === undefined && /(지출|출금|사용금액|승인금액|expense|out)/.test(s)) map.expense = idx;
      if (map.income === undefined && /(수입|입금|income|in)/.test(s)) map.income = idx;
      if (map.amount === undefined && /(금액|amount|합계)/.test(s)) map.amount = idx;
    });
    if (map.amount !== undefined && map.expense !== undefined && map.amount === map.expense && map.income === undefined) {
      /* '사용금액'은 지출 컬럼으로만 쓰이게 둔다 */
      delete map.amount;
    }
    return map;
  }

  /* 한 금액 컬럼만 있을 때: 음수가 섞여 있으면 부호대로, 모두 양수면 지출로 보는 게 보통 */
  function guessAmountMode(rows, col, hasHeader) {
    var start = hasHeader ? 1 : 0, hasNeg = false;
    for (var i = start; i < rows.length; i++) {
      var a = parseAmount(rows[i][col]);
      if (a != null && a < 0) { hasNeg = true; break; }
    }
    return hasNeg ? 'sign' : 'expense';
  }

  function accountTypeFromName(name) {
    var s = String(name || '');
    if (/카드/.test(s)) return 'card';
    if (/현금/.test(s)) return 'cash';
    if (/(적금|예금|저축)/.test(s)) return 'savings';
    if (/(증권|주식|투자|코인)/.test(s)) return 'investment';
    if (/(대출|론)/.test(s)) return 'loan';
    return 'checking';
  }

  /* CSV 행 → 거래 목록 (상태는 건드리지 않음) */
  function csvToTxns(state, rows, opt) {
    opt = opt || {};
    var map = opt.map || {};
    var mode = opt.amountMode || 'sign'; /* sign | expense | income */
    var start = opt.hasHeader ? 1 : 0;
    var made = [], skipped = 0, badDate = 0;
    var newAccounts = [], newCats = [];
    var accByName = {}, catByName = {};
    (state.accounts || []).forEach(function (a) { accByName[a.name.trim().toLowerCase()] = a; });
    (state.categories || []).forEach(function (c) { catByName[(c.type + '|' + c.name).trim().toLowerCase()] = c; });

    function resolveAcc(name, add) {
      if (!name) return null;
      var key = String(name).trim().toLowerCase();
      if (!key) return null;
      if (accByName[key]) return accByName[key];
      if (!add) return null;
      var acc = {
        id: uid('acc'), name: String(name).trim(), type: accountTypeFromName(name), opening: 0,
        order: (state.accounts || []).length + newAccounts.length, active: true, memo: 'CSV에서 추가'
      };
      accByName[key] = acc;
      newAccounts.push(acc);
      return acc;
    }

    for (var r = start; r < rows.length; r++) {
      var row = rows[r];
      var date = map.date != null ? parseDateCell(row[map.date]) : null;
      if (!date) { badDate++; continue; }

      var expAmt = map.expense != null ? parseAmount(row[map.expense]) : null;
      var incAmt = map.income != null ? parseAmount(row[map.income]) : null;
      var oneAmt = map.amount != null ? parseAmount(row[map.amount]) : null;

      var typeText = map.type != null ? String(row[map.type] || '').trim() : '';
      var catName = map.category != null ? String(row[map.category] || '').trim() : '';
      var accName = map.account != null ? String(row[map.account] || '').trim() : '';
      var toName = map.toAccount != null ? String(row[map.toAccount] || '').trim() : '';
      var memo = map.memo != null ? String(row[map.memo] || '').trim() : '';

      /* 이체 행: 보내는 계좌 → 받는 계좌 */
      if (/이체|transfer|옮김/.test(typeText)) {
        var tAmt = 0;
        if (oneAmt != null) tAmt = Math.abs(oneAmt);
        else if (expAmt != null) tAmt = Math.abs(expAmt);
        if (!tAmt) { skipped++; continue; }
        var fromA = resolveAcc(accName, opt.addMissing) || findAccount(state, opt.defaultAccountId) || null;
        var toA = resolveAcc(toName, opt.addMissing);
        if (!fromA || !toA || fromA.id === toA.id) { skipped++; continue; }
        made.push({
          id: uid('t'), type: 'transfer', amount: tAmt, date: date, time: '12:00',
          categoryId: '', accountId: fromA.id, toAccountId: toA.id, memo: memo,
          createdAt: new Date().toISOString(), src: 'csv'
        });
        continue;
      }

      var type = '', amount = 0;
      if (expAmt && Math.abs(expAmt) > 0 && (!incAmt || Math.abs(incAmt) === 0)) {
        type = 'expense'; amount = Math.abs(expAmt);
      } else if (incAmt && Math.abs(incAmt) > 0 && (!expAmt || Math.abs(expAmt) === 0)) {
        type = 'income'; amount = Math.abs(incAmt);
      } else if (oneAmt != null && oneAmt !== 0) {
        if (/수입|입금|income|in\b/i.test(typeText)) { type = 'income'; amount = Math.abs(oneAmt); }
        else if (/지출|출금|expense|out\b/i.test(typeText)) { type = 'expense'; amount = Math.abs(oneAmt); }
        else if (mode === 'expense') { type = 'expense'; amount = Math.abs(oneAmt); }
        else if (mode === 'income') { type = 'income'; amount = Math.abs(oneAmt); }
        else { type = oneAmt < 0 ? 'expense' : 'income'; amount = Math.abs(oneAmt); }
      } else {
        skipped++; continue;
      }
      if (!amount) { skipped++; continue; }

      var cat = null;
      if (catName) cat = catByName[(type + '|' + catName).toLowerCase()] || null;
      if (!cat && catName && opt.addMissing) {
        cat = makeCat(catName, type, type === 'income' ? '➕' : '🏷', catName.length + type.length);
        catByName[(type + '|' + catName).toLowerCase()] = cat;
        newCats.push(cat);
      }
      if (!cat) cat = catByName[(type + '|기타' + (type === 'income' ? '수입' : ''))] || null;

      var acc = resolveAcc(accName, opt.addMissing);
      if (!acc) acc = findAccount(state, opt.defaultAccountId) || (state.accounts || [])[0] || null;

      made.push({
        id: uid('t'),
        type: type,
        amount: amount,
        date: date,
        time: '12:00',
        categoryId: cat ? cat.id : '',
        accountId: acc ? acc.id : '',
        toAccountId: '',
        memo: memo,
        createdAt: new Date().toISOString(),
        src: 'csv'
      });
    }
    return { txns: made, skipped: skipped, badDate: badDate, newAccounts: newAccounts, newCats: newCats };
  }

  function dedupeKey(t) {
    return [t.date, t.type, Math.round(num(t.amount)), String(t.memo || '').trim().toLowerCase(), t.accountId || ''].join('|');
  }

  function mergeTxns(state, incoming) {
    var seen = {};
    (state.txns || []).forEach(function (t) { seen[dedupeKey(t)] = 1; });
    var added = 0, skipped = 0;
    incoming.forEach(function (t) {
      var k = dedupeKey(t);
      if (seen[k]) { skipped++; return; }
      seen[k] = 1;
      state.txns.push(t);
      added++;
    });
    return { added: added, skipped: skipped };
  }

  function toCSV(state, list) {
    list = list || (state.txns || []);
    var head = ['날짜', '시간', '구분', '카테고리', '금액', '결제수단', '받는계좌', '메모'];
    function q(v) {
      var s = String(v == null ? '' : v);
      if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    var lines = [head.join(',')];
    list.slice().sort(function (a, b) {
      return (a.date + a.time).localeCompare(b.date + b.time);
    }).forEach(function (t) {
      var cat = findCat(state, t.categoryId) || {};
      var acc = findAccount(state, t.accountId) || {};
      var to = findAccount(state, t.toAccountId) || {};
      lines.push([
        t.date, t.time || '', t.type === 'expense' ? '지출' : (t.type === 'income' ? '수입' : '이체'),
        cat.name || '', t.type === 'transfer' ? -num(t.amount) : (t.type === 'income' ? num(t.amount) : -num(t.amount)),
        acc.name || '', to.name || '', t.memo || ''
      ].map(q).join(','));
    });
    return '\uFEFF' + lines.join('\r\n');
  }

  /* ---------------- 백업 ---------------- */

  function exportJSON(state) {
    return JSON.stringify({ app: 'my-money', v: SCHEMA, exportedAt: new Date().toISOString(), state: state }, null, 2);
  }

  function normalizeState(raw) {
    var src = raw && raw.state && typeof raw.state === 'object' ? raw.state : raw;
    if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
    var st = freshState();
    st.settings = {
      sample: !!(src.settings && src.settings.sample),
      onboarded: !!(src.settings && src.settings.onboarded),
      createdAt: (src.settings && src.settings.createdAt) || new Date().toISOString()
    };

    if (Array.isArray(src.categories) && src.categories.length) {
      st.categories = src.categories.filter(function (c) { return c && c.id && c.name; }).map(function (c) {
        return {
          id: String(c.id), name: String(c.name),
          type: c.type === 'income' ? 'income' : 'expense',
          emoji: c.emoji || '🏷', color: c.color || '#9AA3B8', custom: !!c.custom
        };
      });
      if (!st.categories.length) st.categories = defaultCats();
    }

    if (Array.isArray(src.accounts)) {
      var seenIds = {};
      st.accounts = src.accounts.filter(function (a) { return a && a.id && a.name; }).map(function (a, i) {
        var id = String(a.id);
        if (seenIds[id]) id = id + '_' + i;
        seenIds[id] = 1;
        return {
          id: id, name: String(a.name),
          type: typeMeta(a.type).key,
          opening: Math.round(num(a.opening)),
          order: a.order == null ? i : Math.round(num(a.order)),
          active: a.active !== false,
          memo: a.memo ? String(a.memo) : ''
        };
      });
    }

    if (Array.isArray(src.txns)) {
      st.txns = src.txns.filter(function (t) {
        return t && (t.type === 'expense' || t.type === 'income' || t.type === 'transfer') &&
          validDate(t.date) && Math.abs(Math.round(num(t.amount))) > 0;
      }).map(function (t, i) {
        return {
          id: t.id ? String(t.id) : ('t_' + i + '_' + Math.random().toString(36).slice(2, 6)),
          type: t.type,
          amount: Math.abs(Math.round(num(t.amount))),
          date: t.date,
          time: /^\d{2}:\d{2}$/.test(t.time || '') ? t.time : '12:00',
          categoryId: t.categoryId ? String(t.categoryId) : '',
          accountId: t.accountId ? String(t.accountId) : '',
          toAccountId: t.type === 'transfer' && t.toAccountId ? String(t.toAccountId) : '',
          memo: t.memo ? String(t.memo) : '',
          createdAt: t.createdAt || new Date().toISOString(),
          src: t.src || '',
          rid: t.rid || ''
        };
      });
    }

    if (src.budgets && typeof src.budgets === 'object') {
      Object.keys(src.budgets).forEach(function (ym) {
        if (!/^\d{4}-\d{2}$/.test(ym)) return;
        var b = src.budgets[ym] || {};
        st.budgets[ym] = { total: Math.max(0, Math.round(num(b.total))), cats: {} };
        if (b.cats && typeof b.cats === 'object') {
          Object.keys(b.cats).forEach(function (cid) {
            var v = Math.round(num(b.cats[cid]));
            if (v > 0) st.budgets[ym].cats[cid] = v;
          });
        }
      });
    }

    if (Array.isArray(src.recurring)) {
      st.recurring = src.recurring.filter(function (r) { return r && r.name; }).map(function (r, i) {
        return {
          id: r.id ? String(r.id) : ('r_' + i),
          name: String(r.name),
          type: r.type === 'income' ? 'income' : 'expense',
          amount: Math.abs(Math.round(num(r.amount))),
          day: Math.min(31, Math.max(1, Math.round(num(r.day) || 1))),
          categoryId: r.categoryId ? String(r.categoryId) : '',
          accountId: r.accountId ? String(r.accountId) : '',
          active: r.active !== false
        };
      });
    }
    return st;
  }

  function importJSON(text) {
    var data;
    try { data = JSON.parse(String(text)); } catch (e) { return null; }
    return normalizeState(data);
  }

  /* ---------------- 샘플 데이터 (가상 인물의 예시) ---------------- */

  function sampleState(today) {
    var base = todayISO(today);
    var ym = ymOf(base);
    var st = freshState();
    st.settings.sample = true;
    st.settings.onboarded = true;

    st.accounts = [
      { id: 'acc_bank', name: '주거래 입출금', type: 'checking', opening: 1250000, order: 0, active: true, memo: '' },
      { id: 'acc_save', name: '청년 적금', type: 'savings', opening: 4200000, order: 1, active: true, memo: '' },
      { id: 'acc_invest', name: '투자 계좌', type: 'investment', opening: 3150000, order: 2, active: true, memo: '' },
      { id: 'acc_wallet', name: '현금 지갑', type: 'cash', opening: 80000, order: 3, active: true, memo: '' },
      { id: 'acc_credit', name: '신용카드', type: 'card', opening: 0, order: 4, active: true, memo: '' },
      { id: 'acc_loan', name: '신용대출', type: 'loan', opening: 5000000, order: 5, active: true, memo: '' },
      { id: 'acc_old', name: '옛 통장(숨김)', type: 'checking', opening: 0, order: 6, active: false, memo: '정리한 계좌' }
    ];

    var seed = 20261103;
    function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
    function pick(a) { return a[Math.floor(rnd() * a.length)]; }
    function between(a, b) { return a + Math.round(rnd() * (b - a)); }

    var templates = [
      { cat: 'c_food', memo: ['점심 김치찌개', '저녁 분식', '편의점 도시락', '배달 치킨', '국밥'], min: 6000, max: 24000, acc: 'acc_bank', times: 12 },
      { cat: 'c_cafe', memo: ['아메리카노', '카페 라떼', '디저트 카페'], min: 3500, max: 7500, acc: 'acc_credit', times: 9 },
      { cat: 'c_trans', memo: ['지하철', '버스', '택시'], min: 1400, max: 9000, acc: 'acc_credit', times: 10 },
      { cat: 'c_shop', memo: ['생필품', '무선 이어폰', '옷', '화장품'], min: 8000, max: 62000, acc: 'acc_credit', times: 4 },
      { cat: 'c_life', memo: ['휴대폰 요금', '세탁', '인터넷'], min: 9000, max: 48000, acc: 'acc_credit', times: 3 },
      { cat: 'c_home', memo: ['월세'], min: 620000, max: 620000, acc: 'acc_bank', times: 1 },
      { cat: 'c_med', memo: ['약국', '병원 진료'], min: 4000, max: 18000, acc: 'acc_bank', times: 1 },
      { cat: 'c_fun', memo: ['영화', '넷플릭스', '전시회', '볼링'], min: 9000, max: 32000, acc: 'acc_credit', times: 3 },
      { cat: 'c_gift', memo: ['생일 선물', '축의금'], min: 20000, max: 100000, acc: 'acc_bank', times: 1 },
      { cat: 'c_edu', memo: ['온라인 강의', '책'], min: 12000, max: 45000, acc: 'acc_credit', times: 1 }
    ];

    for (var k = 5; k >= 0; k--) {
      var m = addMonths(ym, -k);
      var last = daysInMonth(m);
      var isThisMonth = (k === 0);
      var todayDay = isThisMonth ? (+base.slice(8, 10)) : last;

      if (todayDay >= 10) {
        st.txns.push({ id: uid('t'), type: 'income', amount: 3200000, date: m + '-10', time: '09:10', categoryId: 'i_salary', accountId: 'acc_bank', toAccountId: '', memo: '월급', createdAt: new Date().toISOString() });
      }
      if (todayDay >= 3) {
        st.txns.push({ id: uid('t'), type: 'income', amount: between(80000, 220000), date: m + '-03', time: '20:30', categoryId: 'i_side', accountId: 'acc_bank', toAccountId: '', memo: '블로그 수익', createdAt: new Date().toISOString() });
      }
      if (todayDay >= 26) {
        st.txns.push({ id: uid('t'), type: 'transfer', amount: 300000, date: m + '-26', time: '08:00', categoryId: '', accountId: 'acc_bank', toAccountId: 'acc_save', memo: '적금 자동이체', createdAt: new Date().toISOString() });
      }
      if (todayDay >= 8) {
        st.txns.push({ id: uid('t'), type: 'transfer', amount: 380000, date: m + '-08', time: '10:00', categoryId: '', accountId: 'acc_bank', toAccountId: 'acc_credit', memo: '카드값 납부', createdAt: new Date().toISOString() });
      }
      if (todayDay >= 15) {
        st.txns.push({ id: uid('t'), type: 'expense', amount: 89000, date: m + '-15', time: '11:00', categoryId: 'c_home', accountId: 'acc_bank', toAccountId: '', memo: '통신비', createdAt: new Date().toISOString() });
      }

      if (isThisMonth && todayDay >= 1) {
        var td = m + '-' + base.slice(8, 10);
        st.txns.push({ id: uid('t'), type: 'expense', amount: 8500, date: td, time: '12:20', categoryId: 'c_food', accountId: 'acc_bank', toAccountId: '', memo: '점심 김치찌개', createdAt: new Date().toISOString() });
        st.txns.push({ id: uid('t'), type: 'expense', amount: 4800, date: td, time: '15:10', categoryId: 'c_cafe', accountId: 'acc_credit', toAccountId: '', memo: '아메리카노', createdAt: new Date().toISOString() });
        st.txns.push({ id: uid('t'), type: 'expense', amount: 1400, date: td, time: '08:40', categoryId: 'c_trans', accountId: 'acc_credit', toAccountId: '', memo: '지하철', createdAt: new Date().toISOString() });
      }

      templates.forEach(function (tpl) {
        for (var i = 0; i < tpl.times; i++) {
          var dayMax = isThisMonth ? todayDay : last;
          var day = tpl.cat === 'c_home' ? Math.min(5, dayMax) : between(1, dayMax);
          var amt = Math.round(between(tpl.min, tpl.max) / 100) * 100;
          if (tpl.cat === 'c_home') amt = 620000;
          st.txns.push({
            id: uid('t'), type: 'expense', amount: amt,
            date: m + '-' + pad2(day), time: pad2(between(7, 22)) + ':' + pad2(between(0, 55)),
            categoryId: tpl.cat, accountId: tpl.acc, toAccountId: '',
            memo: pick(tpl.memo), createdAt: new Date().toISOString()
          });
        }
      });
    }

    st.budgets[ym] = {
      total: 1500000,
      cats: { c_food: 350000, c_cafe: 90000, c_trans: 80000, c_shop: 200000, c_fun: 120000, c_life: 100000 }
    };

    st.recurring = [
      { id: 'rec_rent', name: '월세', type: 'expense', amount: 620000, day: 5, categoryId: 'c_home', accountId: 'acc_bank', active: true },
      { id: 'rec_phone', name: '휴대폰 요금', type: 'expense', amount: 89000, day: 15, categoryId: 'c_home', accountId: 'acc_bank', active: true },
      { id: 'rec_ott', name: '넷플릭스', type: 'expense', amount: 13500, day: 20, categoryId: 'c_fun', accountId: 'acc_credit', active: true }
    ];
    return st;
  }

  /* ---------------- 공통 ---------------- */

  var API = {
    SCHEMA: SCHEMA, STORE_KEY: STORE_KEY,
    ACCOUNT_TYPES: ACCOUNT_TYPES, DEFAULT_CATS: DEFAULT_CATS, CAT_COLORS: CAT_COLORS,
    num: num, comma: comma, won: won, wonShort: wonShort,
    pad2: pad2, todayISO: todayISO, nowTime: nowTime, validDate: validDate,
    ymOf: ymOf, addMonths: addMonths, daysInMonth: daysInMonth, monthEnd: monthEnd, monthDiff: monthDiff,
    monthLabel: monthLabel, monthLabelShort: monthLabelShort, dowNames: dowNames,
    dowOf: dowOf, dateLabelKo: dateLabelKo, clampDay: clampDay, uid: uid,
    typeMeta: typeMeta, isLiab: isLiab, defaultCats: defaultCats, makeCat: makeCat,
    freshState: freshState, findAccount: findAccount, findCat: findCat,
    accountFlow: accountFlow, accountBalance: accountBalance, setAccountBalance: setAccountBalance,
    sortedAccounts: sortedAccounts, netWorth: netWorth,
    txnsInMonth: txnsInMonth, summary: summary, categoryBreakdown: categoryBreakdown,
    accountBreakdown: accountBreakdown, monthlyTrend: monthlyTrend, netWorthTrend: netWorthTrend,
    budgetOf: budgetOf, budgetUsage: budgetUsage,
    recurringPending: recurringPending, applyRecurring: applyRecurring,
    detectDelimiter: detectDelimiter, parseCSV: parseCSV, parseAmount: parseAmount,
    parseDateCell: parseDateCell, headerGuess: headerGuess, csvToTxns: csvToTxns,
    guessAmountMode: guessAmountMode,
    dedupeKey: dedupeKey, mergeTxns: mergeTxns, toCSV: toCSV,
    exportJSON: exportJSON, normalizeState: normalizeState, importJSON: importJSON,
    sampleState: sampleState, accountTypeFromName: accountTypeFromName
  };

  root.MMCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
