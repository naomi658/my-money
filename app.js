/* app.js — 나의 가계부: 화면 */
(function () {
  'use strict';
  var G = typeof window !== 'undefined' ? window : globalThis;
  var C = G.MMCore;

  var S = null;
  var TAB = 'txns';
  var VIEW = {};
  var SEL = null;
  var entry = null;        // 입력/수정 중인 거래
  var csvImp = null;       // CSV 가져오기 상태
  var catForm = null;      // 카테고리 편집 폼
  var recForm = null;      // 고정비 편집 폼
  var searchSt = null;     // 검색 상태
  var monthPick = null;    // 월 선택 상태
  var jsonPending = null;  // 불러온 JSON (적용 대기)

  var ICON = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="11" cy="11" r="6.4"/><path d="M16 16l4 4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'
  };

  /* ---------------- 기본 도우미 ---------------- */

  function q(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function hexA(hex, a) {
    var s = String(hex || '#9AA3B8').replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var r = parseInt(s.slice(0, 2), 16) || 0, g = parseInt(s.slice(2, 4), 16) || 0, b = parseInt(s.slice(4, 6), 16) || 0;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function ymNow() { return C.ymOf(C.todayISO()); }

  var toastTimer = null;
  function toast(msg) {
    var t = q('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function save() {
    try {
      localStorage.setItem(C.STORE_KEY, JSON.stringify(S));
    } catch (e) {
      toast('저장 공간이 부족해 저장하지 못했어요');
    }
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(C.STORE_KEY); } catch (e) { raw = null; }
    if (!raw) { S = C.freshState(); return; }
    var st = null;
    try { st = C.normalizeState(JSON.parse(raw)); } catch (e) { st = null; }
    if (!st) {
      try { localStorage.setItem(C.STORE_KEY + '-broken-' + Date.now(), raw); } catch (e2) {}
      S = C.freshState();
      S.settings.onboarded = false;
      return;
    }
    S = st;
  }

  /* ---------------- 차트 (외부 라이브러리 없이 SVG) ---------------- */

  function svgDonut(items, size, thick, centerTop, centerVal) {
    var total = 0;
    items.forEach(function (i) { total += Math.max(0, i.value); });
    var r = (size - thick) / 2, c = size / 2, circ = 2 * Math.PI * r, off = 0, segs = '';
    if (total <= 0) {
      segs = '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="#EFEBF9" stroke-width="' + thick + '"/>';
    } else {
      items.forEach(function (it) {
        if (it.value <= 0) return;
        var len = circ * it.value / total;
        var gap = items.length > 1 && len > 4 ? 2 : 0;
        segs += '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="' + (it.color || '#9AA3B8') +
          '" stroke-width="' + thick + '" stroke-dasharray="' + Math.max(0.5, len - gap) + ' ' + circ +
          '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 ' + c + ' ' + c + ')"/>';
        off += len;
      });
    }
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' + segs +
      '<text x="' + c + '" y="' + (c - 2) + '" text-anchor="middle" font-size="10.5" fill="#9C96B0" font-weight="600">' + esc(centerTop) + '</text>' +
      '<text x="' + c + '" y="' + (c + 15) + '" text-anchor="middle" font-size="14" fill="#191527" font-weight="800">' + esc(centerVal) + '</text></svg>';
  }

  function svgBars(trend, w, h) {
    var padL = 6, padR = 6, padT = 12, padB = 22;
    var max = 1;
    trend.forEach(function (t) { max = Math.max(max, t.income, t.expense); });
    var n = Math.max(1, trend.length);
    var gw = (w - padL - padR) / n;
    var bw = Math.min(13, gw / 2.9);
    var base = h - padB, usable = base - padT;
    var out = '<svg viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">';
    out += '<line x1="' + padL + '" y1="' + base + '" x2="' + (w - padR) + '" y2="' + base + '" stroke="#EFEBF9" stroke-width="1"/>';
    trend.forEach(function (t, i) {
      var cx = padL + gw * i + gw / 2;
      var hi = t.income > 0 ? Math.max(2, usable * t.income / max) : 0;
      var he = t.expense > 0 ? Math.max(2, usable * t.expense / max) : 0;
      if (hi) out += '<rect x="' + (cx - bw - 1.5) + '" y="' + (base - hi) + '" width="' + bw + '" height="' + hi + '" rx="3.5" fill="#B9ECD9"/>';
      if (he) out += '<rect x="' + (cx + 1.5) + '" y="' + (base - he) + '" width="' + bw + '" height="' + he + '" rx="3.5" fill="#C9B9FF"/>';
      out += '<text x="' + cx + '" y="' + (h - 6) + '" text-anchor="middle" font-size="10" fill="#9C96B0" font-weight="700">' + esc(C.monthLabelShort(t.ym)) + '</text>';
    });
    out += '</svg>';
    return out;
  }

  function svgArea(points, w, h, color) {
    var padL = 8, padR = 8, padT = 12, padB = 20;
    var vals = points.map(function (p) { return p.net; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (min === max) { min = min - 1000; max = max + 1000; }
    var span = max - min;
    min = min - span * 0.18; max = max + span * 0.18; span = max - min;
    var n = Math.max(1, points.length - 1);
    var stepX = (w - padL - padR) / n;
    var y = function (v) { return padT + (h - padT - padB) * (1 - (v - min) / span); };
    var pts = points.map(function (p, i) { return [padL + stepX * i, y(p.net)]; });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (h - padB) + ' L' + pts[0][0].toFixed(1) + ' ' + (h - padB) + ' Z';
    var gid = 'ag' + Math.floor(Math.random() * 1e6);
    var out = '<svg viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity=".28"/><stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>';
    out += '<path d="' + area + '" fill="url(#' + gid + ')"/>';
    out += '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>';
    var lp = pts[pts.length - 1];
    out += '<circle cx="' + lp[0].toFixed(1) + '" cy="' + lp[1].toFixed(1) + '" r="3.6" fill="#fff" stroke="' + color + '" stroke-width="2.2"/>';
    points.forEach(function (p, i) {
      if (i % Math.ceil(points.length / 6) !== 0 && i !== points.length - 1) return;
      out += '<text x="' + (padL + stepX * i) + '" y="' + (h - 5) + '" text-anchor="middle" font-size="9.5" fill="#9C96B0" font-weight="700">' + esc(C.monthLabelShort(p.ym)) + '</text>';
    });
    out += '</svg>';
    return out;
  }

  /* ---------------- 헤더 ---------------- */

  function monthNavHTML(tab) {
    var v = VIEW[tab] || ymNow(), cur = ymNow();
    return '<div class="monthnav">' +
      '<button class="nav" data-act="month-prev" data-mtab="' + tab + '" aria-label="이전 달">‹</button>' +
      '<button class="m" data-act="month-pick" data-mtab="' + tab + '">' + C.monthLabel(v) + '</button>' +
      '<button class="nav" data-act="month-next" data-mtab="' + tab + '" aria-label="다음 달">›</button>' +
      (v === cur ? '' : '<button class="today-chip" data-act="month-today" data-mtab="' + tab + '">이번 달</button>') +
      '</div>';
  }

  function headerHTML() {
    if (TAB === 'txns') {
      return '<div class="hrow"><h1 class="htitle">가계부</h1><div class="hspacer"></div>' +
        '<button class="hbtn" data-act="open-search" aria-label="검색">' + ICON.search + '</button></div>' + monthNavHTML('txns');
    }
    if (TAB === 'stats') {
      return '<div class="hrow"><h1 class="htitle">통계</h1></div>' + monthNavHTML('stats');
    }
    if (TAB === 'assets') {
      return '<div class="hrow"><h1 class="htitle">자산</h1><div class="hspacer"></div>' +
        '<button class="hbtn" data-act="add-account" aria-label="계좌 추가">' + ICON.plus + '</button></div>';
    }
    return '<div class="hrow"><h1 class="htitle">설정</h1></div>';
  }

  /* ---------------- 내역 탭 ---------------- */

  function sampleBanner() {
    return '<div class="samplebanner"><span class="txt">지금은 <b>샘플 데이터</b>로 둘러보는 중이에요. 마음껏 눌러 보세요.</span>' +
      '<button data-act="reset-all">내 기록 시작</button></div>';
  }

  function recBanner(n) {
    return '<div class="recbanner"><div><b>고정비 ' + n + '건</b>이 이 달에 아직 없어요</div>' +
      '<button data-act="apply-recurring">한 번에 넣기</button></div>';
  }

  function budgetBlock(bu) {
    if (!bu.hasBudget) {
      return '<button class="nwline" data-act="open-budget" style="border-top:1px dashed #EBE6F8">이번 달 예산 세우기<span class="chev">›</span></button>';
    }
    var pct = Math.min(999, bu.pct);
    var h = '<div class="budgetbox"><div class="barrow"><span>예산 ' + C.comma(bu.total) + '원</span>' +
      '<b>' + Math.round(bu.pct) + '% 사용</b></div>' +
      '<div class="track"><i class="' + (bu.pct > 100 ? 'over' : '') + '" style="width:' + Math.min(100, pct) + '%"></i></div>';
    var rest = bu.total - bu.spent;
    h += '<div class="barrow" style="margin-top:6px"><span>' + (rest >= 0 ? '남은 예산' : '초과') + '</span>' +
      '<b class="' + (rest >= 0 ? 'up' : 'down') + '" style="margin-left:auto">' + C.comma(Math.abs(rest)) + '원</b>' +
      '<button class="linkbtn" data-act="open-budget" style="margin-left:10px">수정</button></div>';
    return h + '</div>';
  }

  function cellHTML(date, dayNum, other, s, sel) {
    var d = other ? null : s.byDay[date];
    var dow = C.dowOf(date);
    var cls = 'cell' + (other ? ' other' : '') + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : '') +
      (date === C.todayISO() ? ' today' : '') + (date === sel ? ' sel' : '');
    var inner = '<span class="num">' + dayNum + '</span>';
    if (d) {
      if (d.expense) inner += '<span class="ex">' + C.wonShort(d.expense) + '</span>';
      if (d.income) inner += '<span class="in">+' + C.wonShort(d.income) + '</span>';
    }
    return '<button class="' + cls + '" data-act="pick-day" data-id="' + date + '">' + inner + '</button>';
  }

  function calHTML(v, s) {
    var startDow = C.dowOf(v + '-01'), last = C.daysInMonth(v);
    var prevYm = C.addMonths(v, -1), prevLast = C.daysInMonth(prevYm);
    var nextYm = C.addMonths(v, 1);
    var cells = [];
    for (var i = 0; i < startDow; i++) {
      var pd = prevLast - startDow + 1 + i;
      cells.push(cellHTML(prevYm + '-' + C.pad2(pd), pd, true, s, SEL));
    }
    for (var d = 1; d <= last; d++) cells.push(cellHTML(v + '-' + C.pad2(d), d, false, s, SEL));
    var rows = Math.ceil((startDow + last) / 7);
    if (rows < 5) rows = 5;
    var remain = rows * 7 - cells.length;
    for (var j = 1; j <= remain; j++) cells.push(cellHTML(nextYm + '-' + C.pad2(j), j, true, s, SEL));
    var dows = C.dowNames().map(function (n, i) {
      return '<div class="dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' + n + '</div>';
    }).join('');
    return '<div class="calrow">' + dows + '</div><div class="calrow">' + cells.join('') + '</div>';
  }

  function txRowHTML(t) {
    var cat = C.findCat(S, t.categoryId);
    var acc = C.findAccount(S, t.accountId);
    var to = C.findAccount(S, t.toAccountId);
    if (t.type === 'transfer') {
      return '<li data-act="edit-txn" data-id="' + t.id + '">' +
        '<div class="txic" style="background:#EFEBFF;color:#5A3BE0">⇄</div>' +
        '<div class="txmain"><div class="txname">이체 <span class="tag">' + esc(acc ? acc.name : '?') + ' → ' + esc(to ? to.name : '?') + '</span></div>' +
        '<div class="txmemo">' + esc(t.time || '') + (t.memo ? ' · ' + esc(t.memo) : '') + '</div></div>' +
        '<div class="txamt move">' + C.comma(t.amount) + '원</div></li>';
    }
    var income = t.type === 'income';
    var emoji = cat ? cat.emoji : (income ? '➕' : '❓');
    var color = cat ? cat.color : '#9AA3B8';
    return '<li data-act="edit-txn" data-id="' + t.id + '">' +
      '<div class="txic" style="background:' + hexA(color, 0.14) + '">' + esc(emoji) + '</div>' +
      '<div class="txmain"><div class="txname">' + esc(cat ? cat.name : (income ? '수입' : '미분류')) +
      (acc ? ' <span class="tag">' + esc(acc.name) + '</span>' : '') + '</div>' +
      '<div class="txmemo">' + esc(t.time || '') + (t.memo ? ' · ' + esc(t.memo) : '') + '</div></div>' +
      '<div class="txamt' + (income ? ' up' : '') + '">' + (income ? '+' : '-') + C.comma(t.amount) + '원</div></li>';
  }

  function dayHTML(s) {
    var list = S.txns.filter(function (t) { return t.date === SEL; })
      .sort(function (a, b) { return String(b.time || '').localeCompare(String(a.time || '')); });
    var d = s.byDay[SEL] || { income: 0, expense: 0 };
    var h = '<div class="dayhead"><h3>' + C.dateLabelKo(SEL) + '</h3><div class="sum">';
    if (d.expense) h += '<span class="down">-' + C.comma(d.expense) + '</span>';
    if (d.income) h += '<span class="up">+' + C.comma(d.income) + '</span>';
    h += '</div></div>';
    if (!list.length) {
      return h + '<div class="empty"><b>' + (SEL === C.todayISO() ? '오늘' : '이 날') + ' 기록이 없어요</b>' +
        '오른쪽 아래 <b style="display:inline">+</b> 로 쓴 돈을 적어 보세요.</div>';
    }
    return h + '<ul class="txlist">' + list.map(txRowHTML).join('') + '</ul>';
  }

  function txnsHTML() {
    var v = VIEW.txns, s = C.summary(S, v);
    if (!SEL || C.ymOf(SEL) !== v) SEL = (v === ymNow()) ? C.todayISO() : v + '-01';
    var nw = C.netWorth(S, C.todayISO());
    var bu = C.budgetUsage(S, v);
    var pend = C.recurringPending(S, v).length;
    var h = S.settings.sample ? sampleBanner() : '';
    h += '<div class="sumcard">' +
      '<div class="sumgrid">' +
      '<div class="col"><div class="lab">수입</div><div class="val' + (s.income ? ' up' : '') + '">' + (s.income ? '+' + C.comma(s.income) : '0') + '</div></div>' +
      '<div class="col"><div class="lab">지출</div><div class="val' + (s.expense ? ' down' : '') + '">' + (s.expense ? '-' + C.comma(s.expense) : '0') + '</div></div>' +
      '<div class="col"><div class="lab">남은 돈</div><div class="val' + (s.net < 0 ? ' down' : '') + '">' + C.comma(s.net) + '</div></div>' +
      '</div>' +
      '<button class="nwline" data-act="go-assets">순자산 <b>' + C.comma(nw.net) + '원</b><span class="chev">›</span></button>' +
      budgetBlock(bu) +
      '</div>';
    if (pend) h += recBanner(pend);
    h += '<div class="calcard">' + calHTML(v, s) + '</div>';
    h += dayHTML(s);
    return h;
  }

  /* ---------------- 통계 탭 ---------------- */

  function deltaBadge(pct, inverse) {
    if (pct == null) return '<span class="badge flat">신규</span>';
    var v = Math.round(pct);
    if (Math.abs(v) < 1) return '<span class="badge flat">그대로</span>';
    var up = v > 0;
    var cls = inverse ? (up ? 'down' : 'up') : (up ? 'up' : 'down');
    return '<span class="badge ' + cls + '">' + (up ? '▲' : '▼') + Math.abs(v) + '%</span>';
  }

  function statsHTML() {
    var v = VIEW.stats, s = C.summary(S, v), prev = C.summary(S, C.addMonths(v, -1));
    var cats = C.categoryBreakdown(S, v, 'expense');
    var incCats = C.categoryBreakdown(S, v, 'income');
    var accs = C.accountBreakdown(S, v);
    var trend = C.monthlyTrend(S, v, 6);
    var days = (v === ymNow()) ? Math.max(1, +C.todayISO().slice(8, 10)) : C.daysInMonth(v);
    var avg = Math.round(s.expense / days);
    var delta = prev.expense > 0 ? (s.expense - prev.expense) / prev.expense * 100 : null;

    var h = '<div class="stathero"><div class="lab">' + C.monthLabel(v) + ' 지출</div>' +
      '<div class="big">' + C.won(s.expense) + '</div><div class="sub">' +
      deltaBadge(delta, true) + '<span>전월 ' + C.comma(prev.expense) + '원</span><span>일평균 ' + C.comma(avg) + '원</span></div></div>';

    if (s.expense === 0 && s.income === 0) {
      return h + '<div class="empty"><b>이 달 기록이 없어요</b>내역 탭에서 지출을 기록하면 통계가 채워져요.</div>';
    }

    var top = cats.slice(0, 5);
    var items = top.map(function (c) { return { value: c.amount, color: c.color, label: c.name }; });
    var restSum = cats.slice(5).reduce(function (a, c) { return a + c.amount; }, 0);
    if (restSum > 0) items.push({ value: restSum, color: '#D9D3E8', label: '그 외' });

    h += '<div class="card"><h3>카테고리별 지출<span class="r">' + cats.length + '개</span></h3>' +
      '<div class="donutwrap">' + svgDonut(items, 116, 17, '지출', C.wonShort(s.expense)) +
      '<div class="legend">' + items.map(function (it) {
        return '<div class="li"><span class="dot" style="background:' + it.color + '"></span>' + esc(it.label) + '<b>' + C.comma(it.value) + '</b></div>';
      }).join('') + '</div></div>';
    cats.slice(0, 8).forEach(function (c) {
      h += '<div class="catrow"><div class="ic" style="background:' + hexA(c.color, .14) + '">' + esc(c.emoji) + '</div>' +
        '<div class="catmain"><div class="top"><b>' + esc(c.name) + '</b>' + deltaBadge(c.deltaPct, true) +
        '<span>' + C.comma(c.amount) + '원</span></div>' +
        '<div class="track slim"><i style="width:' + Math.min(100, c.pct) + '%;background:' + c.color + '"></i></div></div>' +
        '<div class="pct">' + Math.round(c.pct) + '%</div></div>';
    });
    h += '</div>';

    h += '<div class="card"><h3>최근 6개월 수입·지출<span class="r">단위: 원</span></h3>' +
      '<div class="chartbox">' + svgBars(trend, 344, 142) + '</div>' +
      '<div class="legend" style="flex-direction:row;gap:16px;margin-top:6px">' +
      '<div class="li"><span class="dot" style="background:#B9ECD9"></span>수입</div>' +
      '<div class="li"><span class="dot" style="background:#C9B9FF"></span>지출</div></div>' +
      '<div class="barrow" style="margin-top:12px"><span>이 달 순저축 (수입−지출)</span>' +
      '<b class="' + (s.net >= 0 ? 'up' : 'down') + '">' + (s.net >= 0 ? '+' : '') + C.comma(s.net) + '원</b></div>';
    var best = trend.slice().sort(function (a, b) { return b.net - a.net; })[0];
    if (best) h += '<div class="muted" style="margin-top:4px">가장 많이 남긴 달: ' + C.monthLabel(best.ym) + ' (' + C.comma(best.net) + '원)</div>';
    h += '</div>';

    h += '<div class="card"><h3>결제수단별 지출</h3>';
    if (!accs.length) h += '<div class="emptysmall">지출 기록이 없어요</div>';
    else accs.forEach(function (a) {
      h += '<div class="catrow"><div class="ic" style="background:#F3F0FC">' + a.emoji + '</div>' +
        '<div class="catmain"><div class="top"><b>' + esc(a.name) + '</b><span>' + C.comma(a.amount) + '원</span></div>' +
        '<div class="track slim"><i style="width:' + Math.min(100, a.pct) + '%"></i></div>' +
        '<div style="font-size:10.5px;color:#9C96B0;margin-top:3px">' + a.typeLabel + '</div></div>' +
        '<div class="pct">' + Math.round(a.pct) + '%</div></div>';
    });
    h += '</div>';

    if (s.income > 0) {
      h += '<div class="card"><h3>수입 구성<span class="r">' + C.comma(s.income) + '원</span></h3>';
      incCats.forEach(function (c) {
        h += '<div class="catrow"><div class="ic" style="background:' + hexA(c.color, .14) + '">' + esc(c.emoji) + '</div>' +
          '<div class="catmain"><div class="top"><b>' + esc(c.name) + '</b><span>' + C.comma(c.amount) + '원</span></div>' +
          '<div class="track slim"><i style="width:' + Math.min(100, c.pct) + '%;background:' + c.color + '"></i></div></div>' +
          '<div class="pct">' + Math.round(c.pct) + '%</div></div>';
      });
      h += '</div>';
    }
    return h;
  }

  /* ---------------- 자산 탭 ---------------- */

  var TYPE_COLOR = { checking: '#7C5CFF', savings: '#12A87B', investment: '#3B82F6', cash: '#F2A63B', other: '#9AA3B8', card: '#F0555F', loan: '#8B6C7A' };

  function accRow(a) {
    var bal = C.accountBalance(S, a.id);
    var liab = C.isLiab(a.type);
    var meta = C.typeMeta(a.type);
    var hidden = a.active === false;
    var h = '<div class="accrow" data-act="edit-account" data-id="' + a.id + '" role="button" style="' + (hidden ? 'opacity:.55' : '') + '">' +
      '<div class="ic">' + meta.emoji + '</div>' +
      '<div class="accmain"><b>' + esc(a.name) + (hidden ? ' <span style="font-size:9.5px;font-weight:700;color:#9C96B0;background:#F4F2FA;border-radius:5px;padding:1px 4px">숨김</span>' : '') + '</b>' +
      '<span>' + meta.label + (a.memo ? ' · ' + esc(a.memo) : '') + '</span></div>' +
      '<div class="accamt' + (liab ? ' liab' : '') + '"><b>' + C.comma(Math.abs(bal)) + '원</b></div>' +
      (a.type === 'card' && Math.abs(bal) > 0 ? '<button class="paybtn" data-act="pay-card" data-id="' + a.id + '">납부</button>' : '<span class="chev">›</span>') +
      '</div>';
    return h;
  }

  function assetsHTML() {
    var today = C.todayISO(), curYm = C.ymOf(today);
    var nw = C.netWorth(S, today);
    var prev = C.netWorth(S, C.monthEnd(C.addMonths(curYm, -1)));
    var chg = nw.net - prev.net;
    var accounts = C.sortedAccounts(S, true);
    var assetAcc = accounts.filter(function (a) { return !C.isLiab(a.type); });
    var liabAcc = accounts.filter(function (a) { return C.isLiab(a.type); });

    var items = C.ACCOUNT_TYPES.filter(function (t) { return !t.liab; }).map(function (t) {
      var b = nw.byType[t.key];
      return { value: b ? Math.max(0, b.amount) : 0, color: TYPE_COLOR[t.key], label: t.label };
    }).filter(function (i) { return i.value > 0; });

    var h = '<div class="hero"><div class="lab">순자산 (총 자산 − 부채)</div>' +
      '<div class="big num">' + C.comma(nw.net) + '원</div>' +
      '<div class="chips"><span><i>자산</i><b>' + C.comma(nw.assets) + '</b></span>' +
      '<span><i>부채</i><b>' + C.comma(nw.liabs) + '</b></span></div>' +
      '<div class="chg">' + (chg === 0 ? '지난달과 같아요' : '지난달 대비 ' + (chg > 0 ? '+' : '−') + C.comma(Math.abs(chg)) + '원') + '</div></div>';

    h += '<div class="card"><h3>자산 구성</h3>';
    if (!items.length) h += '<div class="emptysmall">계좌 잔액을 넣으면 자산 비율이 보여요</div>';
    else {
      h += '<div class="donutwrap">' + svgDonut(items, 116, 17, '총 자산', C.wonShort(nw.assets)) +
        '<div class="legend">' + items.map(function (it) {
          var pct = nw.assets > 0 ? it.value / nw.assets * 100 : 0;
          return '<div class="li"><span class="dot" style="background:' + it.color + '"></span>' + esc(it.label) + '<b>' + (pct > 0 && pct < 1 ? '<1%' : Math.round(pct) + '%') + '</b></div>';
        }).join('') + '</div></div>';
    }
    h += '</div>';

    var hiddenA = assetAcc.filter(function (a) { return a.active === false; }).length;
    h += '<div class="sechead"><h3>자산</h3><span class="cnt">' + (assetAcc.length - hiddenA) + '개' + (hiddenA ? ' · 숨김 ' + hiddenA : '') + '</span><button class="linkbtn" data-act="add-account">+ 계좌</button></div>';
    h += assetAcc.length ? assetAcc.map(accRow).join('') : '<div class="empty" style="padding:18px"><b>자산 계좌가 없어요</b>입출금·적금·투자 계좌를 추가해 보세요.</div>';

    var hiddenL = liabAcc.filter(function (a) { return a.active === false; }).length;
    h += '<div class="sechead"><h3>부채</h3><span class="cnt">' + (liabAcc.length - hiddenL) + '개' + (hiddenL ? ' · 숨김 ' + hiddenL : '') + '</span></div>';
    h += liabAcc.length ? liabAcc.map(accRow).join('') : '<div class="empty" style="padding:18px"><b>부채가 없어요</b>카드·대출이 생기면 여기서 관리해요.</div>';

    var firstYm = null;
    S.txns.forEach(function (t) {
      var m = t.date.slice(0, 7);
      if (!firstYm || m < firstYm) firstYm = m;
    });
    var n = firstYm ? Math.min(12, Math.max(1, C.monthDiff(firstYm, curYm) + 1)) : 1;
    var tr = C.netWorthTrend(S, curYm, n, today);
    h += '<div class="card" style="margin-top:16px"><h3>순자산 추이<span class="r">' + (n > 1 ? '최근 ' + n + '개월' : '이번 달') + '</span></h3>';
    if (n >= 2) h += '<div class="chartbox">' + svgArea(tr, 344, 124, '#7C5CFF') + '</div>';
    else h += '<div class="muted" style="margin:4px 0 6px">이번 달부터 기록이 쌓이고 있어요. 다음 달부터 추이가 보여요.</div>';
    h += '<ul class="nwlist">';
    tr.slice(-6).slice().reverse().forEach(function (p) {
      var idx = tr.indexOf(p);
      var before = idx > 0 ? tr[idx - 1] : null;
      var d = before ? p.net - before.net : 0;
      h += '<li><span class="m">' + C.monthLabelShort(p.ym) + '</span><span class="v">' + C.comma(p.net) + '원</span>' +
        '<span class="d ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'muted') + '">' + (d === 0 ? '–' : (d > 0 ? '+' : '−') + C.comma(Math.abs(d))) + '</span></li>';
    });
    h += '</ul><div class="muted" style="margin-top:8px">월말 기준으로 계산해요. 숨긴 계좌는 빠집니다.</div></div>';
    return h;
  }

  /* ---------------- 설정 탭 ---------------- */

  function srow(act, emoji, title, sub, extra, cls) {
    return '<button class="srow' + (cls ? ' ' + cls : '') + '" data-act="' + act + '"' + (extra || '') + '><span class="em">' + emoji + '</span>' +
      '<span>' + esc(title) + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</span><span class="chev">›</span></button>';
  }

  function settingsHTML() {
    var v = ymNow();
    var b = C.budgetOf(S, v);
    var h = '<div class="sgroup">' +
      srow('export-json', '⬇️', 'JSON으로 내보내기', '가계부·자산·예산·카테고리 전체 백업') +
      srow('import-json', '⬆️', 'JSON 불러오기', '백업 파일로 복원하거나 합치기') +
      srow('export-csv', '📄', 'CSV로 내보내기', '엑셀·스프레드시트에서 열어 보기') +
      srow('import-csv', '📥', 'CSV 가져오기', '위플 머니 파일은 자동으로 맞춰져요') +
      '</div>';
    h += '<div class="sechead"><h3>관리</h3></div><div class="sgroup">' +
      srow('open-budget', '🎯', '예산', C.monthLabel(v) + (b.total ? ' · ' + C.comma(b.total) + '원' : ' · 아직 없음'), ' data-ym="' + v + '"') +
      srow('open-cats', '🏷', '카테고리', S.categories.length + '개') +
      srow('open-recurring', '🔁', '고정비', S.recurring.length ? S.recurring.length + '개' : '월세·구독처럼 매달 나가는 돈') +
      srow('edit-account-list', '🏦', '계좌 관리', S.accounts.length + '개') +
      '</div>';
    h += '<div class="sechead"><h3>체험</h3></div><div class="sgroup">' +
      srow('load-sample', '🧪', '샘플 데이터로 보기', '가상의 예시 기록으로 기능을 둘러보기') +
      srow('reset-all', '🧹', '모든 기록 지우기', '빈 가계부로 처음부터 시작', '', 'danger') +
      '</div>';
    h += '<div class="infotext"><b>기록은 이 브라우저에만 저장돼요.</b><br>' +
      '서버로 보내지 않고, 공개 저장소에도 올라가지 않아요. 브라우저 데이터를 지우면 함께 사라지니 가끔 JSON으로 백업해 주세요.<br><br>' +
      '아이폰에서는 사파리 공유 버튼 → <b>홈 화면에 추가</b>로 앱처럼 쓸 수 있어요.<br>' +
      '지금 기록: ' + S.txns.length + '건 · 계좌 ' + S.accounts.length + '개 · 카테고리 ' + S.categories.length + '개</div>';
    h += '<div class="infotext" style="margin-top:14px;color:#B7B1C8">나의 가계부 · v1.0</div>';
    return h;
  }

  /* ---------------- 시트 ---------------- */

  function openSheet(html) {
    var root = q('sheetRoot');
    if (!root) return;
    root.innerHTML = '<div class="sheet-bg" data-act="close-sheet"></div><div class="sheet-card"><div class="sheet-grab"></div>' + html + '</div>';
    root.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeSheet() {
    var root = q('sheetRoot');
    if (!root) return;
    root.hidden = true;
    root.innerHTML = '';
    document.body.style.overflow = '';
    entry = null; csvImp = null; catForm = null; recForm = null; searchSt = null; monthPick = null; jsonPending = null;
  }

  function confirmDialog(opt) {
    var wrap = document.createElement('div');
    wrap.className = 'cfwrap';
    wrap.innerHTML = '<div class="cfbox"><h3>' + esc(opt.title) + '</h3>' +
      (opt.msg ? '<p>' + esc(opt.msg) + '</p>' : '') +
      '<div class="cfbtns"><button class="btn soft" data-cf="no">' + esc(opt.cancel || '취소') + '</button>' +
      '<button class="btn ' + (opt.danger ? 'danger' : 'primary') + '" data-cf="yes">' + esc(opt.ok || '확인') + '</button></div></div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-cf]') : null;
      if (!b) { if (e.target === wrap) wrap.remove(); return; }
      var yes = b.getAttribute('data-cf') === 'yes';
      wrap.remove();
      if (yes && opt.onOk) opt.onOk();
    });
  }

  /* ---------------- 기록 입력/수정 ---------------- */

  function defaultAccId() {
    var list = C.sortedAccounts(S, false);
    return list.length ? list[0].id : '';
  }

  function openEntry(txn) {
    if (txn) entry = clone(txn);
    else {
      var ex = S.categories.filter(function (c) { return c.type === 'expense'; })[0];
      var accs = C.sortedAccounts(S, false);
      entry = {
        id: '', type: 'expense', amount: 0, categoryId: ex ? ex.id : '',
        accountId: accs[0] ? accs[0].id : '', toAccountId: accs[1] ? accs[1].id : '',
        date: SEL || C.todayISO(), time: C.nowTime(), memo: ''
      };
    }
    paintEntry();
  }

  function accOptions(sel) {
    var list = C.sortedAccounts(S, false);
    if (!list.length) return '<option value="">계좌를 먼저 만들어 주세요</option>';
    return list.map(function (a) {
      return '<option value="' + a.id + '"' + (a.id === sel ? ' selected' : '') + '>' + esc(a.name) + '</option>';
    }).join('');
  }

  function entryHTML() {
    var isEdit = !!entry.id;
    var transfer = entry.type === 'transfer';
    var income = entry.type === 'income';
    var cats = S.categories.filter(function (c) { return c.type === (income ? 'income' : 'expense'); });
    var h = '<div class="sheet-head"><h2>' + (isEdit ? '기록 수정' : '기록 추가') + '</h2>' +
      '<button class="x" data-act="close-sheet" aria-label="닫기">✕</button></div><div class="sheet-body">' +
      '<div class="seg" id="enSeg">' +
      '<button data-et="expense" class="' + (!income && !transfer ? 'on' : '') + '">지출</button>' +
      '<button data-et="income" class="' + (income ? 'on' : '') + '">수입</button>' +
      '<button data-et="transfer" class="' + (transfer ? 'on' : '') + '">이체</button></div>' +
      '<div class="amtbox"><input id="enAmount" inputmode="numeric" autocomplete="off" placeholder="0" value="' + (entry.amount ? C.comma(entry.amount) : '') + '"><span class="cur">원</span></div>' +
      '<div class="quickamts"><button data-qa="1000">+1,000</button><button data-qa="5000">+5,000</button>' +
      '<button data-qa="10000">+10,000</button><button data-qa="50000">+50,000</button><button data-qa="0">지우기</button></div>';
    if (!transfer) {
      h += '<div class="field"><label>카테고리</label><div class="catgrid" id="enCats">' +
        cats.map(function (c) {
          return '<button data-cat="' + c.id + '" class="' + (entry.categoryId === c.id ? 'on' : '') + '">' +
            '<span class="em">' + esc(c.emoji) + '</span>' + esc(c.name) + '</button>';
        }).join('') + '</div>' +
        '<div style="display:flex;gap:6px;margin-top:7px">' +
        '<input id="enNewCat" type="text" maxlength="12" placeholder="새 카테고리 (예: 반려동물)" style="flex:1;padding:9px 10px;font-size:12.5px">' +
        '<button class="btn soft small" data-act="add-cat-inline">추가</button></div></div>';
    }
    h += '<div class="field"><label>' + (transfer ? '보내는 계좌' : (income ? '받는 계좌' : '결제수단')) + '</label>' +
      '<select id="enAcc">' + accOptions(entry.accountId) + '</select></div>';
    if (transfer) {
      h += '<div class="field"><label>받는 계좌</label><select id="enTo">' + accOptions(entry.toAccountId) + '</select></div>';
    }
    h += '<div class="field"><label>메모</label><input type="text" id="enMemo" maxlength="60" autocomplete="off" placeholder="예: 점심 김치찌개" value="' + esc(entry.memo || '') + '"></div>' +
      '<div class="two"><div class="field"><label>날짜</label><input type="date" id="enDate" value="' + esc(entry.date) + '"></div>' +
      '<div class="field"><label>시간</label><input type="time" id="enTime" value="' + esc(entry.time || '') + '"></div></div>' +
      '</div><div class="sheet-foot">' + (isEdit ? '<button class="btn danger" data-act="del-txn">삭제</button>' : '') +
      '<button class="btn primary" id="enSave">' + (isEdit ? '수정 저장' : '저장') + '</button></div>';
    return h;
  }

  function paintEntry() {
    openSheet(entryHTML());
    var a = q('enAmount');
    if (a) {
      a.addEventListener('input', function () {
        var digits = this.value.replace(/[^\d]/g, '').slice(0, 11);
        entry.amount = digits ? parseInt(digits, 10) : 0;
        this.value = digits ? C.comma(entry.amount) : '';
        updSave();
      });
      a.addEventListener('focus', function () { if (entry.amount === 0) this.value = ''; });
      a.addEventListener('blur', function () { this.value = entry.amount ? C.comma(entry.amount) : ''; });
    }
    var sv = q('enSave');
    if (sv) sv.onclick = commitEntry;
    updSave();
  }

  function updSave() {
    var b = q('enSave');
    if (b) b.disabled = !(entry && entry.amount > 0);
  }

  function syncEntryFromDOM() {
    if (!entry) return;
    var a = q('enAmount');
    if (a) entry.amount = parseInt(String(a.value).replace(/[^\d]/g, ''), 10) || 0;
    var m = q('enMemo'); if (m) entry.memo = m.value;
    var d = q('enDate'); if (d && d.value) entry.date = d.value;
    var t = q('enTime'); if (t && t.value) entry.time = t.value;
    var ac = q('enAcc'); if (ac) entry.accountId = ac.value;
    var to = q('enTo'); if (to) entry.toAccountId = to.value;
  }

  function commitEntry() {
    syncEntryFromDOM();
    if (!entry.amount || entry.amount <= 0) { toast('금액을 입력해 주세요'); return; }
    if (!entry.accountId) { toast('계좌를 골라 주세요'); return; }
    if (entry.type === 'transfer' && (!entry.toAccountId || entry.toAccountId === entry.accountId)) {
      toast('받는 계좌를 다르게 골라 주세요'); return;
    }
    if (!C.validDate(entry.date)) { toast('날짜를 확인해 주세요'); return; }
    var data = {
      type: entry.type,
      amount: Math.round(entry.amount),
      date: entry.date,
      time: entry.time || '12:00',
      categoryId: entry.type === 'transfer' ? '' : (entry.categoryId || ''),
      accountId: entry.accountId,
      toAccountId: entry.type === 'transfer' ? entry.toAccountId : '',
      memo: (entry.memo || '').trim()
    };
    if (entry.id) {
      var t = null;
      for (var i = 0; i < S.txns.length; i++) if (S.txns[i].id === entry.id) t = S.txns[i];
      if (t) { for (var k in data) t[k] = data[k]; }
      toast('수정했어요');
    } else {
      data.id = C.uid('t');
      data.createdAt = new Date().toISOString();
      S.txns.push(data);
      toast('기록했어요');
    }
    save();
    closeSheet();
    render();
  }

  /* ---------------- 계좌 관리 ---------------- */

  function openAccount(acc) {
    var isEdit = !!acc;
    var a = isEdit ? clone(acc) : { id: '', name: '', type: 'checking', opening: 0, memo: '' };
    var bal = isEdit ? Math.round(C.accountBalance(S, acc.id)) : 0;
    var liab = C.isLiab(a.type);
    var cnt = isEdit ? S.txns.filter(function (t) { return t.accountId === acc.id || t.toAccountId === acc.id; }).length : 0;
    var h = '<div class="sheet-head"><h2>' + (isEdit ? '계좌 수정' : '계좌 추가') + '</h2>' +
      '<button class="x" data-act="close-sheet">✕</button></div><div class="sheet-body">' +
      '<div class="field"><label>이름</label><input id="acName" type="text" maxlength="20" value="' + esc(a.name) + '" placeholder="예: 국민은행 입출금"></div>' +
      '<div class="field"><label>종류</label><select id="acType">' + C.ACCOUNT_TYPES.map(function (t) {
        return '<option value="' + t.key + '"' + (a.type === t.key ? ' selected' : '') + '>' + t.emoji + ' ' + t.label + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label id="acBalLab">' + (liab ? '갚아야 할 금액' : '현재 잔액') + '</label>' +
      '<input id="acBal" type="text" inputmode="numeric" value="' + C.comma(Math.abs(bal)) + '"></div>' +
      (isEdit ? '<div class="note">거래 ' + cnt + '건이 반영된 잔액이에요. 잔액을 고치면 과거 기록은 그대로 두고 시작 잔액만 맞춰져요.</div>' : '') +
      '<div class="field"><label>메모 (선택)</label><input id="acMemo" type="text" maxlength="30" value="' + esc(a.memo || '') + '" placeholder="예: 월급 통장"></div>' +
      (isEdit ? '<div class="field"><label>정리</label><div style="display:flex;gap:6px;flex-wrap:wrap">' +
        '<button class="btn soft small" data-act="acc-up" data-id="' + acc.id + '">↑ 위로</button>' +
        '<button class="btn soft small" data-act="acc-down" data-id="' + acc.id + '">↓ 아래로</button>' +
        '<button class="btn soft small" data-act="acc-hide" data-id="' + acc.id + '">' + (a.active === false ? '다시 보이기' : '숨기기') + '</button>' +
        '</div></div>' : '') +
      '</div><div class="sheet-foot">' + (isEdit ? '<button class="btn danger" data-act="acc-del" data-id="' + acc.id + '">삭제</button>' : '') +
      '<button class="btn primary" data-act="save-account" data-id="' + (isEdit ? acc.id : '') + '">' + (isEdit ? '저장' : '추가') + '</button></div>';
    openSheet(h);
    var ts = q('acType');
    if (ts) ts.addEventListener('change', function () {
      var lb = q('acBalLab');
      if (lb) lb.textContent = C.isLiab(this.value) ? '갚아야 할 금액' : '현재 잔액';
    });
  }

  function saveAccount(id) {
    var name = (q('acName').value || '').trim();
    if (!name) { toast('이름을 입력해 주세요'); return; }
    var type = q('acType').value;
    var target = C.parseAmount(q('acBal').value);
    if (target == null) target = 0;
    target = Math.abs(target);
    var memo = (q('acMemo').value || '').trim();
    if (id) {
      var acc = C.findAccount(S, id);
      if (!acc) return;
      var oldG = C.isLiab(acc.type), newG = C.isLiab(type);
      var used = S.txns.some(function (t) { return t.accountId === id || t.toAccountId === id; });
      if (oldG !== newG && used) { toast('거래가 있는 계좌는 자산↔부채를 바꿀 수 없어요'); return; }
      acc.name = name; acc.memo = memo; acc.type = type;
      if (oldG !== newG) acc.opening = target;
      else C.setAccountBalance(S, id, target, type);
      save(); closeSheet(); render(); toast('수정했어요');
    } else {
      var maxOrder = -1;
      S.accounts.forEach(function (a) { if (C.num(a.order) > maxOrder) maxOrder = C.num(a.order); });
      S.accounts.push({ id: C.uid('acc'), name: name, type: type, opening: target, order: maxOrder + 1, active: true, memo: memo });
      save(); closeSheet(); render(); toast('계좌를 추가했어요');
    }
  }

  function moveAccount(id, dir) {
    var acc = C.findAccount(S, id);
    if (!acc) return;
    var group = S.accounts.filter(function (a) { return C.isLiab(a.type) === C.isLiab(acc.type); })
      .sort(function (a, b) { return C.num(a.order) - C.num(b.order); });
    group.forEach(function (a, k) { a.order = k; });
    var i = group.indexOf(acc), j = i + dir;
    if (j < 0 || j >= group.length) return;
    group[i].order = j; group[j].order = i;
    save(); render(); toast('순서를 바꿨어요');
  }

  function openCardPay(acc) {
    var debt = Math.max(0, Math.round(C.accountBalance(S, acc.id)));
    var froms = C.sortedAccounts(S, false).filter(function (a) { return !C.isLiab(a.type); });
    if (!froms.length) { toast('먼저 자산 계좌를 만들어 주세요'); return; }
    var h = '<div class="sheet-head"><h2>카드값 납부</h2><button class="x" data-act="close-sheet">✕</button></div><div class="sheet-body">' +
      '<div class="note">' + esc(acc.name) + '의 미결제 금액 <b>' + C.comma(debt) + '원</b>을 계좌에서 빼서 정리해요. 기록은 <b>이체</b>로 남아요.</div>' +
      '<div class="field"><label>보내는 계좌</label><select id="cpFrom">' + froms.map(function (a) {
        return '<option value="' + a.id + '">' + esc(a.name) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label>납부 금액</label><input id="cpAmt" type="text" inputmode="numeric" value="' + C.comma(debt) + '"></div>' +
      '<div class="field"><label>날짜</label><input type="date" id="cpDate" value="' + C.todayISO() + '"></div>' +
      '</div><div class="sheet-foot"><button class="btn primary" data-act="save-card-pay" data-id="' + acc.id + '">납부 기록</button></div>';
    openSheet(h);
  }

  function saveCardPay(cardId) {
    var from = q('cpFrom').value;
    var amt = C.parseAmount(q('cpAmt').value) || 0;
    var date = q('cpDate').value || C.todayISO();
    if (!from || from === cardId) { toast('다른 계좌를 골라 주세요'); return; }
    if (amt <= 0) { toast('금액을 확인해 주세요'); return; }
    S.txns.push({
      id: C.uid('t'), type: 'transfer', amount: Math.abs(amt), date: date, time: C.nowTime(),
      categoryId: '', accountId: from, toAccountId: cardId, memo: '카드값 납부',
      createdAt: new Date().toISOString()
    });
    save(); closeSheet(); render(); toast('납부를 기록했어요');
  }

  /* ---------------- 예산 ---------------- */

  function openBudget(ym) {
    var b = C.budgetOf(S, ym);
    var cats = S.categories.filter(function (c) { return c.type === 'expense'; });
    var h = '<div class="sheet-head"><h2>' + C.monthLabel(ym) + ' 예산</h2><button class="x" data-act="close-sheet">✕</button></div><div class="sheet-body">' +
      '<div class="note">총 예산과 카테고리별 예산을 정하면 내역·통계에서 진행률을 보여 줘요. 이 달에만 적용돼요.</div>' +
      '<div class="field"><label>총 예산</label><input id="bgTotal" type="text" inputmode="numeric" value="' + (b.total ? C.comma(b.total) : '') + '" placeholder="예: 1,200,000"></div>' +
      '<div class="field"><label>카테고리별 (선택)</label>' + cats.map(function (c) {
        return '<div class="listrow"><div class="ic" style="background:' + hexA(c.color, .14) + '">' + esc(c.emoji) + '</div>' +
          '<div class="main"><b>' + esc(c.name) + '</b></div>' +
          '<input id="bgc_' + c.id + '" type="text" inputmode="numeric" style="width:108px;text-align:right;padding:9px 10px;font-size:14px" value="' + (b.cats[c.id] ? C.comma(b.cats[c.id]) : '') + '" placeholder="0"></div>';
      }).join('') + '</div></div>' +
      '<div class="sheet-foot"><button class="btn primary" data-act="save-budget" data-id="' + ym + '">저장</button></div>';
    openSheet(h);
  }

  function saveBudget(ym) {
    var total = Math.max(0, C.parseAmount(q('bgTotal').value) || 0);
    var cats = {};
    S.categories.forEach(function (c) {
      var el = q('bgc_' + c.id);
      if (!el) return;
      var v = C.parseAmount(el.value) || 0;
      if (v > 0) cats[c.id] = v;
    });
    if (!total && !Object.keys(cats).length) delete S.budgets[ym];
    else S.budgets[ym] = { total: total, cats: cats };
    save(); closeSheet(); render(); toast('예산을 저장했어요');
  }

  /* ---------------- 카테고리 관리 ---------------- */

  function openCats() {
    if (!catForm) catForm = { id: '', name: '', type: 'expense', emoji: '🍚' };
    paintCats();
  }

  function syncCatForm() {
    var n = q('cfName');
    if (n && catForm) catForm.name = n.value;
  }

  function paintCats() {
    var use = {};
    S.txns.forEach(function (t) { if (t.categoryId) use[t.categoryId] = (use[t.categoryId] || 0) + 1; });
    var list = S.categories.filter(function (c) { return c.type === catForm.type; });
    var emojis = ['🍚', '☕', '🚌', '🛍', '🧴', '🏠', '💊', '🎬', '🎁', '📚', '📌', '💼', '👛', '💡', '📈', '➕', '💳', '✈️', '🎮', '🐶'];
    var h = '<div class="sheet-head"><h2>카테고리</h2><button class="x" data-act="close-sheet">✕</button></div><div class="sheet-body">' +
      '<div class="note">카테고리를 누르면 아래에서 이름·아이콘을 고칠 수 있어요.</div>' +
      '<div class="chips2"><button data-act="cf-type" data-val="expense" class="' + (catForm.type === 'expense' ? 'on' : '') + '">지출</button>' +
      '<button data-act="cf-type" data-val="income" class="' + (catForm.type === 'income' ? 'on' : '') + '">수입</button></div>' +
      '<div class="sgroup" style="margin:8px 0">' + list.map(function (c) {
        return '<div class="listrow" style="padding:11px 12px;cursor:pointer" data-act="cf-edit" data-id="' + c.id + '">' +
          '<div class="ic" style="background:' + hexA(c.color, .14) + '">' + esc(c.emoji) + '</div>' +
          '<div class="main"><b>' + esc(c.name) + '</b><span>기록 ' + (use[c.id] || 0) + '건</span></div>' +
          '<button class="iconmini" data-act="cf-del" data-id="' + c.id + '">🗑</button></div>';
      }).join('') + '</div>' +
      '<div class="field"><label>' + (catForm.id ? '카테고리 수정' : '새 카테고리') + '</label>' +
      '<input id="cfName" type="text" maxlength="12" value="' + esc(catForm.name) + '" placeholder="예: 반려동물"></div>' +
      '<div class="field"><label>아이콘</label><div class="chips2">' + emojis.map(function (e) {
        return '<button data-act="cf-emoji" data-val="' + e + '" class="' + (catForm.emoji === e ? 'on' : '') + '" style="font-size:16px;padding:5px 9px">' + e + '</button>';
      }).join('') + '</div></div></div>' +
      '<div class="sheet-foot">' + (catForm.id ? '<button class="btn soft" data-act="cf-cancel">취소</button>' : '') +
      '<button class="btn primary" data-act="cf-save">' + (catForm.id ? '수정 저장' : '추가') + '</button></div>';
    openSheet(h);
  }

  function saveCat() {
    syncCatForm();
    var name = (catForm.name || '').trim();
    if (!name) { toast('이름을 입력해 주세요'); return; }
    if (catForm.id) {
      var c = C.findCat(S, catForm.id);
      if (c) { c.name = name; c.emoji = catForm.emoji; }
      toast('카테고리를 고쳤어요');
    } else {
      S.categories.push(C.makeCat(name, catForm.type, catForm.emoji, name.length + S.categories.length));
      toast('카테고리를 추가했어요');
    }
    catForm = { id: '', name: '', type: catForm.type, emoji: catForm.type === 'income' ? '💼' : '🏷' };
    save(); paintCats(); render();
  }

  function delCat(id) {
    var used = S.txns.filter(function (t) { return t.categoryId === id; }).length;
    var c = C.findCat(S, id);
    if (!c) return;
    if (used) { toast('기록 ' + used + '건에 쓰고 있어 지울 수 없어요'); return; }
    confirmDialog({
      title: '카테고리를 지울까요?', msg: c.name, ok: '삭제', danger: true,
      onOk: function () {
        S.categories = S.categories.filter(function (x) { return x.id !== id; });
        catForm = { id: '', name: '', type: catForm.type, emoji: catForm.type === 'income' ? '💼' : '🏷' };
        save(); paintCats(); render(); toast('지웠어요');
      }
    });
  }

  /* ---------------- 고정비 ---------------- */

  function openRecurring() {
    if (!recForm) recForm = { id: '', name: '', amount: 0, day: 1, type: 'expense', categoryId: '', accountId: '' };
    paintRecurring();
  }

  function syncRecForm() {
    if (!recForm) return;
    var n = q('rcName'); if (n) recForm.name = n.value;
    var a = q('rcAmount'); if (a) recForm.amount = C.parseAmount(a.value) || 0;
    var d = q('rcDay'); if (d) recForm.day = Math.min(31, Math.max(1, parseInt(d.value, 10) || 1));
    var c = q('rcCat'); if (c) recForm.categoryId = c.value;
    var ac = q('rcAcc'); if (ac) recForm.accountId = ac.value;
  }

  function paintRecurring() {
    var cats = S.categories.filter(function (c) { return c.type === (recForm.type === 'income' ? 'income' : 'expense'); });
    var h = '<div class="sheet-head"><h2>고정비</h2><button class="x" data-act="close-sheet">✕</button></div><div class="sheet-body">' +
      '<div class="note">월세·구독·월급처럼 매달 같은 돈은 여기 등록해 두고, 내역 탭에서 <b>한 번에 넣기</b>로 그 달 기록을 만들어요.</div>' +
      '<div class="chips2"><button data-act="rc-type" data-val="expense" class="' + (recForm.type !== 'income' ? 'on' : '') + '">지출</button>' +
      '<button data-act="rc-type" data-val="income" class="' + (recForm.type === 'income' ? 'on' : '') + '">수입</button></div>' +
      (S.recurring.length ? '<div class="sgroup" style="margin:8px 0">' + S.recurring.map(function (r) {
        var cat = C.findCat(S, r.categoryId);
        return '<div class="listrow" style="padding:10px 12px">' +
          '<div class="ic" style="background:#F3F0FC">' + (cat ? cat.emoji : (r.type === 'income' ? '💼' : '🔁')) + '</div>' +
          '<div class="main" data-act="rc-edit" data-id="' + r.id + '" style="cursor:pointer"><b>' + esc(r.name) + '</b>' +
          '<span>매월 ' + r.day + '일 · ' + C.comma(r.amount) + '원</span></div>' +
          '<button class="swi ' + (r.active !== false ? 'on' : '') + '" data-act="rc-toggle" data-id="' + r.id + '" aria-label="켜기/끄기"></button>' +
          '<button class="iconmini" data-act="rc-del" data-id="' + r.id + '">🗑</button></div>';
      }).join('') + '</div>' : '<div class="emptysmall">아직 등록한 고정비가 없어요</div>') +
      '<div class="field"><label>' + (recForm.id ? '고정비 수정' : '고정비 추가') + '</label>' +
      '<input id="rcName" type="text" maxlength="20" value="' + esc(recForm.name) + '" placeholder="예: 월세"></div>' +
      '<div class="two"><div class="field"><label>금액</label><input id="rcAmount" type="text" inputmode="numeric" value="' + (recForm.amount ? C.comma(recForm.amount) : '') + '" placeholder="0"></div>' +
      '<div class="field"><label>매월 며칠</label><input id="rcDay" type="text" inputmode="numeric" value="' + (recForm.day || 1) + '"></div></div>' +
      '<div class="field"><label>카테고리</label><select id="rcCat"><option value="">없음</option>' + cats.map(function (c) {
        return '<option value="' + c.id + '"' + (recForm.categoryId === c.id ? ' selected' : '') + '>' + esc(c.emoji + ' ' + c.name) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label>계좌</label><select id="rcAcc"><option value="">없음</option>' + C.sortedAccounts(S, false).map(function (a) {
        return '<option value="' + a.id + '"' + (recForm.accountId === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>';
      }).join('') + '</select></div></div>' +
      '<div class="sheet-foot">' + (recForm.id ? '<button class="btn soft" data-act="rc-cancel">취소</button>' : '') +
      '<button class="btn primary" data-act="rc-save">' + (recForm.id ? '수정 저장' : '추가') + '</button></div>';
    openSheet(h);
  }

  function saveRec() {
    syncRecForm();
    var name = (recForm.name || '').trim();
    if (!name || !recForm.amount) { toast('이름과 금액을 입력해 주세요'); return; }
    var data = { name: name, type: recForm.type, amount: recForm.amount, day: recForm.day, categoryId: recForm.categoryId, accountId: recForm.accountId, active: true };
    if (recForm.id) {
      for (var i = 0; i < S.recurring.length; i++) {
        if (S.recurring[i].id === recForm.id) {
          var old = S.recurring[i];
          data.id = old.id; data.active = old.active !== false;
          S.recurring[i] = data;
        }
      }
      toast('고정비를 고쳤어요');
    } else {
      data.id = C.uid('rec');
      S.recurring.push(data);
      toast('고정비를 추가했어요');
    }
    recForm = { id: '', name: '', amount: 0, day: 1, type: recForm.type, categoryId: '', accountId: '' };
    save(); paintRecurring(); render();
  }

  /* ---------------- 검색 ---------------- */

  function openSearch() {
    searchSt = { q: '', type: 'all', accountId: '' };
    paintSearch();
  }

  function runSearch() {
    var term = (searchSt.q || '').trim().toLowerCase();
    return S.txns.filter(function (t) {
      if (searchSt.type !== 'all' && t.type !== searchSt.type) return false;
      if (searchSt.accountId && t.accountId !== searchSt.accountId && t.toAccountId !== searchSt.accountId) return false;
      if (!term) return true;
      var cat = C.findCat(S, t.categoryId), acc = C.findAccount(S, t.accountId), to = C.findAccount(S, t.toAccountId);
      var hay = [t.memo, cat && cat.name, acc && acc.name, to && to.name, t.date, C.comma(t.amount)].join(' ').toLowerCase();
      return hay.indexOf(term) >= 0;
    }).sort(function (a, b) { return (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')); });
  }

  function paintSearch() {
    var h = '<div class="sheet-head"><h2>검색</h2><span class="sub">모든 달에서 찾아요</span><button class="x" data-act="close-sheet">✕</button></div>' +
      '<div class="sheet-body" style="padding-bottom:0">' +
      '<div class="field" style="margin-top:2px"><input id="sq" type="text" autocomplete="off" placeholder="메모·카테고리·계좌·금액" value="' + esc(searchSt.q) + '"></div>' +
      '<div class="chips2">' + [['all', '전체'], ['expense', '지출'], ['income', '수입'], ['transfer', '이체']].map(function (o) {
        return '<button data-act="sq-type" data-val="' + o[0] + '" class="' + (searchSt.type === o[0] ? 'on' : '') + '">' + o[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="field" style="margin:6px 0 0"><select id="sfAcc"><option value="">모든 계좌</option>' + S.accounts.map(function (a) {
        return '<option value="' + a.id + '"' + (searchSt.accountId === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>';
      }).join('') + '</select></div>' +
      '<div id="sres" style="padding-bottom:18px"></div></div>';
    openSheet(h);
    var inp = q('sq');
    if (inp) {
      inp.addEventListener('input', function () { searchSt.q = this.value; paintSearchResults(); });
      inp.focus();
    }
    var sel = q('sfAcc');
    if (sel) sel.addEventListener('change', function () { searchSt.accountId = this.value; paintSearchResults(); });
    paintSearchResults();
  }

  function paintSearchResults() {
    var box = q('sres');
    if (!box || !searchSt) return;
    var list = runSearch();
    var e = 0, i2 = 0;
    list.forEach(function (t) { if (t.type === 'expense') e += t.amount; else if (t.type === 'income') i2 += t.amount; });
    var h = '<div class="barrow" style="margin:12px 2px 8px"><span>' + list.length + '건' + (list.length > 80 ? ' · 최근 80건 표시' : '') + '</span>' +
      '<b>지출 ' + C.comma(e) + ' · 수입 ' + C.comma(i2) + '</b></div>';
    if (!list.length) { box.innerHTML = h + '<div class="emptysmall">조건에 맞는 기록이 없어요</div>'; return; }
    var groups = [];
    list.slice(0, 80).forEach(function (t) {
      if (!groups.length || groups[groups.length - 1].date !== t.date) groups.push({ date: t.date, items: [] });
      groups[groups.length - 1].items.push(t);
    });
    groups.forEach(function (g) {
      h += '<div style="font-size:11.5px;font-weight:800;color:#9C96B0;margin:12px 3px 6px">' + g.date + ' (' + C.dowNames()[C.dowOf(g.date)] + ')</div>' +
        '<ul class="txlist">' + g.items.map(txRowHTML).join('') + '</ul>';
    });
    box.innerHTML = h;
  }

  /* ---------------- 월 선택 ---------------- */

  function openMonthPick(tab) {
    monthPick = { tab: tab, year: parseInt((VIEW[tab] || ymNow()).slice(0, 4), 10) };
    paintMonthPick();
  }

  function paintMonthPick() {
    var y = monthPick.year, cur = VIEW[monthPick.tab];
    var months = [];
    for (var m = 1; m <= 12; m++) {
      var ym = y + '-' + C.pad2(m);
      months.push('<button class="btn ' + (ym === cur ? 'primary' : 'soft') + ' small" data-act="mp-month" data-id="' + ym + '">' + m + '월</button>');
    }
    openSheet('<div class="sheet-head"><h2>월 선택</h2><button class="x" data-act="close-sheet">✕</button></div><div class="sheet-body">' +
      '<div style="display:flex;align-items:center;gap:10px;margin:4px 0 12px"><button class="hbtn" data-act="mp-year" data-val="-1">‹</button>' +
      '<div style="flex:1;text-align:center;font-weight:800;font-size:16px">' + y + '년</div>' +
      '<button class="hbtn" data-act="mp-year" data-val="1">›</button></div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px">' + months.join('') + '</div>' +
      '<div style="margin-top:14px"><button class="btn soft wide" data-act="month-today" data-mtab="' + monthPick.tab + '">이번 달로</button></div></div>');
  }

  /* ---------------- CSV 가져오기 ---------------- */

  function startCsvImport(text, fileName) {
    var parsed = C.parseCSV(text);
    if (!parsed.rows.length) { toast('CSV에서 행을 찾지 못했어요'); return; }
    var preset = C.presetFor(parsed.rows[0]);
    var map = preset ? preset.map : C.headerGuess(parsed.rows[0]);
    if (map.date == null && map.amount == null && map.expense == null) map.date = 0;
    var mode = 'expense';
    if (map.amount != null && map.expense == null && map.income == null) {
      mode = C.guessAmountMode(parsed.rows, map.amount, true);
    }
    csvImp = { rows: parsed.rows, hasHeader: true, map: map, mode: mode, addMissing: true, file: fileName || '', preset: preset ? preset.name : '' };
    if (/\uFFFD/.test(text)) toast('글자가 깨져 보이면 엑셀에서 CSV UTF-8로 저장해 다시 올려 주세요');
    paintCsv();
  }

  function colOptions(sel) {
    var head = (csvImp && csvImp.rows[0]) || [];
    var h = '<option value="">사용 안 함</option>';
    head.forEach(function (c, i) {
      h += '<option value="' + i + '"' + (sel === i ? ' selected' : '') + '>' + (i + 1) + '. ' + esc(String(c).slice(0, 12)) + '</option>';
    });
    return h;
  }

  function mapField(id, label, sel) {
    return '<div class="field"><label>' + label + '</label><select id="' + id + '">' + colOptions(sel) + '</select></div>';
  }

  function paintCsv() {
    var fname = csvImp.file ? (csvImp.file.length > 22 ? csvImp.file.slice(0, 20) + '…' : csvImp.file) : '';
    var h = '<div class="sheet-head"><h2>CSV 가져오기</h2><span class="sub">' + csvImp.rows.length + '행' + (fname ? ' · ' + esc(fname) : '') + '</span><button class="x" data-act="close-sheet">✕</button></div><div class="sheet-body">' +
      (csvImp.preset ? '<div class="note" style="margin-bottom:8px">📥 <b>' + esc(csvImp.preset) + '</b>에서 내보낸 파일로 보여요. 컬럼은 자동으로 맞춰 뒀으니 아래에서 확인만 해 주세요.</div>' : '') +
      '<div class="note">엑셀에서 내보낸 CSV도 OK. <b>날짜</b>와 <b>금액</b>(또는 지출/수입) 컬럼만 맞추면 나머지는 비워도 돼요.<br>글자가 깨져 보이면 엑셀에서 <b>CSV UTF-8</b>로 저장해 다시 올려 주세요.</div>' +
      '<label style="display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;color:#615B78;margin:8px 0 6px">' +
      '<input type="checkbox" id="cvHead" ' + (csvImp.hasHeader ? 'checked' : '') + ' style="width:auto;padding:0"> 첫 줄은 컬럼 이름(헤더)이에요</label>' +
      '<div class="mapgrid">' + mapField('cvDate', '날짜', csvImp.map.date) + mapField('cvAmount', '금액', csvImp.map.amount) +
      mapField('cvExpense', '지출 금액', csvImp.map.expense) + mapField('cvIncome', '수입 금액', csvImp.map.income) +
      mapField('cvType', '구분(수입/지출)', csvImp.map.type) + mapField('cvCat', '카테고리', csvImp.map.category) +
      mapField('cvAcc', '결제수단/계좌', csvImp.map.account) + mapField('cvTo', '받는 계좌(이체)', csvImp.map.toAccount) +
      mapField('cvMemo', '메모', csvImp.map.memo) + '</div>' +
      '<div class="field"><label>금액이 양수일 때 <span style="font-weight:600;color:#9C96B0">(구분 컬럼이 없을 때만)</span></label><select id="cvMode">' +
      [['sign', '부호대로 (음수=지출)'], ['expense', '모두 지출'], ['income', '모두 수입']].map(function (o) {
        return '<option value="' + o[0] + '"' + (csvImp.mode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></div>' +
      '<label style="display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;color:#615B78;margin:2px 0 4px">' +
      '<input type="checkbox" id="cvAdd" ' + (csvImp.addMissing ? 'checked' : '') + ' style="width:auto;padding:0"> 없는 카테고리·계좌는 새로 만들기</label>' +
      '<div class="preview" id="cvPrev"></div></div>' +
      '<div class="sheet-foot"><button class="btn primary" data-act="cv-go" id="cvGo">가져오기</button></div>';
    openSheet(h);
    ['cvHead', 'cvMode', 'cvAdd', 'cvDate', 'cvAmount', 'cvExpense', 'cvIncome', 'cvType', 'cvCat', 'cvAcc', 'cvTo', 'cvMemo'].forEach(function (id) {
      var el = q(id);
      if (el) el.addEventListener('change', readCsvMap);
    });
    updateCsvPreview();
  }

  function readCsvMap() {
    if (!csvImp) return;
    var m = {};
    /* 화면에 없는 칸(하위 분류·메모2·지불)은 프리셋 값을 그대로 둔다 */
    (['sub', 'memo2', 'pay']).forEach(function (k) { if (csvImp.map && csvImp.map[k] != null) m[k] = csvImp.map[k]; });
    [['date', 'cvDate'], ['amount', 'cvAmount'], ['expense', 'cvExpense'], ['income', 'cvIncome'],
      ['type', 'cvType'], ['category', 'cvCat'], ['account', 'cvAcc'], ['toAccount', 'cvTo'], ['memo', 'cvMemo']].forEach(function (p) {
      var el = q(p[1]);
      if (el && el.value !== '') m[p[0]] = parseInt(el.value, 10);
    });
    csvImp.map = m;
    var hd = q('cvHead'); if (hd) csvImp.hasHeader = hd.checked;
    var md = q('cvMode'); if (md) csvImp.mode = md.value;
    var ad = q('cvAdd'); if (ad) csvImp.addMissing = ad.checked;
    updateCsvPreview();
  }

  function updateCsvPreview() {
    if (!csvImp) return;
    var res = C.csvToTxns(S, csvImp.rows, {
      map: csvImp.map, hasHeader: csvImp.hasHeader, amountMode: csvImp.mode,
      addMissing: csvImp.addMissing, defaultAccountId: defaultAccId()
    });
    csvImp.last = res;
    var p = q('cvPrev');
    if (p) {
      var prev = res.txns.slice(0, 4);
      var h = prev.length ? prev.map(function (t) {
        return '<div class="r"><span class="d">' + t.date + '</span><span>' + (t.type === 'income' ? '수입' : '지출') + '</span>' +
          '<span>' + esc(t.memo || '') + '</span><span class="a">' + C.comma(t.amount) + '</span></div>';
      }).join('') : '<div style="color:#9C96B0">맞는 행이 없어요. 날짜·금액 컬럼을 확인해 주세요.</div>';
      h += '<div style="margin-top:6px;color:#615B78">총 <b>' + res.txns.length + '건</b> 가져올 수 있어요' +
        (res.badDate ? ' · 날짜를 못 읽은 ' + res.badDate + '행 제외' : '') +
        (res.skipped ? ' · 금액이 없는 ' + res.skipped + '행 제외' : '') + '</div>';
      var sumInc = 0, sumExp = 0, sumTr = 0;
      res.txns.forEach(function (t) {
        if (t.type === 'income') sumInc += t.amount;
        else if (t.type === 'expense') sumExp += t.amount;
        else sumTr += t.amount;
      });
      h += '<div style="margin-top:4px;color:#9C96B0">수입 ' + C.comma(sumInc) + '원 · 지출 ' + C.comma(sumExp) +
        '원' + (sumTr ? ' · 이체 ' + C.comma(sumTr) + '원' : '') + '</div>';
      p.innerHTML = h;
    }
    var g = q('cvGo');
    if (g) g.textContent = res.txns.length + '건 가져오기';
  }

  function doCsvImport() {
    if (!csvImp || !csvImp.last) return;
    var res = csvImp.last;
    if (!res.txns.length) { toast('가져올 기록이 없어요'); return; }
    res.newAccounts.forEach(function (a) { if (!C.findAccount(S, a.id)) S.accounts.push(a); });
    res.newCats.forEach(function (c) { if (!C.findCat(S, c.id)) S.categories.push(c); });
    var m = C.mergeTxns(S, res.txns);
    S.settings.sample = false;
    save(); closeSheet(); render();
    toast(m.added + '건을 가져왔어요' + (m.skipped ? ' · ' + m.skipped + '건은 중복' : ''));
  }

  /* ---------------- JSON 가져오기 ---------------- */

  function openJsonSheet(st) {
    openSheet('<div class="sheet-head"><h2>백업 불러오기</h2><button class="x" data-act="close-sheet">✕</button></div><div class="sheet-body">' +
      '<div class="note">기록 <b>' + st.txns.length + '건</b>, 계좌 <b>' + st.accounts.length + '개</b>, 카테고리 <b>' + st.categories.length + '개</b>, 예산 <b>' + Object.keys(st.budgets).length + '달</b>을 읽었어요.</div>' +
      '<div class="sgroup" style="margin-top:10px">' +
      '<div class="srow" style="cursor:default"><span class="em">🗂</span><span>덮어쓰기<span class="sub">지금 기록을 모두 지우고 백업 파일로 바꿔요</span></span></div>' +
      '<div class="srow" style="cursor:default"><span class="em">➕</span><span>합치기<span class="sub">지금 기록은 두고 백업의 기록을 더해요 (같은 기록은 한 번만)</span></span></div>' +
      '</div></div><div class="sheet-foot">' +
      '<button class="btn soft" data-act="json-merge">합치기</button>' +
      '<button class="btn primary" data-act="json-replace">덮어쓰기</button></div>');
  }

  function mergeStateInto(inc) {
    inc.categories.forEach(function (c) { if (!C.findCat(S, c.id)) S.categories.push(c); });
    inc.accounts.forEach(function (a) { if (!C.findAccount(S, a.id)) S.accounts.push(a); });
    inc.recurring.forEach(function (r) {
      var has = S.recurring.some(function (x) { return x.id === r.id; });
      if (!has) S.recurring.push(r);
    });
    Object.keys(inc.budgets).forEach(function (ym) { S.budgets[ym] = inc.budgets[ym]; });
    return C.mergeTxns(S, inc.txns);
  }

  function applyJson(mode) {
    var st = jsonPending;
    if (!st) return;
    if (mode === 'replace') {
      S = st;
      S.settings.onboarded = true;
      S.settings.sample = false;
      save(); closeSheet();
      VIEW.txns = VIEW.stats = ymNow(); SEL = null;
      render(); toast('백업으로 복원했어요');
    } else {
      var m = mergeStateInto(st);
      S.settings.sample = false;
      save(); closeSheet(); render();
      toast(m.added + '건을 더했어요' + (m.skipped ? ' · ' + m.skipped + '건은 이미 있어요' : ''));
    }
  }

  function download(name, text, mime) {
    try {
      var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 800);
    } catch (e) { toast('파일을 만들지 못했어요'); }
  }

  /* ---------------- 첫 화면 ---------------- */

  function showOnboard() {
    var el = q('onboard');
    if (!el) return;
    el.innerHTML = '<div class="obcard"><div class="oblogo"><img src="icon-192.png?v=1" alt=""></div>' +
      '<h1>나의 가계부</h1><p>쓴 돈은 간단하게 기록하고,<br>계좌·카드·대출까지 <b>순자산</b>으로 한눈에.</p>' +
      '<div class="obbtns"><button class="ob1" id="obSample">샘플 데이터로 둘러보기</button>' +
      '<button class="ob2" id="obEmpty">빈 상태로 시작하기</button></div>' +
      '<div class="fine">기록은 이 기기 브라우저에만 저장되고<br>어디에도 올라가지 않아요.</div></div>';
    el.hidden = false;
    q('obSample').onclick = function () {
      S = C.sampleState();
      save(); el.hidden = true;
      VIEW.txns = VIEW.stats = ymNow(); SEL = null;
      render(); toast('샘플로 먼저 둘러보세요');
    };
    q('obEmpty').onclick = function () {
      S = C.freshState();
      S.settings.onboarded = true;
      save(); el.hidden = true;
      VIEW.txns = VIEW.stats = ymNow(); SEL = null;
      render(); toast('자산 탭에서 계좌부터 만들어 보세요');
    };
  }

  /* ---------------- 이벤트 ---------------- */

  function onFileJSON(e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      var st = C.importJSON(String(fr.result));
      if (!st) { toast('백업 파일을 읽지 못했어요'); return; }
      jsonPending = st;
      openJsonSheet(st);
    };
    fr.readAsText(f, 'UTF-8');
  }

  /* 파일 바이트 → 글자. 엑셀·위플·뱅크샐러드 내보내기에는 UTF-8(BOM 있음/없음), EUC-KR(CP949),
     UTF-16LE/BE가 섞여 있어서 BOM과 바이트 모양을 보고 고른다 (아이폰 사파리에서도 깨지지 않게). */
  function decodeCsvBytes(buf) {
    var b = new Uint8Array(buf);
    try {
      if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
        return new TextDecoder('utf-8').decode(buf);
      }
      if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf);
      if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf);
      /* BOM 없는 UTF-16: 첫 수백 바이트에 0 바이트가 번갈아 나온다 */
      var n = Math.min(b.length, 400), zeros = 0;
      for (var i = 0; i < n; i++) if (b[i] === 0) zeros++;
      if (n > 8 && zeros > n * 0.25) {
        var evenZero = 0, oddZero = 0;
        for (var j = 0; j < n; j++) { if (b[j] === 0) { if (j % 2) oddZero++; else evenZero++; } }
        return new TextDecoder(evenZero >= oddZero ? 'utf-16be' : 'utf-16le').decode(buf);
      }
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (err) {
      try { return new TextDecoder('euc-kr').decode(buf); }
      catch (err2) { return new TextDecoder('utf-8').decode(buf); }
    }
  }

  function onFileCSV(e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      startCsvImport(decodeCsvBytes(fr.result), f.name);
    };
    fr.readAsArrayBuffer(f);
  }

  function onDocClick(e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (el) {
      var act = el.getAttribute('data-act');
      var id = el.getAttribute('data-id');
      var val = el.getAttribute('data-val');
      switch (act) {
        case 'close-sheet': closeSheet(); return;
        case 'pick-day':
          if (C.ymOf(id) !== VIEW.txns) VIEW.txns = C.ymOf(id);
          SEL = id; render(); return;
        case 'open-search': openSearch(); return;
        case 'go-assets': TAB = 'assets'; render(); window.scrollTo(0, 0); return;
        case 'edit-account-list': TAB = 'assets'; render(); window.scrollTo(0, 0); return;
        case 'month-prev': case 'month-next': case 'month-today': {
          var mt = el.getAttribute('data-mtab') || TAB;
          if (act === 'month-today') VIEW[mt] = ymNow();
          else VIEW[mt] = C.addMonths(VIEW[mt] || ymNow(), act === 'month-prev' ? -1 : 1);
          if (mt === 'txns') SEL = null;
          closeSheet(); render(); return;
        }
        case 'month-pick': openMonthPick(el.getAttribute('data-mtab') || TAB); return;
        case 'mp-year': monthPick.year += parseInt(val, 10); paintMonthPick(); return;
        case 'mp-month': VIEW[monthPick.tab] = id; if (monthPick.tab === 'txns') SEL = null; closeSheet(); render(); return;
        case 'add-txn': openEntry(null); return;
        case 'edit-txn': {
          var tx = null;
          for (var i = 0; i < S.txns.length; i++) if (S.txns[i].id === id) tx = S.txns[i];
          if (!tx) return;
          closeSheet(); openEntry(tx); return;
        }
        case 'del-txn':
          confirmDialog({
            title: '기록을 지울까요?', msg: C.dateLabelKo(entry.date) + ' · ' + C.won(entry.amount), ok: '삭제', danger: true,
            onOk: function () {
              var tid = entry.id;
              S.txns = S.txns.filter(function (t) { return t.id !== tid; });
              save(); closeSheet(); render(); toast('지웠어요');
            }
          });
          return;
        case 'add-account': openAccount(null); return;
        case 'edit-account': {
          var acc = C.findAccount(S, id);
          if (acc) openAccount(acc);
          return;
        }
        case 'save-account': saveAccount(id); return;
        case 'acc-up': moveAccount(id, -1); return;
        case 'acc-down': moveAccount(id, 1); return;
        case 'acc-hide': {
          var a2 = C.findAccount(S, id);
          if (!a2) return;
          a2.active = a2.active === false;
          save(); closeSheet(); render();
          toast(a2.active ? '다시 보여요' : '순자산 합계에서 뺐어요');
          return;
        }
        case 'acc-del': {
          var a3 = C.findAccount(S, id);
          if (!a3) return;
          var used = S.txns.filter(function (t) { return t.accountId === id || t.toAccountId === id; }).length;
          if (used) {
            confirmDialog({
              title: '거래가 있는 계좌예요',
              msg: '기록 ' + used + '건이 남아 있어 지울 수 없어요. 숨기면 순자산 합계에서 빠집니다.',
              ok: '숨기기',
              onOk: function () { a3.active = false; save(); closeSheet(); render(); toast('숨겼어요'); }
            });
          } else {
            confirmDialog({
              title: '계좌를 지울까요?', msg: a3.name, ok: '삭제', danger: true,
              onOk: function () {
                S.accounts = S.accounts.filter(function (x) { return x.id !== id; });
                save(); closeSheet(); render(); toast('지웠어요');
              }
            });
          }
          return;
        }
        case 'pay-card': {
          var cd = C.findAccount(S, id);
          if (cd) openCardPay(cd);
          return;
        }
        case 'save-card-pay': saveCardPay(id); return;
        case 'add-cat-inline': {
          syncEntryFromDOM();
          var nm = (q('enNewCat').value || '').trim();
          if (!nm) { toast('이름을 입력해 주세요'); return; }
          var typeC = entry.type === 'income' ? 'income' : 'expense';
          var existed = null;
          S.categories.forEach(function (c) { if (c.type === typeC && c.name === nm) existed = c; });
          var nc = existed || C.makeCat(nm, typeC, typeC === 'income' ? '💼' : '🏷', nm.length + S.categories.length);
          if (!existed) S.categories.push(nc);
          entry.categoryId = nc.id;
          save(); paintEntry(); toast(existed ? '이미 있는 카테고리예요' : '카테고리를 추가했어요');
          return;
        }
        case 'open-budget': openBudget(el.getAttribute('data-ym') || VIEW.txns); return;
        case 'save-budget': saveBudget(id); return;
        case 'open-cats': openCats(); return;
        case 'cf-type': syncCatForm(); catForm.type = val; catForm.id = ''; catForm.name = ''; paintCats(); return;
        case 'cf-emoji': syncCatForm(); catForm.emoji = val; paintCats(); return;
        case 'cf-edit': {
          syncCatForm();
          var c2 = C.findCat(S, id);
          if (!c2) return;
          catForm = { id: c2.id, name: c2.name, type: c2.type, emoji: c2.emoji };
          paintCats(); return;
        }
        case 'cf-save': saveCat(); return;
        case 'cf-cancel': catForm = { id: '', name: '', type: catForm.type, emoji: catForm.type === 'income' ? '💼' : '🏷' }; paintCats(); return;
        case 'cf-del': delCat(id); return;
        case 'open-recurring': openRecurring(); return;
        case 'rc-type': syncRecForm(); recForm.type = val; recForm.id = ''; recForm.categoryId = ''; paintRecurring(); return;
        case 'rc-edit': {
          syncRecForm();
          S.recurring.forEach(function (r) { if (r.id === id) recForm = { id: r.id, name: r.name, amount: r.amount, day: r.day, type: r.type, categoryId: r.categoryId, accountId: r.accountId }; });
          paintRecurring(); return;
        }
        case 'rc-save': saveRec(); return;
        case 'rc-cancel': recForm = { id: '', name: '', amount: 0, day: 1, type: recForm.type, categoryId: '', accountId: '' }; paintRecurring(); return;
        case 'rc-toggle': {
          var r2 = null;
          S.recurring.forEach(function (r) { if (r.id === id) r2 = r; });
          if (!r2) return;
          r2.active = r2.active === false;
          save(); paintRecurring(); render(); return;
        }
        case 'rc-del': {
          var rid = id;
          S.recurring = S.recurring.filter(function (r) { return r.id !== rid; });
          save(); paintRecurring(); render(); toast('지웠어요'); return;
        }
        case 'apply-recurring': {
          var made = C.applyRecurring(S, VIEW.txns);
          if (!made.length) { toast('넣을 고정비가 없어요'); return; }
          save(); render(); toast(made.length + '건을 넣었어요'); return;
        }
        case 'export-json': download('가계부-백업-' + C.todayISO() + '.json', C.exportJSON(S), 'application/json'); toast('JSON 파일을 내려받았어요'); return;
        case 'export-csv': download('가계부-' + C.todayISO() + '.csv', C.toCSV(S), 'text/csv;charset=utf-8'); toast('CSV 파일을 내려받았어요'); return;
        case 'import-json': q('fileJSON').click(); return;
        case 'import-csv': q('fileCSV').click(); return;
        case 'json-replace': applyJson('replace'); return;
        case 'json-merge': applyJson('merge'); return;
        case 'cv-go': doCsvImport(); return;
        case 'load-sample':
          confirmDialog({
            title: '샘플 데이터를 불러올까요?', msg: '지금 기록이 있으면 샘플로 바뀌어요. 필요하면 먼저 JSON으로 백업해 주세요.', ok: '불러오기',
            onOk: function () {
              S = C.sampleState(); save(); VIEW.txns = VIEW.stats = ymNow(); SEL = null;
              render(); toast('샘플 데이터로 바뀌었어요');
            }
          });
          return;
        case 'reset-all':
          confirmDialog({
            title: '모든 기록을 지울까요?', msg: '가계부 기록·계좌·예산이 모두 사라져요. 되돌릴 수 없어요.', ok: '모두 지우기', danger: true,
            onOk: function () {
              S = C.freshState(); S.settings.onboarded = true; save();
              VIEW.txns = VIEW.stats = ymNow(); SEL = null;
              render(); toast('빈 가계부로 시작해요');
            }
          });
          return;
        case 'sq-type': searchSt.type = val; paintSearchResults();
          var chips = document.querySelectorAll('[data-act="sq-type"]');
          for (var ci = 0; ci < chips.length; ci++) chips[ci].classList.toggle('on', chips[ci].getAttribute('data-val') === val);
          return;
      }
    }
    var et = e.target.closest ? e.target.closest('[data-et]') : null;
    if (et && entry) {
      syncEntryFromDOM();
      entry.type = et.getAttribute('data-et');
      if (entry.type !== 'transfer') {
        var want = entry.type === 'income' ? 'income' : 'expense';
        var cur = C.findCat(S, entry.categoryId);
        if (!cur || cur.type !== want) {
          var first = S.categories.filter(function (c) { return c.type === want; })[0];
          entry.categoryId = first ? first.id : '';
        }
      }
      paintEntry();
      return;
    }
    var catB = e.target.closest ? e.target.closest('[data-cat]') : null;
    if (catB && entry) {
      syncEntryFromDOM();
      entry.categoryId = catB.getAttribute('data-cat');
      var nodes = document.querySelectorAll('#enCats [data-cat]');
      for (var n = 0; n < nodes.length; n++) nodes[n].classList.toggle('on', nodes[n] === catB || nodes[n].getAttribute('data-cat') === entry.categoryId);
      return;
    }
    var qa = e.target.closest ? e.target.closest('[data-qa]') : null;
    if (qa && entry) {
      var add = parseInt(qa.getAttribute('data-qa'), 10) || 0;
      entry.amount = add === 0 ? 0 : Math.min(99999999999, entry.amount + add);
      var inp = q('enAmount');
      if (inp) inp.value = entry.amount ? C.comma(entry.amount) : '';
      updSave();
      return;
    }
  }

  function bindGlobal() {
    document.addEventListener('click', onDocClick);
    var fj = q('fileJSON'); if (fj) fj.addEventListener('change', onFileJSON);
    var fc = q('fileCSV'); if (fc) fc.addEventListener('change', onFileCSV);
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () {
        var t = this.getAttribute('data-tab');
        if (!t || t === TAB) return;
        closeSheet();
        TAB = t;
        render();
        window.scrollTo(0, 0);
      });
    }
    window.addEventListener('scroll', function () {
      var h = q('hdr');
      if (h) h.classList.toggle('shadow', window.scrollY > 4);
    }, { passive: true });
  }

  /* ---------------- 렌더 · 시작 ---------------- */

  function render() {
    if (!S) return;
    if (!VIEW.txns) VIEW.txns = ymNow();
    if (!VIEW.stats) VIEW.stats = ymNow();
    var hdr = q('hdr'), main = q('main');
    if (!hdr || !main) return;
    hdr.innerHTML = headerHTML();
    main.innerHTML = TAB === 'txns' ? txnsHTML() : TAB === 'stats' ? statsHTML() : TAB === 'assets' ? assetsHTML() : settingsHTML();
    var fab = q('fab');
    if (fab) fab.hidden = TAB !== 'txns';
    if (document.body && document.body.classList) document.body.classList.toggle('has-fab', TAB === 'txns');
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('on', tabs[i].getAttribute('data-tab') === TAB);
    }
  }

  function boot() {
    load();
    VIEW.txns = VIEW.stats = ymNow();
    bindGlobal();
    render();
    if (!S.settings.onboarded) showOnboard();
    try {
      if ('serviceWorker' in navigator && String(location.protocol).indexOf('http') === 0) {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      }
    } catch (e) {}
  }

  G.MM = {
    boot: boot,
    render: render,
    _set: function (st, tab, view) { S = st; if (tab) TAB = tab; if (view) { VIEW.txns = view; VIEW.stats = view; } },
    _html: { txns: txnsHTML, stats: statsHTML, assets: assetsHTML, settings: settingsHTML },
    _entryHTML: function (t) { entry = t; return entryHTML(); },
    _getEntry: function () { return entry; },
    _state: function () { return S; }
  };

})();
