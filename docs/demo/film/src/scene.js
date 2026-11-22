/* EXITMIND in 60 seconds. Every picture is real app footage (assets/footage/*.mp4), seeked from t.
 * Take-time maps per beat are pure functions of t and the timeline's event times (s.at). */
(function () {
  const box = (e, x0, y0, x1, y1) => { e.style.left = x0 + 'px'; e.style.top = y0 + 'px'; e.style.width = (x1 - x0) + 'px'; e.style.height = (y1 - y0) + 'px'; };

  Studio.film({
    layouts: { '16:9': () => ({ lx: 120 }) },

    setup(s) {
      // highlight boxes in the lifted panels' own pixel space (measured on the footage frames used)
      box(s.$('#hiOpus'), 68, 281, 472, 340);
      [...document.querySelectorAll('#hiHaiku .hh')].forEach((e, i) => { const y = [273, 368, 462, 539, 615][i]; box(e, 326, y - 13, 456, y + 13); });
      box(s.$('#hiRow'), 56, 387, 486, 483);
      box(s.$('#hiK1'), 12, 156, 155, 237); box(s.$('#hiK2'), 153, 156, 287, 237); box(s.$('#hiK3'), 285, 156, 417, 237);
      box(s.$('#hiFail'), 152, 166, 288, 266);
    },

    draw(t, s) {
      const cl = s.clamp, L = s.L;
      const H = s.beat('HOOK'), A = s.beat('AGENT'), Br = s.beat('BRAIN'), O = s.beat('OPTIMISE'), Lv = s.beat('LIVE'), C = s.beat('CLOSE');
      const win = (a, b, fi, fo) => cl((t - a) / (fi || 0.2)) * cl((b - t) / (fo || 0.2));
      const outBy = (tEnd, d) => cl((tEnd - t) / (d || 0.22));
      const pin = (id) => cl(s.ev(id));                                    // 0..1, no overshoot, for opacity
      const vid = (sel, vis, src, extra) => { s.set(sel, Object.assign({ o: vis }, extra || {})); if (vis > 0.002) s.video(sel, Math.max(0, src)); };
      // left-column text: slides up 36 px into place, fades with its event, leaves at `until`
      const txt = (sel, id, y, until, x) => { const p = s.ev(id); s.set(sel, { x: x === undefined ? L.lx : x, y: y + (1 - p) * 36, ax: 0, ay: 0, o: cl(p * 1.6) * outBy(until) }); };

      // ---------- 1 HOOK: the live Haiku run, replayed 16x ----------
      vid('#vFete', pin('hook-foot') * outBy(A.start + 0.35, 0.35), 0.4 + t, { x: 960, y: 540, s: 1 + 0.01 * t });
      s.set('#scrimL', { o: cl(s.ev('hl-doors')) * outBy(C.start, 0.4) });
      txt('#hl1', 'hl-doors', 380, A.start);
      txt('#hl2', 'hl-people', 490, A.start);

      // ---------- 2 AGENT: one sentence -> Opus asks -> the crowd is built ----------
      const tOpus = s.at('opus-cut'), tAsm = s.at('asm-cut');
      const scen = t < tOpus ? 2.9 + (t - A.start) : t < tAsm ? 19.75 + (t - tOpus) : Math.min(47, 36.0 + (t - tAsm) * 2.0);
      vid('#vScenBg', win(A.start, Br.start + 0.3, 0.3, 0.3), scen, { x: 960, y: 540, s: 1.06 });
      const ca = s.ev('agent-in');
      s.set('#card', { x: 1400 + (1 - ca) * 620, y: 540, s: 0.94, o: cl(ca * 2) * outBy(Br.start, 0.25) });
      if (t >= A.start - 0.1 && t < Br.start + 0.1) s.video('#vScenCrop', scen);
      const po = pin('opus-box') * outBy(tAsm, 0.2);
      s.set('#hiOpus', { o: po, style: { 'box-shadow': '0 0 0 9999px rgba(14,16,19,' + (0.42 * po).toFixed(3) + ')' } });
      txt('#k1', 'k-one', 170, Br.start);
      txt('#k2', 'k-opus', 370, Br.start);
      ['#c1', '#c2', '#c3', '#c4'].forEach((sel, i) => { const p = s.ev(['chip-ages', 'chip-roles', 'chip-fam', 'chip-mob'][i]); s.set(sel, { x: L.lx + (1 - p) * -40, y: 620 + i * 84, ax: 0, ay: 0, o: cl(p * 2) * outBy(Br.start) }); });

      // ---------- 3 BRAIN: live Haiku decisions per person, then the flow ----------
      const tFlow = s.at('flow-cut');
      vid('#vFete2', win(Br.start, tFlow + 0.25, 0.25, 0.25), 2.0 + (t - Br.start), { x: 960, y: 540, s: 1.02 + 0.008 * (t - Br.start) });
      const cb = s.ev('brain-in');
      s.set('#card2', { x: 1400 + (1 - cb) * 620, y: 540, s: 0.94, o: cl(cb * 2) * outBy(tFlow, 0.25) });
      if (t >= Br.start - 0.1 && t < tFlow + 0.1) s.video('#vFeed', 58.0);
      const hh = pin('hi-haiku') * outBy(s.at('hi-row'), 0.25);
      document.querySelectorAll('#hiHaiku .hh').forEach((e, i) => s.set(e, { o: cl((t - s.at('hi-haiku') - i * 0.07) / 0.12) * hh }));
      const pr = pin('hi-row') * outBy(tFlow, 0.2);
      s.set('#hiRow', { o: pr, style: { 'box-shadow': '0 0 0 9999px rgba(14,16,19,' + (0.45 * pr).toFixed(3) + ')' } });
      txt('#k3', 'k-haiku', 170, tFlow);
      txt('#k5', 'k-row', 560, tFlow);
      vid('#vFlow', win(tFlow, O.start + 0.3, 0.15, 0.3) + 0.2 * win(C.start, C.end + 1, 0.4, 0.4), t < C.start ? 14.2 + (t - tFlow) : 15.5 + (t - C.start) * 0.8, { x: 960, y: 540, s: 1.0 });
      const pc = s.evLin('count-dec');
      s.set('#cnt', { x: L.lx, y: 300 + (1 - cl(s.ev('count-dec'))) * 36, ax: 0, ay: 0, o: cl(pc * 3) * outBy(O.start), text: Math.round(8004 * (1 - Math.pow(1 - pc, 3))).toLocaleString('en-US') });
      txt('#k6', 'k-run', 470, O.start);

      // ---------- 4 OPTIMISE: worst fire -> one door -> redesigns -> capacity ----------
      const tDiff = s.at('diff-cut'), tFrom = s.at('cap-from');
      const opt = t < tDiff ? 0.6 + (t - O.start) * 0.55 : Math.min(13.2, 7.45 + (t - tDiff));
      const ow = pin('opt-in') * outBy(Lv.start, 0.25);
      s.set('#optWrap', { o: ow });
      if (ow > 0.002) s.video('#vOpt', opt);
      const z = 1.22 + 0.06 * cl((t - O.start) / 13), cx = 860, cy = 628;
      const tf = 'translate(' + (960 - cx * z).toFixed(1) + 'px,' + (540 - cy * z).toFixed(1) + 'px) scale(' + z.toFixed(4) + ')';
      s.$('#optWrap').style.transform = tf;
      const rp = s.ev('ring-h1');
      s.set('#ringH1', { x: 1384, y: 704, s: 0.4 + 0.6 * rp, o: cl(rp * 2) * outBy(tDiff, 0.25) });
      txt('#k7', 'k-attack', 170, Lv.start);
      txt('#k8', 'k-worst', 330, tDiff);
      txt('#k9', 'k-door', 470, tDiff);
      ['#c5', '#c6', '#c7'].forEach((sel, i) => { const p = s.ev(['chip-49', 'chip-392', 'chip-opus'][i]); s.set(sel, { x: L.lx + (1 - p) * -40, y: 330 + i * 84, ax: 0, ay: 0, o: cl(p * 2) * outBy(Lv.start) }); });
      const pf = s.ev('cap-from'), pt = s.ev('cap-to');
      s.set('#capLbl', { x: L.lx, y: 610 + (1 - pf) * 20, ax: 0, ay: 0, o: cl(pf * 2) * outBy(Lv.start) });
      s.set('#capFrom', { x: L.lx, y: 660 + (1 - pf) * 36, ax: 0, ay: 0, o: cl(pf * 2) * outBy(Lv.start) });
      s.set('#capArrow', { x: L.lx + 370 + (1 - pt) * -30, y: 700, ax: 0, ay: 0, o: cl(pt * 2) * outBy(Lv.start) });
      s.set('#capTo', { x: L.lx + 470, y: 660 + (1 - pt) * 36, ax: 0, ay: 0, o: cl(pt * 2) * outBy(Lv.start) });

      // ---------- 5 LIVE: three keys, approve, then a bad plan is blocked ----------
      const tA = s.at('approve-click'), tB = s.at('bad-cut');
      const liveSrc = t < tA ? 12.4 + (t - Lv.start) * ((17.75 - 12.4) / Math.max(0.5, tA - Lv.start)) : t < tB ? 17.75 + (t - tA) : 25.6;
      vid('#vLive', win(Lv.start, C.start + 0.3, 0.25, 0.3), t < tB ? liveSrc : 25.6 + (t - tB) * 0.6, { x: 960, y: 540, s: 1.05 });
      const cv = s.ev('live-in');
      s.set('#card3', { x: 1420 + (1 - cv) * 620, y: 560, s: 1.1, o: cl(cv * 2) * outBy(C.start, 0.3) });
      if (t >= Lv.start - 0.1 && t < C.start + 0.1) s.video('#vLiveCrop', liveSrc);
      ['#hiK1', '#hiK2', '#hiK3'].forEach((sel, i) => s.set(sel, { o: pin(['key-ai', 'key-sim', 'key-human'][i]) * outBy(tB, 0.15) }));
      txt('#k10', 'k-keys', 170, C.start);
      ['#kl1', '#kl2', '#kl3'].forEach((sel, i) => { const p = s.ev(['key-ai', 'key-sim', 'key-human'][i]); s.set(sel, { x: L.lx + (1 - p) * -40, y: 400 + i * 96, ax: 0, ay: 0, o: cl(p * 2) * outBy(C.start) * (t >= tB ? 0.45 : 1) }); });
      const pfl = pin('hi-fail') * outBy(C.start, 0.25);
      s.set('#hiFail', { o: pfl, style: { 'box-shadow': '0 0 0 9999px rgba(14,16,19,' + (0.4 * pfl).toFixed(3) + ')' } });
      const ps = s.ev('stamp');
      s.set('#stamp', { x: 520, y: 820 + (1 - ps) * -60, r: -5, o: cl(ps * 2.5) * outBy(C.start, 0.25) });

      // ---------- 6 CLOSE ----------
      const pti = s.ev('close-in'), ptg = s.ev('close-tag'), ptm = s.ev('close-team');
      s.set('#title', { x: 960, y: 420 + (1 - pti) * 40, o: cl(pti * 1.6) });
      s.set('#tag', { x: 960, y: 585 + (1 - ptg) * 30, o: cl(ptg * 1.8) });
      s.set('#team', { x: 960, y: 760 + (1 - ptm) * 20, o: cl(ptm * 1.8) });
    },
  });
})();
