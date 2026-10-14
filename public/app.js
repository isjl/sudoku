(() => {
  'use strict';
  const E = window.SudokuEngine;
  const $ = (s) => document.querySelector(s);
  const bit = E.bit;
  const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  // Touch-only devices get no keyboard hints.
  const hasKeyboard = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const DRILL_TECHS = E.TECHS.filter((t) => t.drill);
  const DRILL_LEVELS = [1, 2, 3, 4];

  // ---------- persistence (per-viewer convenience only) ----------
  const PREFS_KEY = 'sudoku-drills:v0';
  const GAME_KEY = 'sudoku-drills:game';
  const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
  const prefs = readJSON(PREFS_KEY) || {};
  prefs.stats = prefs.stats || {};
  prefs.gstats = prefs.gstats || {};
  const persist = () => writeJSON(PREFS_KEY, prefs);
  const statsFor = (id) => (prefs.stats[id] = prefs.stats[id] || { solved: 0, clean: 0, streak: 0, bestStreak: 0, bestTime: null });
  const gstatsFor = (id) => (prefs.gstats[id] = prefs.gstats[id] || { played: 0, won: 0, clean: 0, bestTime: null });

  let mode = prefs.mode === 'play' ? 'play' : 'drill';
  let tech = DRILL_TECHS.some((t) => t.id === prefs.tech) ? prefs.tech : 'xwing';
  let viewLevel = DRILL_TECHS.find((t) => t.id === tech).level;
  let diff = E.DIFFICULTIES.some((d) => d.id === prefs.diff) ? prefs.diff : 'medium';
  const techMeta = () => DRILL_TECHS.find((t) => t.id === tech);
  const diffMeta = () => E.DIFFICULTIES.find((d) => d.id === diff);

  // Drill state
  const D = {
    drill: null, status: 'idle', // idle | loading | playing | solved | revealed
    answer: new Set(), found: new Set(),
    mistakes: 0, hints: 0, hintStage: 0, start: 0, elapsed: 0,
    filter: 0, biv: false, msg: null, scanned: 0,
  };
  // Play state
  const P = {
    game: null, status: 'idle', // idle | loading | playing | won
    values: null, elim: null, selected: -1, notes: false,
    mistakes: 0, hints: 0, start: 0, elapsed: 0, undo: [],
    hint: null, filter: 0, biv: false,
  };
  const cur = () => (mode === 'drill' ? D : P);

  // ---------- generation (chunked so the UI stays responsive) ----------
  function genJob(kind, id) {
    const job = { kind, id, scanned: 0, cancelled: false, onProgress: null, result: null, onDone: null };
    const ctx = E.createGenCtx(kind, id);
    const tick = () => {
      if (job.cancelled) return;
      const r = E.genStep(ctx, 16);
      job.scanned = ctx.scanned;
      if (r) { job.result = r; if (job.onDone) job.onDone(r); return; }
      if (job.onProgress) job.onProgress(job.scanned);
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
    job.cancel = () => { job.cancelled = true; };
    return job;
  }

  // =====================================================================
  // Static DOM
  // =====================================================================
  const cellsEl = $('#cells');
  const cellEls = [], valEls = [], candEls = [];
  for (let c = 0; c < 81; c++) {
    const el = document.createElement('div');
    el.className = 'cell';
    el.dataset.c = c;
    const v = document.createElement('div');
    v.className = 'val';
    const g = document.createElement('div');
    g.className = 'cands';
    candEls[c] = [];
    for (let d = 1; d <= 9; d++) {
      const k = document.createElement('div');
      k.className = 'cand';
      k.dataset.d = d;
      g.appendChild(k);
      candEls[c][d] = k;
    }
    el.append(v, g);
    cellsEl.appendChild(el);
    cellEls[c] = el; valEls[c] = v;
  }
  $('#col-labels').innerHTML = [...Array(9)].map((_, i) => `<span>${i + 1}</span>`).join('');
  $('#row-labels').innerHTML = [...Array(9)].map((_, i) => `<span>${i + 1}</span>`).join('');
  {
    const lines = (cls, idx) => idx.map((i) =>
      `<line class="${cls}" x1="${i * 100}" y1="0" x2="${i * 100}" y2="900"/><line class="${cls}" x1="0" y1="${i * 100}" x2="900" y2="${i * 100}"/>`).join('');
    // thick lines drawn last so they sit on top
    $('#grid-lines').innerHTML = lines('thin', [1, 2, 4, 5, 7, 8]) + lines('thick', [3, 6]);
  }

  const digitbar = $('#digitbar');
  function buildDigitbar() {
    digitbar.innerHTML =
      [...Array(9)].map((_, i) => `<button class="dbtn" data-d="${i + 1}">${i + 1}<span class="cnt"></span></button>`).join('') +
      (mode === 'drill' ? `<button class="dbtn biv-btn" data-biv="1" title="Highlight cells with exactly two candidates (B)">bivalue<span class="cnt"></span></button>` : '');
  }

  $('#modes').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setMode(b.dataset.mode);
  });

  function setMode(m) {
    mode = m;
    prefs.mode = m;
    persist();
    document.body.dataset.mode = m;
    $('#modes').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    $('#keys').innerHTML = (m === 'drill'
      ? [['1–9', 'highlight'], ['B', 'bivalue'], ['H', 'hint'], ['N', 'next'], ['Esc', 'clear']]
      : [['1–9', 'place'], ['⇧1–9', 'note'], ['N', 'notes mode'], ['H', 'hint'], ['U', 'undo'], ['←↑↓→', 'move']]
    ).map(([k, l]) => `<span><kbd>${k}</kbd> ${l}</span>`).join('');
    buildDigitbar();
    setHover(-1);
    if (m === 'drill' && D.status === 'idle') requestDrill();
    if (m === 'play' && P.status === 'idle' && !restoreGame()) newGame(true);
    render();
  }

  // =====================================================================
  // Drill mode
  // =====================================================================
  const levelsEl = $('#levels'), techsEl = $('#techs');
  levelsEl.innerHTML = DRILL_LEVELS.map((l) =>
    `<button data-l="${l}">${E.LEVELS[l]}</button>`).join('');
  levelsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    viewLevel = +b.dataset.l;
    renderTechPicker();
  });
  techsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.tech');
    if (!b || b.dataset.id === tech) return;
    if (D.status === 'playing') breakStreak();
    tech = b.dataset.id;
    prefs.tech = tech;
    persist();
    requestDrill();
  });
  function renderTechPicker() {
    levelsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', +b.dataset.l === viewLevel));
    techsEl.innerHTML = DRILL_TECHS.filter((t) => t.level === viewLevel).map((t) =>
      `<button class="tech${t.id === tech ? ' active' : ''}" data-id="${t.id}"><span class="name">${t.name}</span><span class="cat">${t.cat}</span></button>`).join('');
  }

  let drillJob = null, prefetch = null;
  function requestDrill() {
    D.status = 'loading';
    D.msg = null;
    if (drillJob && !drillJob.result) drillJob.cancel();
    let job;
    if (prefetch && prefetch.id === tech) { job = prefetch; prefetch = null; }
    else { if (prefetch) prefetch.cancel(); prefetch = null; job = genJob('drill', tech); }
    drillJob = job;
    const done = (drill) => {
      if (drillJob !== job) return;
      startDrill(drill);
      prefetch = genJob('drill', tech);
    };
    if (job.result) { done(job.result); return; }
    D.scanned = job.scanned;
    job.onProgress = (n) => { D.scanned = n; if (mode === 'drill') renderLoading(); };
    job.onDone = done;
    render();
  }

  function startDrill(drill) {
    Object.assign(D, {
      drill, status: 'playing',
      answer: new Set(drill.answer.map(([c, d]) => c * 10 + d)),
      found: new Set(),
      mistakes: 0, hints: 0, hintStage: 0,
      start: performance.now(), elapsed: 0,
      filter: 0, biv: false, msg: null,
    });
    render();
  }

  function tryEliminate(c, d) {
    if (D.status !== 'playing') return;
    const dr = D.drill;
    if (dr.values[c] || !(dr.cands[c] & bit(d))) return;
    const key = c * 10 + d;
    if (D.found.has(key)) return;
    if (D.answer.has(key)) {
      D.found.add(key);
      const left = D.answer.size - D.found.size;
      if (left === 0) solveDrill();
      else {
        D.msg = { kind: 'good', html: `Yes — ${E.cn(c)} can't be ${E.dg(d)}. ${left} more to find.` };
        render();
      }
      animate(candEls[c][d], 'pop');
    } else {
      D.mistakes++;
      D.msg = { kind: 'bad', html: `${E.dg(d)} in ${E.cn(c)} isn't removed by the ${techMeta().name}. Look again.` };
      render();
      animate(candEls[c][d], 'wrong');
      animate(cellEls[c], 'shake');
    }
  }

  const explainHtml = (list) => list.map((i) => `<p>${i.text}</p>`).join('');

  function solveDrill() {
    D.status = 'solved';
    D.elapsed = performance.now() - D.start;
    const st = statsFor(tech);
    st.solved++;
    const clean = !D.mistakes && !D.hints;
    if (clean) {
      st.clean++;
      st.streak++;
      st.bestStreak = Math.max(st.bestStreak, st.streak);
      if (st.bestTime == null || D.elapsed < st.bestTime) st.bestTime = D.elapsed;
    } else st.streak = 0;
    persist();
    const detail = clean
      ? 'clean solve'
      : [D.mistakes && plural(D.mistakes, 'mistake'), D.hints && plural(D.hints, 'hint')].filter(Boolean).join(', ');
    D.msg = { kind: 'win', html: `<div class="head">✓ Solved in ${fmt(D.elapsed)} · ${detail}</div>${explainHtml(D.drill.instances)}` };
    render();
  }

  function breakStreak() {
    statsFor(tech).streak = 0;
    persist();
  }

  function revealDrill() {
    if (D.status !== 'playing') return;
    D.status = 'revealed';
    D.elapsed = performance.now() - D.start;
    breakStreak();
    D.msg = { kind: 'reveal', html: `<div class="head">Here's the ${techMeta().name}</div>${explainHtml(D.drill.instances)}` };
    render();
  }

  function drillHint() {
    if (D.status !== 'playing') return;
    const ins = D.drill.instances[0];
    if (D.hintStage >= 2) { revealDrill(); return; }
    D.hintStage++;
    D.hints++;
    if (D.hintStage === 1) {
      if (ins.digit) D.filter = ins.digit;
      if (ins.hintBiv) D.biv = true;
      D.msg = { kind: 'info', html: ins.hint1 };
    } else {
      D.msg = { kind: 'info', html: `These highlighted cells form the ${techMeta().name}. Which candidates does it remove?` };
    }
    render();
  }

  function nextDrill() {
    if (D.status === 'loading') return;
    if (D.status === 'playing') breakStreak();
    requestDrill();
  }

  $('#hint').addEventListener('click', drillHint);
  $('#reveal').addEventListener('click', revealDrill);
  $('#next').addEventListener('click', nextDrill);

  // =====================================================================
  // Play mode
  // =====================================================================
  const diffsEl = $('#diffs');
  diffsEl.innerHTML = E.DIFFICULTIES.map((d) => `<button data-id="${d.id}">${d.name}</button>`).join('');
  diffsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || (b.dataset.id === diff && P.status !== 'won')) return;
    const prev = diff;
    diff = b.dataset.id;
    if (!newGame()) diff = prev;
    render();
  });
  $('#new-game').addEventListener('click', () => newGame());

  const inProgress = () => P.status === 'playing' && P.values.some((v, i) => v && !P.game.puzzle[i]);
  let gameJob = null;

  function newGame(silent) {
    if (!silent && inProgress() && !window.confirm('Abandon the current game and start a new one?')) return false;
    if (inProgress()) gstatsFor(P.game.difficulty).played++;
    prefs.diff = diff;
    persist();
    if (gameJob) gameJob.cancel();
    P.status = 'loading';
    P.hint = null;
    const job = (gameJob = genJob('game', diff));
    job.onDone = (g) => { if (gameJob === job) startGame(g); };
    render();
    return true;
  }

  function startGame(g) {
    Object.assign(P, {
      game: g, status: 'playing',
      values: g.puzzle.slice(), elim: new Array(81).fill(0),
      selected: -1, notes: false, mistakes: 0, hints: 0,
      start: performance.now(), elapsed: 0, undo: [], hint: null, filter: 0, biv: false,
    });
    saveGame();
    render();
  }

  function saveGame() {
    if (!P.game) return;
    if (P.status === 'playing') P.elapsed = performance.now() - P.start;
    writeJSON(GAME_KEY, {
      game: P.game, values: P.values, elim: P.elim, mistakes: P.mistakes, hints: P.hints,
      elapsed: P.elapsed, status: P.status,
    });
  }
  function restoreGame() {
    const s = readJSON(GAME_KEY);
    if (!s || s.status !== 'playing' || !s.game || !Array.isArray(s.values)) return false;
    diff = s.game.difficulty;
    Object.assign(P, {
      game: s.game, status: 'playing', values: s.values, elim: s.elim,
      selected: -1, notes: false, mistakes: s.mistakes || 0, hints: s.hints || 0,
      elapsed: s.elapsed || 0, start: performance.now() - (s.elapsed || 0), undo: [], hint: null, filter: 0, biv: false,
    });
    return true;
  }
  window.addEventListener('pagehide', saveGame);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });

  function computedMask(values, c) {
    let m = E.ALL;
    for (const p of E.PEERS[c]) if (values[p]) m &= ~bit(values[p]);
    return m;
  }
  function playCands() {
    const out = new Uint16Array(81);
    for (let c = 0; c < 81; c++) if (!P.values[c]) out[c] = computedMask(P.values, c) & ~P.elim[c];
    return out;
  }
  // Givens and correctly placed digits are locked: with one selected, the digit pad
  // just switches the highlight instead of overwriting a right answer.
  const editable = (c) => c >= 0 && P.status === 'playing' && !P.game.puzzle[c] && P.values[c] !== P.game.solution[c];
  const isWrong = (c) => P.values[c] && !P.game.puzzle[c] && P.values[c] !== P.game.solution[c];

  function snapshot() {
    P.undo.push({ values: P.values.slice(), elim: P.elim.slice() });
    if (P.undo.length > 300) P.undo.shift();
  }
  function changed() {
    P.hint = null;
    saveGame();
    render();
  }

  function placeDigit(c, d) {
    if (!editable(c)) return;
    snapshot();
    if (P.values[c] === d) {
      P.values[c] = 0;
    } else {
      P.values[c] = d;
      P.filter = d;
      if (d !== P.game.solution[c]) { P.mistakes++; animate(cellEls[c], 'shake'); }
    }
    changed();
    checkWin();
  }
  function toggleNote(c, d) {
    if (!editable(c) || P.values[c]) return;
    if (!(computedMask(P.values, c) & bit(d))) { animate(cellEls[c], 'shake'); return; }
    snapshot();
    P.elim[c] ^= bit(d);
    changed();
  }
  function erase(c) {
    if (!editable(c) || !P.values[c]) return;
    snapshot();
    P.values[c] = 0;
    changed();
  }
  function undo() {
    const s = P.undo.pop();
    if (!s || P.status !== 'playing') return;
    P.values = s.values;
    P.elim = s.elim;
    changed();
  }
  function select(c) {
    P.selected = c;
    if (c >= 0 && P.values[c]) P.filter = P.values[c];
    render();
  }

  function checkWin() {
    if (!P.values.every((v, i) => v === P.game.solution[i])) return;
    P.status = 'won';
    P.elapsed = performance.now() - P.start;
    P.selected = -1;
    P.hint = null;
    const st = gstatsFor(P.game.difficulty);
    st.played++;
    st.won++;
    if (!P.hints) {
      st.clean++;
      // best time only counts games solved without hints
      if (st.bestTime == null || P.elapsed < st.bestTime) st.bestTime = P.elapsed;
    }
    persist();
    saveGame();
    render();
  }

  // ---------- play hints ----------
  function computeHint() {
    const g = P.game;
    const wrong = [];
    for (let c = 0; c < 81; c++) if (isWrong(c)) wrong.push(c);
    if (wrong.length) {
      return {
        title: wrong.length === 1 ? 'Fix a mistake' : 'Fix some mistakes', cells: wrong,
        text1: `${wrong.length === 1 ? 'One of your digits is wrong — it\'s highlighted.' : `${wrong.length} of your digits are wrong — they're highlighted.`} Logic can't continue from a wrong grid.`,
        text2: `${wrong.map(E.cn).join(', ')} ${wrong.length === 1 ? 'is' : 'are'} incorrect.`,
        applyLabel: 'Erase', apply: () => { for (const c of wrong) P.values[c] = 0; },
      };
    }
    const cands = playCands();
    const missing = [];
    for (let c = 0; c < 81; c++) if (!P.values[c] && !(cands[c] & bit(g.solution[c]))) missing.push(c);
    if (missing.length) {
      return {
        title: 'Restore a note', cells: missing,
        text1: `A pencil mark you removed is actually needed — the highlighted cell${missing.length > 1 ? 's' : ''}.`,
        text2: missing.map((c) => `${E.cn(c)} needs its ${E.dg(g.solution[c])} back.`).join(' '),
        applyLabel: 'Restore', apply: () => { for (const c of missing) P.elim[c] &= ~bit(g.solution[c]); },
      };
    }
    const ins = E.nextStep({ values: P.values.slice(), cands });
    if (!ins) {
      const c = P.values.findIndex((v) => !v);
      return {
        title: 'Free cell', cells: [c],
        text1: `No step found with the techniques I know. Here's a free cell instead.`,
        text2: `${E.cn(c)} is ${E.dg(g.solution[c])}.`,
        applyLabel: 'Fill it', apply: () => { P.values[c] = g.solution[c]; },
      };
    }
    return {
      ins, title: ins.name, lvl: E.LEVELS[ins.level],
      text1: ins.hint1, text2: ins.text,
      applyLabel: ins.place ? `Place ${ins.place[1]}` : `Remove ${plural(ins.elims.length, 'candidate')}`,
      apply: () => {
        if (ins.place) { P.values[ins.place[0]] = ins.place[1]; P.selected = ins.place[0]; P.filter = ins.place[1]; }
        for (const [c, d] of ins.elims) P.elim[c] |= bit(d);
      },
    };
  }

  function playHint() {
    if (P.status !== 'playing') return;
    if (!P.hint) {
      P.hint = Object.assign(computeHint(), { stage: 1 });
      P.hints++;
      const ins = P.hint.ins;
      // singles: don't give the digit away until "Show me"
      if (ins && ins.digit && ins.level > 0) P.filter = ins.digit;
      if (ins && ins.hintBiv) P.biv = true;
      saveGame();
    } else if (P.hint.stage === 1) {
      showHint();
    } else {
      applyHint();
      return;
    }
    render();
  }
  function showHint() {
    P.hint.stage = 2;
    const ins = P.hint.ins;
    if (ins && ins.place) P.filter = ins.place[1];
    else if (ins && ins.digit) P.filter = ins.digit;
    render();
  }
  function applyHint() {
    if (!P.hint) return;
    snapshot();
    P.hint.apply();
    changed();
    checkWin();
  }

  $('#hintcard').addEventListener('click', (e) => {
    const b = e.target.closest('[data-h]');
    if (!b) return;
    const a = b.dataset.h;
    if (a === 'close') { P.hint = null; render(); }
    else if (a === 'show') showHint();
    else if (a === 'apply') applyHint();
  });

  $('#playbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'undo') undo();
    else if (a === 'erase') erase(P.selected);
    else if (a === 'notes') { P.notes = !P.notes; render(); }
    else if (a === 'biv') { P.biv = !P.biv; render(); }
    else if (a === 'hint') playHint();
  });

  // =====================================================================
  // Shared interaction
  // =====================================================================
  digitbar.addEventListener('click', (e) => {
    const b = e.target.closest('.dbtn');
    if (!b) return;
    if (mode === 'drill') {
      if (b.dataset.biv) D.biv = !D.biv;
      else D.filter = D.filter === +b.dataset.d ? 0 : +b.dataset.d;
      render();
      return;
    }
    const d = +b.dataset.d;
    if (editable(P.selected) && !(P.notes && P.values[P.selected])) {
      if (P.notes) toggleNote(P.selected, d);
      else placeDigit(P.selected, d);
    } else {
      P.filter = P.filter === d ? 0 : d;
      render();
    }
  });

  cellsEl.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const c = +cell.dataset.c;
    if (mode === 'drill') {
      if (!D.drill) return;
      if (e.target.closest('.val')) { D.filter = D.filter === D.drill.values[c] ? 0 : D.drill.values[c]; render(); return; }
      const k = e.target.closest('.cand');
      if (k) tryEliminate(c, +k.dataset.d);
      return;
    }
    if (P.status !== 'playing') return;
    const k = e.target.closest('.cand.on');
    if (P.notes && k && P.selected === c) { toggleNote(c, +k.dataset.d); return; }
    select(c);
  });

  // Play: tapping anywhere outside the board and its controls deselects the cell and
  // clears the digit highlight (bivalue stays), so there's a safe way to "let go".
  document.addEventListener('click', (e) => {
    if (mode !== 'play' || P.status !== 'playing') return;
    if (e.target.closest('#board, #digitbar, #playbar, #hintcard, .ref')) return;
    if (P.selected < 0 && !P.filter) return;
    P.selected = -1;
    P.filter = 0;
    render();
  });

  let hoverCell = -1;
  function setHover(c) {
    if (c === hoverCell) return;
    if (hoverCell >= 0) { cellEls[hoverCell].classList.remove('hover'); E.PEERS[hoverCell].forEach((p) => cellEls[p].classList.remove('peer')); }
    hoverCell = c;
    if (c >= 0) { cellEls[c].classList.add('hover'); E.PEERS[c].forEach((p) => cellEls[p].classList.add('peer')); }
  }
  cellsEl.addEventListener('mouseover', (e) => {
    if (mode !== 'drill') return;
    const cell = e.target.closest('.cell');
    if (cell) setHover(+cell.dataset.c);
  });
  cellsEl.addEventListener('mouseleave', () => setHover(-1));

  // a cell reference (r3c5) in text highlights that cell: hover on desktop, tap on touch
  document.addEventListener('mouseover', (e) => {
    const r = e.target.closest && e.target.closest('.ref[data-c]');
    document.querySelectorAll('.cell.ref').forEach((el) => el.classList.remove('ref'));
    if (r) cellEls[+r.dataset.c].classList.add('ref');
  });
  document.addEventListener('click', (e) => {
    const r = e.target.closest && e.target.closest('.ref[data-c]');
    if (!r) return;
    const el = cellEls[+r.dataset.c];
    el.classList.add('ref');
    setTimeout(() => el.classList.remove('ref'), 1500);
  });

  function animate(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
  }

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) {
      if (mode === 'play' && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { undo(); e.preventDefault(); }
      return;
    }
    const k = e.key.toLowerCase();
    if (mode === 'drill') {
      if (k >= '1' && k <= '9') { D.filter = D.filter === +k ? 0 : +k; render(); }
      else if (k === '0' || k === 'escape') { D.filter = 0; D.biv = false; render(); }
      else if (k === 'b') { D.biv = !D.biv; render(); }
      else if (k === 'h') drillHint();
      else if (k === 'n') nextDrill();
      else if (k === 'enter' && (D.status === 'solved' || D.status === 'revealed')) nextDrill();
      else return;
      e.preventDefault();
      return;
    }
    // play
    const digit = /^Digit[1-9]$/.test(e.code) ? +e.code.slice(5) : /^Numpad[1-9]$/.test(e.code) ? +e.code.slice(6) : 0;
    const moves = { arrowup: -9, arrowdown: 9, arrowleft: -1, arrowright: 1 };
    if (digit) {
      if (!editable(P.selected)) { P.filter = P.filter === digit ? 0 : digit; render(); }
      else if (e.shiftKey || P.notes) toggleNote(P.selected, digit);
      else placeDigit(P.selected, digit);
    } else if (moves[k] !== undefined) {
      let c = P.selected < 0 ? 40 : P.selected;
      const r = E.ROW[c], col = E.COL[c];
      if (k === 'arrowup') c = ((r + 8) % 9) * 9 + col;
      else if (k === 'arrowdown') c = ((r + 1) % 9) * 9 + col;
      else if (k === 'arrowleft') c = r * 9 + ((col + 8) % 9);
      else c = r * 9 + ((col + 1) % 9);
      select(c);
    } else if (k === 'backspace' || k === 'delete' || k === '0') erase(P.selected);
    else if (k === 'n') { P.notes = !P.notes; render(); }
    else if (k === 'b') { P.biv = !P.biv; render(); }
    else if (k === 'h') playHint();
    else if (k === 'u') undo();
    else if (k === 'escape') { P.selected = -1; P.filter = 0; P.biv = false; P.hint = null; render(); }
    else return;
    e.preventDefault();
  });

  setInterval(() => {
    if (mode === 'drill' && D.status === 'playing') $('#timer').textContent = fmt(performance.now() - D.start);
    if (mode === 'play' && P.status === 'playing') $('#p-timer').textContent = fmt(performance.now() - P.start);
  }, 500);

  // =====================================================================
  // Rendering
  // =====================================================================
  function emptyView() {
    return {
      values: null, cands: null, given: null, wrong: null, gone: new Set(), filter: 0, biv: false,
      pattern: new Set(), pivots: new Set(), keyCands: new Map(), targets: new Set(), houses: new Set(),
      selected: -1, lines: [], interactive: false,
    };
  }
  function addOverlay(v, list, { targets }) {
    for (const ins of list) {
      ins.cells.forEach((c) => v.pattern.add(c));
      ins.pivot.forEach((c) => v.pivots.add(c));
      ins.keyCands.forEach(([c, d, col]) => v.keyCands.set(c * 10 + d, col || 0));
      if (targets) ins.elims.forEach(([c, d]) => v.targets.add(c * 10 + d));
      v.lines.push(...ins.lines);
    }
  }

  function drillView() {
    const v = emptyView();
    const dr = D.drill;
    if (!dr) return v;
    Object.assign(v, { values: dr.values, cands: dr.cands, gone: D.found, filter: D.filter, biv: D.biv, interactive: D.status === 'playing' });
    const done = D.status === 'solved' || D.status === 'revealed';
    const shown = done ? dr.instances : D.hintStage >= 2 ? [dr.instances[0]] : [];
    addOverlay(v, shown, { targets: D.status === 'revealed' });
    if (!done) v.lines = [];
    if (D.status === 'playing' && D.hintStage >= 1) dr.instances[0].pivot.forEach((c) => v.pivots.add(c));
    if (D.status === 'revealed') for (const k of D.found) v.targets.delete(k);
    return v;
  }

  function playView() {
    const v = emptyView();
    if (!P.game) return v;
    const g = P.game;
    Object.assign(v, {
      values: P.values, cands: playCands(), filter: P.filter, biv: P.biv,
      given: g.puzzle.map(Boolean), wrong: P.values.map((_, c) => !!isWrong(c)),
      selected: P.status === 'playing' ? P.selected : -1, interactive: P.status === 'playing',
    });
    const h = P.hint;
    if (h) {
      if (h.ins) {
        h.ins.houses.forEach((u) => E.UNITS[u].forEach((c) => v.houses.add(c)));
        if (h.stage >= 2) addOverlay(v, [h.ins], { targets: true });
      } else {
        h.cells.forEach((c) => v.pattern.add(c));
      }
    }
    return v;
  }

  function render() {
    const v = mode === 'drill' ? drillView() : playView();
    renderBoard(v);
    renderLinks(v.lines);
    renderLoading();
    if (mode === 'drill') renderDrillPanel(); else renderPlayPanel();
  }

  function renderLoading() {
    const s = cur();
    const on = s.status === 'loading';
    $('#loading').classList.toggle('show', on);
    if (!on) return;
    $('#loading-text').textContent = mode === 'drill'
      ? `Generating a fresh ${techMeta().name}…` + (D.scanned > 3 ? ` (${D.scanned} puzzles scanned)` : '')
      : `Generating a fresh ${diffMeta().name.toLowerCase()} puzzle…`;
  }

  function renderBoard(v) {
    $('#board').classList.toggle('playing', v.interactive);
    const counts = new Array(10).fill(0), placed = new Array(10).fill(0);
    let bivCount = 0;
    const sel = v.selected;

    for (let c = 0; c < 81; c++) {
      const el = cellEls[c];
      const val = v.values ? v.values[c] : 0;
      el.classList.toggle('solved', !!val);
      el.classList.toggle('user', !!val && !!v.given && !v.given[c]);
      el.classList.toggle('wrong', !!val && !!v.wrong && v.wrong[c]);
      let hl = false, live = 0;
      if (val) {
        valEls[c].textContent = val;
        placed[val]++;
        hl = v.filter === val;
      }
      for (let d = 1; d <= 9; d++) {
        const k = candEls[c][d];
        const has = !val && v.cands && v.cands[c] & bit(d);
        const key = c * 10 + d;
        const gone = has && v.gone.has(key);
        const isKey = has && v.keyCands.has(key);
        k.textContent = has ? d : '';
        k.classList.toggle('on', !!has && !gone);
        k.classList.toggle('gone', !!gone);
        k.classList.toggle('hl', !!has && !gone && v.filter === d && !isKey);
        k.classList.toggle('key', !!isKey);
        k.classList.toggle('alt', !!isKey && v.keyCands.get(key) === 1);
        k.classList.toggle('target', !!has && !gone && v.targets.has(key));
        if (has && !gone) { live++; counts[d]++; if (v.filter === d) hl = true; }
      }
      if (!val && live === 2) bivCount++;
      el.classList.toggle('hl-digit', hl);
      el.classList.toggle('biv', v.biv && !val && live === 2);
      el.classList.toggle('pattern', v.pattern.has(c) && !v.pivots.has(c));
      el.classList.toggle('pivot', v.pivots.has(c));
      el.classList.toggle('house', v.houses.has(c));
      el.classList.toggle('selected', c === sel);
      el.classList.toggle('selpeer', sel >= 0 && c !== sel && E.PEERS[sel].includes(c));
    }

    const hasBoard = !!v.values;
    digitbar.querySelectorAll('.dbtn[data-d]').forEach((b) => {
      const d = +b.dataset.d;
      b.classList.toggle('active', v.filter === d);
      if (mode === 'drill') {
        b.classList.toggle('done', hasBoard && counts[d] === 0);
        b.querySelector('.cnt').textContent = hasBoard && counts[d] ? counts[d] : '';
      } else {
        const left = 9 - placed[d];
        b.classList.toggle('done', hasBoard && left <= 0);
        b.querySelector('.cnt').textContent = hasBoard && left > 0 ? left : '';
      }
    });
    const bb = digitbar.querySelector('.biv-btn');
    if (bb) {
      bb.classList.toggle('active', v.biv);
      bb.querySelector('.cnt').textContent = hasBoard ? `· ${bivCount}` : '';
    }
  }

  function candCenter(c, d) {
    return [E.COL[c] * 100 + ((d - 1) % 3) * 33.333 + 16.667, E.ROW[c] * 100 + Math.floor((d - 1) / 3) * 33.333 + 16.667];
  }
  function renderLinks(lines) {
    let s = '';
    for (const L of lines) {
      let [x1, y1] = candCenter(...L.a), [x2, y2] = candCenter(...L.b);
      const len = Math.hypot(x2 - x1, y2 - y1), r = 14;
      if (len < 2 * r) continue;
      const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      x1 += ux * r; y1 += uy * r; x2 -= ux * r; y2 -= uy * r;
      s += `<line class="${L.strong ? 'strong' : 'weak'}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    }
    $('#links').innerHTML = s;
  }

  function renderStats(el, tiles) {
    el.innerHTML = tiles.map(([l, v]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  }

  function renderDrillPanel() {
    const t = techMeta();
    renderTechPicker();
    $('#task-title').textContent = t.name;
    $('#howto').textContent = t.how;

    const verb = hasKeyboard ? 'click' : 'tap';
    $('#task-sub').textContent = {
      idle: '', loading: 'Building a brand-new puzzle where this is the next logical step…',
      playing: `Find the pattern, then ${verb} every pencil mark it eliminates.`,
      solved: hasKeyboard ? 'Nicely done. Press Enter or N for the next one.' : 'Nicely done. Tap Next puzzle for another.',
      revealed: 'Pattern revealed — red marks show the eliminations.',
    }[D.status];

    const dots = $('#dots');
    if (D.drill && D.status !== 'loading') {
      const n = D.answer.size, f = D.found.size;
      dots.innerHTML = [...Array(n)].map((_, i) => `<span class="dot ${i < f ? 'on' : D.status === 'revealed' ? 'missed' : ''}"></span>`).join('');
      dots.title = `${f} of ${n} eliminations found`;
    } else dots.innerHTML = '';

    $('#timer').textContent = fmt(D.status === 'playing' ? performance.now() - D.start : D.elapsed);
    $('#mistakes').innerHTML = D.mistakes ? `<span class="bad">${plural(D.mistakes, 'mistake')}</span>` : '';

    const playing = D.status === 'playing';
    const hb = $('#hint');
    hb.disabled = !playing || D.hintStage >= 2;
    hb.textContent = D.hintStage === 0 ? 'Hint' : 'Pattern';
    $('#reveal').disabled = !playing;
    const nb = $('#next');
    nb.disabled = D.status === 'loading';
    nb.textContent = playing || D.status === 'loading' ? 'Skip' : 'Next puzzle →';
    nb.classList.toggle('go', D.status === 'solved' || D.status === 'revealed');

    const fb = $('#feedback');
    fb.className = 'feedback' + (D.msg ? ' ' + D.msg.kind : '');
    fb.innerHTML = D.msg ? D.msg.html : '';

    const st = statsFor(tech);
    renderStats($('#stats'), [['Solved', st.solved], ['Clean', st.clean], ['Streak', st.streak], ['Best time', st.bestTime != null ? fmt(st.bestTime) : '—']]);
  }

  function renderPlayPanel() {
    diffsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.id === diff));
    const dm = diffMeta();
    $('#game-title').textContent = dm.name;
    $('#p-timer').textContent = fmt(P.status === 'playing' ? performance.now() - P.start : P.elapsed);
    $('#p-mistakes').innerHTML = P.status !== 'loading' && P.mistakes ? `<span class="bad">${plural(P.mistakes, 'mistake')}</span>` : '';

    const sub = $('#game-sub');
    const fb = $('#game-feedback');
    if (P.status === 'loading') { sub.textContent = 'Generating a fresh puzzle…'; fb.className = 'feedback'; fb.innerHTML = ''; }
    else if (P.status === 'won') {
      sub.textContent = '';
      const names = E.TECHS.filter((t) => P.game.techniques.includes(t.id)).map((t) => t.name);
      fb.className = 'feedback win';
      fb.innerHTML =
        `<div class="head">✓ Solved in ${fmt(P.elapsed)}</div>` +
        `<p>${plural(P.mistakes, 'mistake')} · ${plural(P.hints, 'hint')}</p>` +
        `<p>Techniques this puzzle needed:</p><div class="tags">${names.map((n) => `<span class="tag">${n}</span>`).join('')}</div>` +
        `<button class="btn primary go" id="play-again">New ${dm.name.toLowerCase()} game</button>`;
      $('#play-again').onclick = () => newGame(true);
    } else {
      const left = P.values ? P.values.filter((v) => !v).length : 0;
      sub.textContent = P.status === 'playing'
        ? `${left} cells to go · ${P.hints ? plural(P.hints, 'hint') + ' used' : 'stuck? tap Hint for the next logical step'}`
        : '';
      fb.className = 'feedback';
      fb.innerHTML = '';
    }

    $('#playbar').querySelectorAll('.pbtn').forEach((b) => {
      const a = b.dataset.act;
      b.disabled = P.status !== 'playing' || (a === 'undo' && !P.undo.length) || (a === 'erase' && !(editable(P.selected) && P.values[P.selected]));
      b.classList.toggle('on', (a === 'notes' && P.notes) || (a === 'biv' && P.biv) || (a === 'hint' && !!P.hint));
    });
    document.body.classList.toggle('notes-mode', P.notes);

    const hc = $('#hintcard');
    const h = P.hint;
    hc.hidden = !h || P.status !== 'playing';
    if (h) {
      hc.innerHTML =
        `<div class="hhead"><span class="hname">${h.title}</span>${h.lvl ? `<span class="lvl">${h.lvl}</span>` : ''}` +
        `<button class="close" data-h="close" aria-label="Close hint">×</button></div>` +
        `<p>${h.stage === 1 ? h.text1 : h.text2}</p>` +
        `<div class="hacts">${h.stage === 1 ? '<button class="btn" data-h="show">Show me</button>' : ''}` +
        `<button class="btn go" data-h="apply">${h.applyLabel}</button></div>`;
    }

    const st = gstatsFor(diff);
    renderStats($('#p-stats'), [['Played', st.played], ['Won', st.won], ['No-hint', st.clean], ['Best time', st.bestTime != null ? fmt(st.bestTime) : '—']]);
  }

  // Hint card lives in the side panel on wide screens, right under the board on narrow ones.
  const wide = window.matchMedia('(min-width: 980px)');
  const placeHintCard = () => (wide.matches ? $('#hint-slot') : $('.board-col')).appendChild($('#hintcard'));
  wide.addEventListener('change', placeHintCard);
  placeHintCard();

  setMode(mode);
})();
