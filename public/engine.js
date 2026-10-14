/* Sudoku engine: generator, ranked logical solver, technique finders, drill + game builders.
 * Wrapped in a factory so the same source could be shipped into a Web Worker or Node. */
function SudokuEngineFactory() {
  'use strict';

  // ---------- geometry ----------
  const ALL = 0x1ff;
  const PC = new Uint8Array(512);
  for (let i = 1; i < 512; i++) PC[i] = PC[i >> 1] + (i & 1);
  const DIGITS = [];
  for (let m = 0; m < 512; m++) {
    const a = [];
    for (let d = 1; d <= 9; d++) if (m & (1 << (d - 1))) a.push(d);
    DIGITS.push(a);
  }
  const ROW = [], COL = [], BOX = [];
  for (let i = 0; i < 81; i++) {
    ROW[i] = (i / 9) | 0;
    COL[i] = i % 9;
    BOX[i] = ((ROW[i] / 3) | 0) * 3 + ((COL[i] / 3) | 0);
  }
  const UNITS = [];
  for (let r = 0; r < 9; r++) UNITS.push([0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => r * 9 + k));
  for (let c = 0; c < 9; c++) UNITS.push([0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => k * 9 + c));
  for (let b = 0; b < 9; b++) {
    const u = [];
    for (let i = 0; i < 81; i++) if (BOX[i] === b) u.push(i);
    UNITS.push(u);
  }
  // boxes first: that's where people usually look for singles
  const HOUSE_ORDER = [18, 19, 20, 21, 22, 23, 24, 25, 26, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
  const SEES = new Uint8Array(81 * 81);
  const PEERS = [];
  for (let i = 0; i < 81; i++) {
    PEERS[i] = [];
    for (let j = 0; j < 81; j++) {
      if (i !== j && (ROW[i] === ROW[j] || COL[i] === COL[j] || BOX[i] === BOX[j])) {
        SEES[i * 81 + j] = 1;
        PEERS[i].push(j);
      }
    }
  }
  const bit = (d) => 1 << (d - 1);
  const sees = (a, b) => SEES[a * 81 + b] === 1;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // ---------- html helpers for explanations ----------
  const cn = (c) => `<span class="ref" data-c="${c}">r${ROW[c] + 1}c${COL[c] + 1}</span>`;
  const dg = (d) => `<span class="dg">${d}</span>`;
  const set = (m) => `<span class="dg">{${DIGITS[m].join('')}}</span>`;
  const digitList = (m) => andList(DIGITS[m].map(dg));
  const andList = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const unitName = (u) => (u < 9 ? `row ${u + 1}` : u < 18 ? `column ${u - 8}` : `box ${u - 17}`);
  const unitKind = (u) => (u < 9 ? 'row' : u < 18 ? 'column' : 'box');
  const lc = (o, L, k) => (o === 0 ? L * 9 + k : k * 9 + L);
  const lineName = (o, L) => (o === 0 ? `row ${L + 1}` : `column ${L + 1}`);

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function combos(arr, k, fn) {
    const pick = [];
    const rec = (start) => {
      if (pick.length === k) return fn(pick.slice()) === true;
      for (let i = start; i <= arr.length - (k - pick.length); i++) {
        pick.push(arr[i]);
        if (rec(i + 1)) return true;
        pick.pop();
      }
      return false;
    };
    rec(0);
  }

  // ---------- brute-force solver (generation / uniqueness) ----------
  function search(grid, limit, randomize) {
    const g = Array.from(grid);
    const rm = new Uint16Array(9), cm = new Uint16Array(9), bm = new Uint16Array(9);
    for (let i = 0; i < 81; i++) {
      if (!g[i]) continue;
      const b = bit(g[i]);
      if ((rm[ROW[i]] | cm[COL[i]] | bm[BOX[i]]) & b) return { count: 0, first: null };
      rm[ROW[i]] |= b; cm[COL[i]] |= b; bm[BOX[i]] |= b;
    }
    let count = 0, first = null;
    const rec = () => {
      let best = -1, bmask = 0, bc = 10;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const m = ALL & ~(rm[ROW[i]] | cm[COL[i]] | bm[BOX[i]]);
        const n = PC[m];
        if (n < bc) { bc = n; best = i; bmask = m; if (n <= 1) break; }
      }
      if (best < 0) { count++; if (!first) first = g.slice(); return; }
      if (bc === 0) return;
      const ds = randomize ? shuffle(DIGITS[bmask].slice()) : DIGITS[bmask];
      const r = ROW[best], c = COL[best], x = BOX[best];
      for (const d of ds) {
        const b = bit(d);
        g[best] = d; rm[r] |= b; cm[c] |= b; bm[x] |= b;
        rec();
        rm[r] &= ~b; cm[c] &= ~b; bm[x] &= ~b; g[best] = 0;
        if (count >= limit) return;
      }
    };
    rec();
    return { count, first };
  }

  const randomSolution = () => search(new Array(81).fill(0), 1, true).first;

  function makePuzzle(solution) {
    const puz = solution.slice();
    for (const i of shuffle([...Array(81).keys()])) {
      const v = puz[i];
      puz[i] = 0;
      if (search(puz, 2, false).count !== 1) puz[i] = v;
    }
    return puz;
  }

  // ---------- candidate state ----------
  function newState(puz) {
    const values = Array.from(puz);
    const cands = new Uint16Array(81);
    for (let i = 0; i < 81; i++) {
      if (values[i]) continue;
      let m = ALL;
      for (const p of PEERS[i]) if (values[p]) m &= ~bit(values[p]);
      cands[i] = m;
    }
    return { values, cands };
  }
  function place(st, c, d) {
    st.values[c] = d;
    st.cands[c] = 0;
    const b = ~bit(d);
    for (const p of PEERS[c]) st.cands[p] &= b;
  }
  function applyStep(st, ins) {
    if (ins.place) place(st, ins.place[0], ins.place[1]);
    for (const [c, d] of ins.elims) st.cands[c] &= ~bit(d);
  }
  const isSolved = (st) => st.values.every((v) => v);

  function seenByAll(st, anchors, d, exclude) {
    const b = bit(d), out = [];
    for (let c = 0; c < 81; c++) {
      if (!(st.cands[c] & b) || exclude.includes(c)) continue;
      if (anchors.every((a) => sees(c, a))) out.push([c, d]);
    }
    return out;
  }
  const chainLines = (cells, d, strong) => {
    const out = [];
    for (let i = 0; i + 1 < cells.length; i++) out.push({ a: [cells[i], d], b: [cells[i + 1], d], strong });
    return out;
  };
  function sharedUnits(cells) {
    const out = [];
    const c0 = cells[0];
    if (cells.every((x) => ROW[x] === ROW[c0])) out.push(ROW[c0]);
    if (cells.every((x) => COL[x] === COL[c0])) out.push(9 + COL[c0]);
    if (cells.every((x) => BOX[x] === BOX[c0])) out.push(18 + BOX[c0]);
    return out;
  }

  // =====================================================================
  // Technique finders. Each returns instances:
  //   { place?: [c,d], elims: [[c,d]], cells, keyCands: [[c,d,colour?]], pivot, houses,
  //     lines, digit, text, hint1, hintBiv }
  // =====================================================================

  // ---------- singles ----------
  function findFullHouse(st) {
    const out = [], seen = new Set();
    for (const u of HOUSE_ORDER) {
      let cell = -1, n = 0;
      for (const c of UNITS[u]) if (!st.values[c]) { n++; cell = c; }
      if (n !== 1 || seen.has(cell) || PC[st.cands[cell]] !== 1) continue;
      seen.add(cell);
      const d = DIGITS[st.cands[cell]][0];
      out.push({
        place: [cell, d], cells: [cell], keyCands: [[cell, d]], houses: [u], digit: d,
        text: `${cn(cell)} is the only empty cell left in ${unitName(u)}, so it takes the missing digit, ${dg(d)}.`,
        hint1: `${cap(unitName(u))} has only one empty cell left.`,
      });
    }
    return out;
  }

  function findHiddenSingle(st) {
    const out = [], seen = new Set();
    for (const u of HOUSE_ORDER) {
      for (let d = 1; d <= 9; d++) {
        const b = bit(d);
        let pos = -1, n = 0;
        for (const c of UNITS[u]) if (st.cands[c] & b) { n++; pos = c; }
        if (n !== 1 || seen.has(pos * 10 + d)) continue;
        seen.add(pos * 10 + d);
        out.push({
          place: [pos, d], cells: [pos], keyCands: [[pos, d]], houses: [u], digit: d,
          text: `In ${unitName(u)}, ${dg(d)} has only one possible spot: ${cn(pos)}. Every other cell in the ${unitKind(u)} already sees a ${dg(d)}.`,
          hint1: `Look at ${unitName(u)}: one digit has only one place it can go.`,
        });
      }
    }
    return out;
  }

  function findNakedSingle(st) {
    const out = [];
    for (let c = 0; c < 81; c++) {
      if (st.values[c] || PC[st.cands[c]] !== 1) continue;
      const d = DIGITS[st.cands[c]][0];
      out.push({
        place: [c, d], cells: [c], keyCands: [[c, d]], houses: [18 + BOX[c]], digit: null,
        text: `${cn(c)} has only one candidate left: ${dg(d)}. Every other digit already appears in its row, column or box.`,
        hint1: `Somewhere in ${unitName(18 + BOX[c])} there's a cell with just one candidate left.`,
      });
    }
    return out;
  }

  // ---------- locked candidates ----------
  function findPointing(st) {
    const out = [];
    for (let b = 0; b < 9; b++) {
      for (let d = 1; d <= 9; d++) {
        const bt = bit(d);
        const cells = UNITS[18 + b].filter((c) => st.cands[c] & bt);
        if (cells.length < 2) continue;
        for (const line of sharedUnits(cells)) {
          if (line >= 18) continue;
          const elims = UNITS[line].filter((c) => BOX[c] !== b && st.cands[c] & bt).map((c) => [c, d]);
          if (!elims.length) continue;
          out.push({
            cells, keyCands: cells.map((c) => [c, d]), houses: [18 + b, line], digit: d, elims,
            text: `In box ${b + 1}, every ${dg(d)} candidate sits in ${unitName(line)}. Box ${b + 1}'s ${dg(d)} must therefore be in ${unitName(line)}, so ${dg(d)} can be removed from the rest of ${unitName(line)}.`,
            hint1: `Filter on ${dg(d)} and look at box ${b + 1}.`,
          });
        }
      }
    }
    return out;
  }

  function findClaiming(st) {
    const out = [];
    for (let u = 0; u < 18; u++) {
      for (let d = 1; d <= 9; d++) {
        const bt = bit(d);
        const cells = UNITS[u].filter((c) => st.cands[c] & bt);
        if (cells.length < 2 || !cells.every((c) => BOX[c] === BOX[cells[0]])) continue;
        const b = BOX[cells[0]];
        const elims = UNITS[18 + b].filter((c) => !UNITS[u].includes(c) && st.cands[c] & bt).map((c) => [c, d]);
        if (!elims.length) continue;
        out.push({
          cells, keyCands: cells.map((c) => [c, d]), houses: [u, 18 + b], digit: d, elims,
          text: `In ${unitName(u)}, every ${dg(d)} candidate is inside box ${b + 1}. The ${unitKind(u)}'s ${dg(d)} must be in that box, so ${dg(d)} can be removed from box ${b + 1}'s other cells.`,
          hint1: `Filter on ${dg(d)} and look at ${unitName(u)}.`,
        });
      }
    }
    return out;
  }

  // ---------- subsets ----------
  const SUBSET_NAME = { 2: 'pair', 3: 'triple', 4: 'quad' };

  function findNakedSubset(st, n) {
    const map = new Map();
    for (let u = 0; u < 27; u++) {
      const cells = UNITS[u].filter((c) => PC[st.cands[c]] >= 2 && PC[st.cands[c]] <= n);
      if (cells.length < n) continue;
      combos(cells, n, (pick) => {
        let m = 0;
        for (const c of pick) m |= st.cands[c];
        if (PC[m] !== n) return;
        const key = pick.join('-');
        if (map.has(key)) return;
        const units = sharedUnits(pick);
        const seen = new Set(), elims = [];
        for (const v of units) {
          for (const c of UNITS[v]) {
            if (pick.includes(c) || !(st.cands[c] & m)) continue;
            for (const d of DIGITS[st.cands[c] & m]) if (!seen.has(c * 10 + d)) { seen.add(c * 10 + d); elims.push([c, d]); }
          }
        }
        if (!elims.length) return;
        map.set(key, {
          cells: pick,
          keyCands: pick.flatMap((c) => DIGITS[st.cands[c]].map((d) => [c, d])),
          houses: units, digit: null, elims,
          text: `${cap(andList(pick.map(cn)))} contain only ${set(m)} between them. Those ${n} cells must hold exactly those ${n} digits, so ${digitList(m)} can be removed from the rest of ${andList(units.map(unitName))}.`,
          hint1: `Look at ${unitName(units[0])}: ${n} cells share the same ${n} candidates.`,
        });
      });
    }
    return [...map.values()];
  }

  function findHiddenSubset(st, n) {
    const map = new Map();
    for (let u = 0; u < 27; u++) {
      const U = UNITS[u];
      const digs = [];
      for (let d = 1; d <= 9; d++) {
        let m = 0;
        U.forEach((c, i) => { if (st.cands[c] & bit(d)) m |= 1 << i; });
        if (PC[m] >= 2 && PC[m] <= n) digs.push({ d, m });
      }
      if (digs.length < n) continue;
      combos(digs, n, (pick) => {
        let pos = 0, keep = 0;
        for (const p of pick) { pos |= p.m; keep |= bit(p.d); }
        if (PC[pos] !== n) return;
        const cells = U.filter((_, i) => pos & (1 << i));
        const key = cells.join('-') + ':' + keep;
        if (map.has(key)) return;
        const elims = [];
        for (const c of cells) for (const d of DIGITS[st.cands[c] & ~keep]) elims.push([c, d]);
        if (!elims.length) return;
        map.set(key, {
          cells,
          keyCands: cells.flatMap((c) => DIGITS[st.cands[c] & keep].map((d) => [c, d])),
          houses: [u], digit: null, elims,
          text: `In ${unitName(u)}, ${digitList(keep)} only appear in ${andList(cells.map(cn))}. Those ${n} cells must hold those ${n} digits, so every other candidate in them can be removed.`,
          hint1: `Look at ${unitName(u)}: ${n} digits are confined to the same ${n} cells.`,
        });
      });
    }
    return [...map.values()];
  }

  // ---------- fish ----------
  const FISH_NAME = { 2: 'X-Wing', 3: 'Swordfish', 4: 'Jellyfish' };
  function findFish(st, n) {
    const out = [];
    for (let d = 1; d <= 9; d++) {
      const b = bit(d);
      for (let o = 0; o < 2; o++) {
        const lines = [];
        for (let L = 0; L < 9; L++) {
          let m = 0;
          for (let k = 0; k < 9; k++) if (st.cands[lc(o, L, k)] & b) m |= 1 << k;
          if (PC[m] >= 2 && PC[m] <= n) lines.push({ L, m });
        }
        if (lines.length < n) continue;
        combos(lines, n, (pick) => {
          let u = 0;
          for (const l of pick) u |= l.m;
          if (PC[u] !== n) return;
          if (n > 2) {
            // skip fish that are really a smaller fish in disguise
            let smaller = false;
            for (let k = 2; k < n && !smaller; k++) {
              combos(pick, k, (sub) => {
                let su = 0;
                for (const l of sub) su |= l.m;
                if (PC[su] === k) { smaller = true; return true; }
              });
            }
            if (smaller) return;
          }
          const base = pick.map((l) => l.L);
          const cover = DIGITS[u].map((x) => x - 1);
          const elims = [];
          for (const k of cover) {
            for (let L = 0; L < 9; L++) {
              if (base.includes(L)) continue;
              const c = lc(o, L, k);
              if (st.cands[c] & b) elims.push([c, d]);
            }
          }
          if (!elims.length) return;
          const cells = [], lns = [];
          for (const L of base) {
            const inLine = cover.map((k) => lc(o, L, k)).filter((c) => st.cands[c] & b);
            cells.push(...inLine);
            lns.push(...chainLines(inLine, d, inLine.length === 2));
          }
          for (const k of cover) {
            lns.push(...chainLines(base.map((L) => lc(o, L, k)).filter((c) => st.cands[c] & b), d, false));
          }
          const bw = o === 0 ? 'rows' : 'columns', cw = o === 0 ? 'columns' : 'rows';
          const baseList = andList(base.map((L) => String(L + 1)));
          const coverList = andList(cover.map((k) => String(k + 1)));
          out.push({
            digit: d, cells, keyCands: cells.map((c) => [c, d]), elims, lines: lns,
            text:
              `In ${bw} ${baseList}, ${dg(d)} can only go in ${cw} ${coverList}. ` +
              `Those ${n} ${bw} need ${n} ${dg(d)}s, and they must occupy all ${n} of those ${cw} — ` +
              `so no other cell in ${cw} ${coverList} can be ${dg(d)}.`,
            hint1: `Filter on ${dg(d)}. Look for ${n} ${bw} where ${dg(d)} is confined to the same ${n} ${cw}.`,
          });
        });
      }
    }
    return out;
  }

  function findFinnedXWing(st) {
    const out = [];
    for (let d = 1; d <= 9; d++) {
      const b = bit(d);
      for (let o = 0; o < 2; o++) {
        const masks = [];
        for (let L = 0; L < 9; L++) {
          let m = 0;
          for (let k = 0; k < 9; k++) if (st.cands[lc(o, L, k)] & b) m |= 1 << k;
          masks.push(m);
        }
        for (let L1 = 0; L1 < 9; L1++) {
          if (PC[masks[L1]] !== 2) continue;
          const corners = DIGITS[masks[L1]].map((x) => x - 1);
          for (let L2 = 0; L2 < 9; L2++) {
            if (L2 === L1 || (masks[L2] & masks[L1]) !== masks[L1]) continue;
            const finMask = masks[L2] & ~masks[L1];
            if (!finMask) continue;
            const fins = DIGITS[finMask].map((x) => lc(o, L2, x - 1));
            for (const k of corners) {
              const corner = lc(o, L2, k);
              const finBox = BOX[corner];
              if (!fins.every((f) => BOX[f] === finBox)) continue;
              const elims = [];
              for (let L = 0; L < 9; L++) {
                if (L === L1 || L === L2) continue;
                const c = lc(o, L, k);
                if (BOX[c] === finBox && st.cands[c] & b) elims.push([c, d]);
              }
              if (!elims.length) continue;
              const xcells = [lc(o, L1, corners[0]), lc(o, L1, corners[1]), lc(o, L2, corners[0]), lc(o, L2, corners[1])];
              const cw = o === 0 ? 'column' : 'row';
              out.push({
                digit: d,
                cells: [...xcells, ...fins],
                keyCands: [...xcells.map((c) => [c, d]), ...fins.map((c) => [c, d, 1])],
                houses: [18 + finBox],
                elims,
                lines: [
                  { a: [xcells[0], d], b: [xcells[1], d], strong: true },
                  { a: [xcells[0], d], b: [xcells[2], d], strong: false },
                  { a: [xcells[1], d], b: [xcells[3], d], strong: false },
                ],
                text:
                  `${cap(lineName(o, L1))} and ${lineName(o, L2)} would form an X-Wing on ${dg(d)} in ${cw}s ${corners[0] + 1} and ${corners[1] + 1}, ` +
                  `except ${lineName(o, L2)} has an extra ${dg(d)} — the fin — at ${andList(fins.map(cn))} (pink) in box ${finBox + 1}. ` +
                  `Either the X-Wing holds (clearing ${cw} ${k + 1}) or the fin is ${dg(d)} (clearing box ${finBox + 1}). ` +
                  `Cells in both ${cw} ${k + 1} and box ${finBox + 1} lose ${dg(d)} either way.`,
                hint1: `Filter on ${dg(d)}. Look for an almost-X-Wing with an extra candidate in box ${finBox + 1}.`,
              });
            }
          }
        }
      }
    }
    return out;
  }

  // ---------- single-digit patterns ----------
  function conjugateLines(st, d, o) {
    const b = bit(d), out = [];
    for (let L = 0; L < 9; L++) {
      const cells = [];
      for (let k = 0; k < 9; k++) if (st.cands[lc(o, L, k)] & b) cells.push(lc(o, L, k));
      if (cells.length === 2) out.push({ L, cells, ks: cells.map((c) => (o === 0 ? COL[c] : ROW[c])) });
    }
    return out;
  }

  function findSkyscraper(st) {
    const out = [];
    for (let d = 1; d <= 9; d++) {
      for (let o = 0; o < 2; o++) {
        const ls = conjugateLines(st, d, o);
        for (let i = 0; i < ls.length; i++) {
          for (let j = i + 1; j < ls.length; j++) {
            const A = ls[i], B = ls[j];
            const shared = A.ks.filter((k) => B.ks.includes(k));
            if (shared.length !== 1) continue;
            const k = shared[0];
            const baseA = A.cells[A.ks.indexOf(k)], topA = A.cells[1 - A.ks.indexOf(k)];
            const baseB = B.cells[B.ks.indexOf(k)], topB = B.cells[1 - B.ks.indexOf(k)];
            const cells = [baseA, topA, baseB, topB];
            const elims = seenByAll(st, [topA, topB], d, cells);
            if (!elims.length) continue;
            const cw = o === 0 ? 'column' : 'row';
            out.push({
              digit: d, cells, keyCands: cells.map((c) => [c, d]), elims,
              lines: [
                { a: [baseA, d], b: [topA, d], strong: true },
                { a: [baseB, d], b: [topB, d], strong: true },
                { a: [baseA, d], b: [baseB, d], strong: false },
              ],
              text:
                `${cap(lineName(o, A.L))} and ${lineName(o, B.L)} each have ${dg(d)} in exactly two cells, ` +
                `and both pairs share ${cw} ${k + 1} (${cn(baseA)}, ${cn(baseB)}). At most one of those base cells can be ${dg(d)}, ` +
                `so at least one of the tops — ${cn(topA)} or ${cn(topB)} — is ${dg(d)}. Any cell that sees both tops can't be ${dg(d)}.`,
              hint1: `Filter on ${dg(d)}. Find two parallel lines where ${dg(d)} appears exactly twice, lined up at one end.`,
            });
          }
        }
      }
    }
    return out;
  }

  function findKite(st) {
    const out = [];
    for (let d = 1; d <= 9; d++) {
      const rows = conjugateLines(st, d, 0), cols = conjugateLines(st, d, 1);
      for (const R of rows) {
        for (const C of cols) {
          for (let i = 0; i < 2; i++) {
            for (let j = 0; j < 2; j++) {
              const rIn = R.cells[i], rOut = R.cells[1 - i], cIn = C.cells[j], cOut = C.cells[1 - j];
              if (rIn === cIn || BOX[rIn] !== BOX[cIn]) continue;
              if (BOX[rOut] === BOX[rIn] || BOX[cOut] === BOX[cIn]) continue;
              const cells = [rOut, rIn, cIn, cOut];
              if (new Set(cells).size !== 4) continue;
              const elims = seenByAll(st, [rOut, cOut], d, cells);
              if (!elims.length) continue;
              out.push({
                digit: d, cells, keyCands: cells.map((c) => [c, d]), elims,
                lines: [
                  { a: [rOut, d], b: [rIn, d], strong: true },
                  { a: [rIn, d], b: [cIn, d], strong: false },
                  { a: [cIn, d], b: [cOut, d], strong: true },
                ],
                text:
                  `Row ${R.L + 1} has ${dg(d)} only in ${cn(rIn)} and ${cn(rOut)}; column ${C.L + 1} has ${dg(d)} only in ${cn(cIn)} and ${cn(cOut)}. ` +
                  `${cn(rIn)} and ${cn(cIn)} share box ${BOX[rIn] + 1}, so they can't both be ${dg(d)} — ` +
                  `which forces ${cn(rOut)} or ${cn(cOut)} to be ${dg(d)}. A cell seeing both of those ends can't be ${dg(d)}.`,
                hint1: `Filter on ${dg(d)}. Find a row and a column that each hold exactly two ${dg(d)}s, with one end of each in the same box.`,
              });
            }
          }
        }
      }
    }
    return out;
  }

  function findEmptyRect(st) {
    const out = [];
    for (let d = 1; d <= 9; d++) {
      const bt = bit(d);
      for (let b = 0; b < 9; b++) {
        const S = UNITS[18 + b].filter((c) => st.cands[c] & bt);
        if (S.length < 2) continue;
        const bRows = [0, 1, 2].map((i) => ((b / 3) | 0) * 3 + i);
        const bCols = [0, 1, 2].map((i) => (b % 3) * 3 + i);
        for (const r of bRows) {
          for (const c of bCols) {
            if (!S.every((x) => ROW[x] === r || COL[x] === c)) continue;
            if (!S.some((x) => ROW[x] === r && COL[x] !== c) || !S.some((x) => COL[x] === c && ROW[x] !== r)) continue;
            const make = (A, B, X, linkUnit) => ({
              digit: d,
              cells: [...S, A, B],
              keyCands: [...S, A, B].map((x) => [x, d]),
              houses: [18 + b],
              elims: [[X, d]],
              lines: [{ a: [A, d], b: [B, d], strong: true }],
              text:
                `In box ${b + 1}, every ${dg(d)} lies in row ${r + 1} or column ${c + 1} — an empty rectangle. ` +
                `${cap(unitName(linkUnit))} has ${dg(d)} only at ${cn(A)} and ${cn(B)}. ` +
                `If ${cn(X)} were ${dg(d)}, box ${b + 1}'s ${dg(d)} would be pushed onto the line through ${cn(A)}, removing ${dg(d)} from ${cn(A)} and forcing ${cn(B)} to be ${dg(d)} — ` +
                `but ${cn(B)} sees ${cn(X)}. So ${cn(X)} can't be ${dg(d)}.`,
              hint1: `Filter on ${dg(d)} and look at box ${b + 1}: its ${dg(d)}s form a cross.`,
            });
            // strong link in a column outside the box, one end on the ER row
            for (let C = 0; C < 9; C++) {
              if (bCols.includes(C)) continue;
              const link = UNITS[9 + C].filter((x) => st.cands[x] & bt);
              if (link.length !== 2) continue;
              for (const [A, B] of [link, [link[1], link[0]]]) {
                if (ROW[A] !== r || bRows.includes(ROW[B])) continue;
                const X = ROW[B] * 9 + c;
                if (st.cands[X] & bt) out.push(make(A, B, X, 9 + C));
              }
            }
            // strong link in a row outside the box, one end on the ER column
            for (let R = 0; R < 9; R++) {
              if (bRows.includes(R)) continue;
              const link = UNITS[R].filter((x) => st.cands[x] & bt);
              if (link.length !== 2) continue;
              for (const [A, B] of [link, [link[1], link[0]]]) {
                if (COL[A] !== c || bCols.includes(COL[B])) continue;
                const X = r * 9 + COL[B];
                if (st.cands[X] & bt) out.push(make(A, B, X, R));
              }
            }
          }
        }
      }
    }
    return out;
  }

  function findSimpleColoring(st) {
    const out = [];
    for (let d = 1; d <= 9; d++) {
      const b = bit(d);
      const adj = new Map();
      for (const U of UNITS) {
        const cells = U.filter((c) => st.cands[c] & b);
        if (cells.length !== 2) continue;
        const [x, y] = cells;
        if (!adj.has(x)) adj.set(x, new Set());
        if (!adj.has(y)) adj.set(y, new Set());
        adj.get(x).add(y);
        adj.get(y).add(x);
      }
      const color = new Map();
      for (const start of adj.keys()) {
        if (color.has(start)) continue;
        const comp = [start];
        color.set(start, 0);
        for (let i = 0; i < comp.length; i++) {
          for (const n of adj.get(comp[i])) {
            if (!color.has(n)) { color.set(n, 1 - color.get(comp[i])); comp.push(n); }
          }
        }
        if (comp.length < 4) continue;
        const edges = [];
        for (const x of comp) for (const y of adj.get(x)) if (x < y) edges.push({ a: [x, d], b: [y, d], strong: true });
        const keyCands = comp.map((x) => [x, d, color.get(x)]);
        const NAME = ['blue', 'pink'];
        // colour wrap: two cells of one colour see each other -> that colour is false
        for (const k of [0, 1]) {
          const same = comp.filter((x) => color.get(x) === k);
          let clash = null;
          for (let i = 0; i < same.length && !clash; i++) for (let j = i + 1; j < same.length; j++) if (sees(same[i], same[j])) { clash = [same[i], same[j]]; break; }
          if (!clash) continue;
          out.push({
            digit: d, cells: comp, keyCands, elims: same.map((x) => [x, d]), lines: edges,
            text:
              `Link the ${dg(d)}s through units where ${dg(d)} appears exactly twice, alternating blue and pink — exactly one colour is true. ` +
              `Two ${NAME[k]} cells, ${cn(clash[0])} and ${cn(clash[1])}, see each other, so ${NAME[k]} can't be the true colour: every ${NAME[k]} cell loses ${dg(d)}.`,
            hint1: `Filter on ${dg(d)} and follow its strong links (units with exactly two ${dg(d)}s).`,
          });
        }
        // colour trap: an uncoloured cell that sees both colours
        const elims = [];
        for (let c = 0; c < 81; c++) {
          if (!(st.cands[c] & b) || color.has(c)) continue;
          const seen = new Set(comp.filter((x) => sees(c, x)).map((x) => color.get(x)));
          if (seen.size === 2) elims.push([c, d]);
        }
        if (elims.length) {
          out.push({
            digit: d, cells: comp, keyCands, elims, lines: edges,
            text:
              `Link the ${dg(d)}s through units where ${dg(d)} appears exactly twice, alternating blue and pink — one colour is entirely true. ` +
              `Any cell that sees both a blue ${dg(d)} and a pink ${dg(d)} can't be ${dg(d)}, whichever colour wins.`,
            hint1: `Filter on ${dg(d)} and follow its strong links (units with exactly two ${dg(d)}s).`,
          });
        }
      }
    }
    return out;
  }

  // ---------- wings & chains ----------
  function findXYWing(st) {
    const out = [];
    const seen = new Set();
    for (let p = 0; p < 81; p++) {
      const pm = st.cands[p];
      if (PC[pm] !== 2) continue;
      const wings = PEERS[p].filter((c) => PC[st.cands[c]] === 2 && st.cands[c] !== pm && PC[st.cands[c] & pm] === 1);
      for (let i = 0; i < wings.length; i++) {
        for (let j = i + 1; j < wings.length; j++) {
          const a = wings[i], b = wings[j], ma = st.cands[a], mb = st.cands[b];
          if (ma === mb || PC[pm | ma | mb] !== 3) continue;
          const zm = ma & mb & ~pm;
          if (PC[zm] !== 1) continue;
          const z = DIGITS[zm][0];
          const elims = seenByAll(st, [a, b], z, [p, a, b]);
          if (!elims.length) continue;
          const key = [p, a, b].join('-');
          if (seen.has(key)) continue;
          seen.add(key);
          const x = DIGITS[ma & pm][0], y = DIGITS[mb & pm][0];
          out.push({
            pivot: [p], cells: [p, a, b], elims, hintBiv: true,
            keyCands: [[p, x], [p, y], [a, x], [a, z], [b, y], [b, z]],
            lines: [
              { a: [p, x], b: [a, x], strong: false },
              { a: [p, y], b: [b, y], strong: false },
            ],
            text:
              `Pivot ${cn(p)} is ${set(pm)}. It sees ${cn(a)} ${set(ma)} and ${cn(b)} ${set(mb)}. ` +
              `If the pivot is ${dg(x)}, ${cn(a)} becomes ${dg(z)}; if it's ${dg(y)}, ${cn(b)} becomes ${dg(z)}. ` +
              `Either way one pincer is ${dg(z)}, so any cell seeing both pincers can't be ${dg(z)}.`,
            hint1: `The pivot is ${cn(p)}. Find two bivalue cells it sees that also share a digit with each other.`,
          });
        }
      }
    }
    return out;
  }

  function findXYZWing(st) {
    const out = [];
    for (let p = 0; p < 81; p++) {
      const pm = st.cands[p];
      if (PC[pm] !== 3) continue;
      const wings = PEERS[p].filter((c) => PC[st.cands[c]] === 2 && (st.cands[c] & ~pm) === 0);
      for (let i = 0; i < wings.length; i++) {
        for (let j = i + 1; j < wings.length; j++) {
          const a = wings[i], b = wings[j], ma = st.cands[a], mb = st.cands[b];
          if (ma === mb) continue;
          const zm = ma & mb;
          if (PC[zm] !== 1) continue;
          const z = DIGITS[zm][0];
          const elims = seenByAll(st, [p, a, b], z, [p, a, b]);
          if (!elims.length) continue;
          const x = DIGITS[ma & ~zm][0], y = DIGITS[mb & ~zm][0];
          out.push({
            pivot: [p], cells: [p, a, b], elims, hintBiv: true,
            keyCands: [[p, x], [p, y], [p, z], [a, x], [a, z], [b, y], [b, z]],
            lines: [
              { a: [p, x], b: [a, x], strong: false },
              { a: [p, y], b: [b, y], strong: false },
            ],
            text:
              `Pivot ${cn(p)} is ${set(pm)}, with pincers ${cn(a)} ${set(ma)} and ${cn(b)} ${set(mb)}. ` +
              `If the pivot is ${dg(x)}, ${cn(a)} is ${dg(z)}; if ${dg(y)}, ${cn(b)} is ${dg(z)}; otherwise the pivot itself is ${dg(z)}. ` +
              `One of the three is always ${dg(z)}, so a cell seeing all three can't be ${dg(z)}.`,
            hint1: `The pivot is ${cn(p)} — a three-candidate cell. Its pincers are bivalue cells drawn from its own candidates.`,
          });
        }
      }
    }
    return out;
  }

  function strongLinks(st, d) {
    const b = bit(d), out = [], seen = new Set();
    UNITS.forEach((u, ui) => {
      const cells = u.filter((c) => st.cands[c] & b);
      if (cells.length !== 2) return;
      const key = cells.join('-');
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ cells, unit: ui });
    });
    return out;
  }

  function findWWing(st) {
    const out = [];
    const biv = [];
    for (let c = 0; c < 81; c++) if (PC[st.cands[c]] === 2) biv.push(c);
    const links = {};
    for (let i = 0; i < biv.length; i++) {
      for (let j = i + 1; j < biv.length; j++) {
        const A = biv[i], B = biv[j];
        if (st.cands[A] !== st.cands[B] || sees(A, B)) continue;
        const [d1, d2] = DIGITS[st.cands[A]];
        for (const [x, y] of [[d1, d2], [d2, d1]]) {
          const elims = seenByAll(st, [A, B], y, [A, B]);
          if (!elims.length) continue;
          links[x] = links[x] || strongLinks(st, x);
          for (const L of links[x]) {
            const [s1, s2] = L.cells;
            if (s1 === A || s1 === B || s2 === A || s2 === B) continue;
            let sa, sb;
            if (sees(s1, A) && sees(s2, B)) { sa = s1; sb = s2; }
            else if (sees(s2, A) && sees(s1, B)) { sa = s2; sb = s1; }
            else continue;
            out.push({
              pivot: [A, B], cells: [A, sa, sb, B], elims, hintBiv: true,
              keyCands: [[A, x], [A, y], [B, x], [B, y], [sa, x], [sb, x]],
              lines: [
                { a: [A, x], b: [sa, x], strong: false },
                { a: [sa, x], b: [sb, x], strong: true },
                { a: [sb, x], b: [B, x], strong: false },
              ],
              text:
                `${cn(A)} and ${cn(B)} are both ${set(st.cands[A])} and don't see each other. ` +
                `In ${unitName(L.unit)}, ${dg(x)} must be in ${cn(sa)} or ${cn(sb)}. ` +
                `If neither wing cell were ${dg(y)}, both would be ${dg(x)} — killing ${dg(x)} from both ${cn(sa)} and ${cn(sb)}. ` +
                `So one of ${cn(A)}, ${cn(B)} is ${dg(y)}, and any cell seeing both can't be ${dg(y)}.`,
              hint1: `Look at the bivalue cells ${cn(A)} and ${cn(B)} — both ${set(st.cands[A])}. What connects them?`,
            });
            break; // one link is enough per (A, B, x)
          }
        }
      }
    }
    return out;
  }

  function findXYChain(st, one) {
    const MAX = 8;
    const biv = [];
    for (let c = 0; c < 81; c++) if (PC[st.cands[c]] === 2) biv.push(c);
    const nbrs = new Map(biv.map((c) => [c, biv.filter((x) => sees(c, x))]));
    const best = new Map();
    let done = false;
    const other = (c, d) => DIGITS[st.cands[c] & ~bit(d)][0];
    for (const A of biv) {
      for (const z of DIGITS[st.cands[A]]) {
        const path = [A], links = [];
        const dfs = (cur, link) => {
          for (const B of nbrs.get(cur)) {
            if (done) return;
            if (path.includes(B) || !(st.cands[B] & bit(link))) continue;
            const y = other(B, link);
            path.push(B); links.push(link);
            if (y === z && path.length >= 4) {
              const elims = seenByAll(st, [A, B], z, path);
              if (elims.length) {
                const sig = elims.map(([c, d]) => c * 10 + d).sort((p, q) => p - q).join(',');
                if (!best.has(sig) || best.get(sig).path.length > path.length) best.set(sig, { path: path.slice(), links: links.slice(), z, elims });
                if (one) done = true;
              }
            }
            if (path.length < MAX) dfs(B, y);
            path.pop(); links.pop();
          }
        };
        dfs(A, other(A, z));
        if (done) break;
      }
      if (done) break;
    }
    return [...best.values()].map(({ path, links, z, elims }) => {
      const E = path[path.length - 1];
      const lines = [];
      for (let i = 0; i < links.length; i++) lines.push({ a: [path[i], links[i]], b: [path[i + 1], links[i]], strong: false });
      const steps = path.map((c, i) => `${cn(c)}=${dg(i === 0 ? other(c, z) : other(c, links[i - 1]))}`).join(' → ');
      return {
        pivot: [path[0], E], cells: path, elims, hintBiv: true,
        keyCands: path.flatMap((c) => DIGITS[st.cands[c]].map((d) => [c, d, d === z && (c === path[0] || c === E) ? 1 : 0])),
        lines,
        text:
          `Chain of bivalue cells: if ${cn(path[0])} isn't ${dg(z)}, then ${steps}. ` +
          `So either ${cn(path[0])} or ${cn(E)} is ${dg(z)} (pink), and any cell that sees both can't be ${dg(z)}.`,
        hint1: `Turn on bivalue. A chain of bivalue cells runs from ${cn(path[0])} to ${cn(E)}.`,
      };
    });
  }

  // ---------- uniqueness ----------
  function findUniqueRect(st) {
    const out = [];
    for (let r1 = 0; r1 < 9; r1++) for (let r2 = r1 + 1; r2 < 9; r2++) {
      for (let c1 = 0; c1 < 9; c1++) for (let c2 = c1 + 1; c2 < 9; c2++) {
        const cs = [r1 * 9 + c1, r1 * 9 + c2, r2 * 9 + c1, r2 * 9 + c2];
        if (new Set(cs.map((c) => BOX[c])).size !== 2) continue;
        if (cs.some((c) => !st.cands[c])) continue;
        const bivs = cs.filter((c) => PC[st.cands[c]] === 2);
        if (bivs.length !== 3) continue;
        const m = st.cands[bivs[0]];
        if (!bivs.every((c) => st.cands[c] === m)) continue;
        const roof = cs.find((c) => !bivs.includes(c));
        if ((st.cands[roof] & m) !== m) continue;
        out.push({
          cells: cs, pivot: [roof],
          keyCands: cs.flatMap((c) => DIGITS[m].map((d) => [c, d])),
          elims: DIGITS[m].map((d) => [roof, d]),
          lines: [],
          text:
            `${andList(bivs.map(cn))} are all ${set(m)}, and with ${cn(roof)} they form a rectangle across two boxes. ` +
            `If ${cn(roof)} were also just ${set(m)}, the two digits could be swapped around the rectangle and the puzzle would have two solutions. ` +
            `A proper sudoku has exactly one, so ${cn(roof)} can't be ${digitList(m)}.`,
          hint1: `Turn on bivalue: three identical bivalue cells sit on the corners of a rectangle.`,
          hintBiv: true,
        });
      }
    }
    return out;
  }

  // =====================================================================
  // Ranked technique registry (easiest first). The solver always applies
  // the first technique in this list that makes progress.
  // =====================================================================
  const LEVELS = ['Singles', 'Basic', 'Intermediate', 'Advanced', 'Expert'];
  const TECHS = [
    { id: 'fullhouse', name: 'Full House', level: 0, find: findFullHouse },
    { id: 'hiddensingle', name: 'Hidden Single', level: 0, find: findHiddenSingle },
    { id: 'nakedsingle', name: 'Naked Single', level: 0, find: findNakedSingle },
    {
      id: 'pointing', name: 'Pointing', level: 1, drill: true, cat: 'Locked candidates', find: findPointing,
      how: 'When all of a digit’s candidates inside a box sit in one row (or column), the box’s copy of that digit must be in that line — so it can be removed from the rest of the line outside the box.',
    },
    {
      id: 'claiming', name: 'Box/Line Reduction', level: 1, drill: true, cat: 'Locked candidates', find: findClaiming,
      how: 'When all of a digit’s candidates in a row (or column) fall inside one box, that line’s copy must be in that box — so the digit can be removed from the box’s other cells.',
    },
    {
      id: 'nakedpair', name: 'Naked Pair', level: 1, drill: true, cat: 'Subset', find: (st) => findNakedSubset(st, 2),
      how: 'Two cells in the same unit containing only the same two candidates. Those two digits are locked into those cells, so remove them from every other cell in the unit.',
    },
    {
      id: 'hiddenpair', name: 'Hidden Pair', level: 1, drill: true, cat: 'Subset', find: (st) => findHiddenSubset(st, 2),
      how: 'Two digits that, within a unit, can only go in the same two cells. Those cells must hold those two digits, so every other candidate in them can be removed.',
    },
    {
      id: 'nakedtriple', name: 'Naked Triple', level: 2, drill: true, cat: 'Subset', find: (st) => findNakedSubset(st, 3),
      how: 'Three cells in a unit whose candidates, combined, are just three digits (each cell may hold two or three of them). Those digits are locked into the three cells — remove them from the rest of the unit.',
    },
    {
      id: 'hiddentriple', name: 'Hidden Triple', level: 2, drill: true, cat: 'Subset', find: (st) => findHiddenSubset(st, 3),
      how: 'Three digits that, within a unit, are confined to the same three cells. Those cells must hold those digits, so every other candidate in them can be removed.',
    },
    {
      id: 'xwing', name: 'X-Wing', level: 2, drill: true, cat: 'Fish', find: (st) => findFish(st, 2),
      how: 'Two rows each allow a digit in exactly the same two columns. The digits must sit on opposite corners of that rectangle, so both columns are claimed — remove the digit from every other cell in those two columns. (Works the same with rows and columns swapped.)',
    },
    {
      id: 'skyscraper', name: 'Skyscraper', level: 2, drill: true, cat: 'Single digit', find: findSkyscraper,
      how: 'Two parallel lines each have a digit in exactly two places, with one end of each lined up (the base). Only one base can hold the digit, so at least one of the two “tops” must — any cell seeing both tops loses that digit.',
    },
    {
      id: 'kite', name: '2-String Kite', level: 2, drill: true, cat: 'Single digit', find: findKite,
      how: 'A row and a column each contain a digit exactly twice. One end of each pair sits in the same box, so they can’t both be true — therefore one of the far ends is the digit, and cells seeing both far ends lose it.',
    },
    { id: 'nakedquad', name: 'Naked Quad', level: 2, find: (st) => findNakedSubset(st, 4) },
    { id: 'hiddenquad', name: 'Hidden Quad', level: 2, find: (st) => findHiddenSubset(st, 4) },
    {
      id: 'xywing', name: 'XY-Wing', level: 3, drill: true, cat: 'Wing', find: findXYWing,
      how: 'A bivalue pivot {X,Y} sees two bivalue pincers {X,Z} and {Y,Z}. Whatever the pivot is, one pincer becomes Z — so Z can be removed from any cell that sees both pincers.',
    },
    {
      id: 'xyzwing', name: 'XYZ-Wing', level: 3, drill: true, cat: 'Wing', find: findXYZWing,
      how: 'Like an XY-Wing, but the pivot holds all three: {X,Y,Z}, with pincers {X,Z} and {Y,Z}. One of the three cells must be Z, so Z is removed only from cells that see all three (usually in the pivot’s box).',
    },
    {
      id: 'wwing', name: 'W-Wing', level: 3, drill: true, cat: 'Wing', find: findWWing,
      how: 'Two identical bivalue cells {X,Y} that don’t see each other, bridged by a strong link on X (a unit where X appears exactly twice, one end seeing each wing). They can’t both be X, so one is Y — cells seeing both wing cells lose Y.',
    },
    {
      id: 'swordfish', name: 'Swordfish', level: 3, drill: true, cat: 'Fish', find: (st) => findFish(st, 3),
      how: 'The 3×3 version of an X-Wing: three rows where a digit only appears within the same three columns (each row may use two or three of them). Those rows fill all three columns, so the digit is removed from the rest of those columns.',
    },
    {
      id: 'emptyrect', name: 'Empty Rectangle', level: 3, drill: true, cat: 'Single digit', find: findEmptyRect,
      how: 'Inside a box, a digit’s candidates all lie on one row and one column (a cross; the rest of the box is “empty”). Combined with a strong link outside the box that touches the cross’s row (or column), it removes the digit where the link’s far end lines up with the cross.',
    },
    {
      id: 'uniquerect', name: 'Unique Rectangle', level: 3, drill: true, cat: 'Uniqueness', find: findUniqueRect,
      how: 'Three corners of a rectangle spanning exactly two boxes hold the same pair {A,B}. If the fourth corner were also only {A,B}, the puzzle would have two solutions — so A and B can be removed from the fourth corner.',
    },
    {
      id: 'finnedxwing', name: 'Finned X-Wing', level: 4, drill: true, cat: 'Fish', find: findFinnedXWing,
      how: 'An X-Wing with an extra candidate (the fin) beside one corner, in the same box. Either the X-Wing is real or the fin is true — cells that are both in that corner’s cover line and in the fin’s box lose the digit.',
    },
    {
      id: 'coloring', name: 'Simple Coloring', level: 4, drill: true, cat: 'Single digit', find: findSimpleColoring,
      how: 'Follow one digit’s strong links (units where it appears exactly twice), alternating two colours. One colour is entirely true. If two cells of the same colour see each other, that colour is false; and any cell seeing both colours can’t hold the digit.',
    },
    {
      id: 'jellyfish', name: 'Jellyfish', level: 4, drill: false, // too rare to generate drills quickly
      cat: 'Fish', find: (st) => findFish(st, 4),
      how: 'The 4×4 version of an X-Wing: four rows where a digit is confined to the same four columns. Those rows fill all four columns, so the digit is removed from the rest of those columns.',
    },
    {
      id: 'xychain', name: 'XY-Chain', level: 4, drill: true, cat: 'Chain', find: findXYChain,
      how: 'A chain of bivalue cells, each seeing the next and linked by a shared digit. If the first cell isn’t Z, the chain forces the last cell to be Z — so one end is always Z, and cells seeing both ends lose Z.',
    },
  ];
  const TECH_INDEX = new Map(TECHS.map((t, i) => [t.id, i]));

  function normalize(ins, t) {
    return Object.assign({ elims: [], cells: [], keyCands: [], pivot: [], houses: [], lines: [], digit: null, hintBiv: false }, ins, {
      tech: t.id, name: t.name, level: t.level,
    });
  }

  /** Easiest logical step from techniques [from, to). `st` = {values, cands}. */
  function nextStep(st, from = 0, to = TECHS.length) {
    for (let i = from; i < to; i++) {
      const found = TECHS[i].find(st, true);
      if (found.length) return normalize(found[0], TECHS[i]);
    }
    return null;
  }

  /** Solve with logic only; reports the techniques it needed. */
  function grade(puzzle) {
    const st = newState(puzzle);
    const used = new Map();
    let maxLevel = 0;
    for (;;) {
      if (isSolved(st)) return { solved: true, maxLevel, used: [...used.keys()] };
      const ins = nextStep(st);
      if (!ins) return { solved: false, maxLevel, used: [...used.keys()] };
      used.set(ins.tech, (used.get(ins.tech) || 0) + 1);
      maxLevel = Math.max(maxLevel, ins.level);
      applyStep(st, ins);
    }
  }

  // ---------- drill generation ----------
  const elimSig = (ins) => ins.elims.map(([c, d]) => c * 10 + d).sort((a, b) => a - b).join(',');
  const elimsValid = (ins, solution) => ins.elims.every(([c, d]) => solution[c] !== d) && (!ins.place || solution[ins.place[0]] === ins.place[1]);

  function buildDrill(techId) {
    const ti = TECH_INDEX.get(techId);
    const solution = randomSolution();
    const puzzle = makePuzzle(solution);
    const st = newState(puzzle);
    for (let step = 0; step < 400; step++) {
      // apply everything easier than the target until nothing easier is left
      let easy;
      while ((easy = nextStep(st, 0, ti))) {
        if (!elimsValid(easy, solution)) { console.warn('engine: invalid step', easy.tech); return null; }
        applyStep(st, easy);
      }
      if (isSolved(st)) return null;
      const found = TECHS[ti].find(st, false).map((i) => normalize(i, TECHS[ti]));
      if (found.length) {
        if (!found.every((ins) => elimsValid(ins, solution))) { console.warn('engine: invalid elimination from', techId); return null; }
        // one representative per distinct set of eliminations (smallest pattern wins)
        const groups = new Map();
        for (const ins of found) {
          const s = elimSig(ins);
          if (!groups.has(s) || groups.get(s).cells.length > ins.cells.length) groups.set(s, ins);
        }
        const instances = [...groups.values()].slice(0, 6);
        const answer = new Map();
        for (const ins of instances) for (const [c, d] of ins.elims) answer.set(c * 10 + d, [c, d]);
        return {
          tech: techId, puzzle, solution,
          values: st.values.slice(), cands: Array.from(st.cands),
          instances, answer: [...answer.values()], unique: instances.length === 1,
        };
      }
      // target not available: advance with something harder, then look again
      const harder = nextStep(st, ti + 1);
      if (!harder) return null;
      if (!elimsValid(harder, solution)) { console.warn('engine: invalid step', harder.tech); return null; }
      applyStep(st, harder);
    }
    return null;
  }

  // ---------- game generation ----------
  const DIFFICULTIES = [
    { id: 'easy', name: 'Easy', levels: [0], clues: 38 },
    { id: 'medium', name: 'Medium', levels: [1], clues: 32 },
    { id: 'hard', name: 'Hard', levels: [2], clues: 28 },
    { id: 'expert', name: 'Expert', levels: [3, 4], clues: 0 },
  ];

  function buildGame(diffId) {
    const diff = DIFFICULTIES.find((d) => d.id === diffId);
    const solution = randomSolution();
    const puzzle = makePuzzle(solution);
    let g = grade(puzzle);
    if (!g.solved || !diff.levels.includes(g.maxLevel)) return null;
    // add clues back (keeps the same difficulty band) so easier games feel less sparse
    for (const c of shuffle([...Array(81).keys()])) {
      if (puzzle.filter(Boolean).length >= diff.clues) break;
      if (puzzle[c]) continue;
      puzzle[c] = solution[c];
      const g2 = grade(puzzle);
      if (g2.solved && diff.levels.includes(g2.maxLevel)) g = g2;
      else puzzle[c] = 0;
    }
    return { kind: 'game', difficulty: diffId, puzzle, solution, techniques: g.used };
  }

  // ---------- incremental generation (keeps the UI responsive) ----------
  const PREFER_UNIQUE_MS = 2500;
  const createGenCtx = (kind, id) => ({ kind, id, scanned: 0, best: null, t0: now() });
  function genStep(ctx, sliceMs) {
    const end = now() + sliceMs;
    const finish = (d) => Object.assign(d, { scanned: ctx.scanned, ms: Math.round(now() - ctx.t0) });
    while (now() < end) {
      ctx.scanned++;
      if (ctx.kind === 'game') {
        const g = buildGame(ctx.id);
        if (g) return finish(g);
        continue;
      }
      const d = buildDrill(ctx.id);
      if (!d) continue;
      if (d.unique) return finish(d);
      if (!ctx.best) ctx.best = d;
    }
    if (ctx.best && now() - ctx.t0 > PREFER_UNIQUE_MS) return finish(ctx.best);
    return null;
  }

  return {
    TECHS: TECHS.map(({ find, ...t }) => t), LEVELS, DIFFICULTIES,
    ROW, COL, BOX, PEERS, UNITS, ALL, PC, DIGITS, bit, cn, dg,
    createGenCtx, genStep, buildDrill, buildGame, grade, nextStep, newState,
  };
}

if (typeof window !== 'undefined') window.SudokuEngine = SudokuEngineFactory();
if (typeof module !== 'undefined') module.exports = SudokuEngineFactory;
