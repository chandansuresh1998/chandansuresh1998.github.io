// "Validate this engineer" — a self-test terminal plus a canvas
// link-training view. The terminal script drives the lanes: each [PASS]
// trains a lane up, the [WARN] lane flickers until coffee is refilled.
(() => {
  const dlg = document.getElementById("diag");
  const opener = document.getElementById("diagOpen");
  if (!dlg || !opener) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);
  const logEl = $("diagLog"), canvas = $("diagCanvas"), wrap = $("diagWrap"), flow = $("diagFlow");
  const refillBtn = $("diagRefill"), statusEl = $("diagStatus"), countEl = $("diagCount");
  const led = $("diagLed"), live = $("diagLive"), legendEl = $("diagLegend");
  const ctx = canvas.getContext("2d");

  // ---- Script ----
  const LANES = ["Debugging", "Root-cause", "Communication", "Automation", "Coffee", "Ready"];
  const COFFEE = 4;
  const LEADER_TO = 33; // label + dots always end at the same column
  const SCRIPT = [
    { kind: "cmd", text: "> Running self-test on chandan-suresh..." },
    { kind: "check", lane: 0, status: "PASS", label: "Debugging under pressure", result: "OK" },
    { kind: "check", lane: 1, status: "PASS", label: "Root-cause depth", result: 'OK (doesn\'t stop at "it works now")' },
    { kind: "check", lane: 2, status: "PASS", label: "Cross-team communication", result: "OK" },
    { kind: "check", lane: 3, status: "PASS", label: "Python/Bash automation", result: "OK" },
    { kind: "check", lane: 4, status: "WARN", label: "Coffee level", result: "23% — refill recommended" },
    { kind: "check", lane: 5, status: "PASS", label: "Ready for next challenge", result: "YES" },
    { kind: "final", text: "All checks passed. ✅" },
  ];
  const REFILL_LINE = { kind: "check", lane: COFFEE, status: "PASS", label: "Coffee level", result: "100% — refilled ☕" };
  const leader = (label) => ` ${".".repeat(Math.max(2, LEADER_TO - label.length - 1))} `;

  // ---- State ----
  const TRAIN_MS = 700;
  const lanes = LANES.map((name) => ({ name, state: "dim", t0: 0, packets: [], nextSpawn: 0, drops: 0, flash: 0 }));
  let queue = [], qi = 0, running = false, runId = 0;
  let finished = false, finaleAt = -1;
  let instant = reduceMotion;
  const sparks = [];
  const ABORT = Symbol("abort");

  const legendItems = LANES.map((name, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<b>${i + 1}</b>${name}`;
    legendEl.appendChild(li);
    return li;
  });

  // ---- Terminal ----
  const caret = document.createElement("span");
  caret.className = "diag__caret";

  const sleep = (ms, id) =>
    new Promise((res, rej) => {
      if (instant) return id === runId ? res() : rej(ABORT);
      setTimeout(() => (id === runId ? res() : rej(ABORT)), ms);
    });

  const span = (text, cls) => {
    const s = document.createElement("span");
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  };

  const scrollLog = () => {
    logEl.scrollTop = logEl.scrollHeight;
  };

  const type = async (el, text, delay, id) => {
    if (instant) {
      el.textContent += text;
      return;
    }
    for (const ch of text) {
      if (id !== runId) throw ABORT;
      el.textContent += ch;
      scrollLog();
      await sleep(delay, id);
    }
  };

  const printLine = async (item, id) => {
    const line = document.createElement("div");
    line.className = `dl dl--${item.kind}`;
    logEl.insertBefore(line, caret);
    if (item.kind !== "check") {
      const s = span("");
      line.appendChild(s);
      await type(s, item.text, item.kind === "cmd" ? 22 : 26, id);
      if (item.kind === "final") finale();
      return;
    }
    const tag = span("[ ·· ]", "dl__tag");
    const lbl = span("", "dl__lbl");
    const dots = span("", "dl__dots");
    const res = span("", "dl__res");
    line.append(tag, " ", lbl, dots, res);
    await type(lbl, item.label, 16, id);
    await type(dots, leader(item.label), 5, id);
    await sleep(260, id);
    const pass = item.status === "PASS";
    tag.textContent = `[${item.status}]`;
    line.classList.add(pass ? "is-pass" : "is-warn");
    laneResult(item.lane, pass);
    await type(res, item.result, 12, id);
    scrollLog();
    announce(`${pass ? "Pass" : "Warning"}: ${item.label}, ${item.result}`);
  };

  const pump = async () => {
    if (running) return;
    running = true;
    const id = runId;
    try {
      while (qi < queue.length) {
        await printLine(queue[qi], id);
        qi++;
        await sleep(150, id);
      }
    } catch (e) {
      if (e !== ABORT) throw e;
      return;
    }
    if (id === runId) running = false;
  };

  const announce = (msg) => {
    live.textContent = msg;
  };

  // ---- Lanes ----
  const laneResult = (i, pass) => {
    const lane = lanes[i];
    if (pass) {
      lane.state = instant ? "up" : "training";
      lane.t0 = performance.now();
      if (i === COFFEE) {
        refillBtn.hidden = true;
        lane.packets.length = 0;
      }
    } else {
      lane.state = "warn";
      lane.t0 = performance.now();
      refillBtn.hidden = false;
      refillBtn.disabled = false;
      positionRefill();
    }
    syncUi();
    if (instant) draw(performance.now());
  };

  const finale = () => {
    finished = true;
    finaleAt = performance.now();
    syncUi();
    announce("Link up. All checks passed.");
    if (instant) draw(finaleAt);
  };

  const syncUi = () => {
    const up = lanes.filter((l) => l.state === "up" || l.state === "training").length;
    const warn = lanes[COFFEE].state === "warn";
    if (finished) {
      statusEl.textContent = "Link up · All checks passed ✅";
      led.className = "diag__led is-up";
    } else {
      statusEl.textContent = `Training… ${up}/6 lanes up`;
      led.className = "diag__led is-training";
    }
    const drops = lanes[COFFEE].drops;
    countEl.textContent = `${up}/6 up${warn ? (drops ? ` · coffee ${drops} pkts dropped` : " · coffee low") : ""}`;
    lanes.forEach((l, i) => (legendItems[i].dataset.state = l.state));
  };

  // "Thank you!" floats up from where the button was, then fades away
  const thank = () => {
    const t = document.createElement("div");
    t.className = "diag__thanks";
    t.setAttribute("aria-hidden", "true");
    t.innerHTML = "<span>Thank you! ☕</span>";
    wrap.appendChild(t);
    // Start where the button was, kept inside the canvas
    const left = Math.min(refillPos.left, W - t.offsetWidth - 8);
    t.style.transform = `translate(${Math.round(left)}px, ${Math.round(refillPos.top)}px)`;
    setTimeout(() => t.remove(), reduceMotion ? 1200 : 1800);
  };

  refillBtn.addEventListener("click", () => {
    thank();
    refillBtn.disabled = true;
    refillBtn.hidden = true;
    announce("Thank you! Refilling coffee and retraining lane 5.");
    if (lanes[COFFEE].state === "warn") lanes[COFFEE].state = "refill";
    // Print the refill result right after whatever line is typing now
    queue.splice(running ? qi + 1 : queue.length, 0, REFILL_LINE);
    pump();
    $("diagReplay").focus(); // the button is gone; keep focus inside the dialog
  });

  // ---- Geometry (computed in along/across space, mapped per orientation) ----
  let W = 0, H = 0, dpr = 1, vertical = false, geo = null;
  const SLOT = [2, 4, 0, 5, 1, 3]; // order inside the cable bundle
  const OUT = [3, 0, 4, 1, 5, 2];  // port order on the Production side
  const SAMPLES = 160;

  const cubic = (out, p0, p1, p2, p3, n) => {
    for (let k = out.length ? 1 : 0; k <= n; k++) {
      const t = k / n, u = 1 - t;
      out.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
  };
  const resample = (pts, n) => {
    const d = [0];
    for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = d[d.length - 1];
    const out = new Float32Array(n * 2);
    let j = 0;
    for (let k = 0; k < n; k++) {
      const target = (k / (n - 1)) * total;
      while (j < d.length - 2 && d[j + 1] < target) j++;
      const f = (target - d[j]) / (d[j + 1] - d[j] || 1);
      out[k * 2] = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f;
      out[k * 2 + 1] = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f;
    }
    return out;
  };
  const pointAt = (pts, u, out) => {
    const f = Math.min(Math.max(u, 0), 1) * (SAMPLES - 1);
    const i = Math.min(Math.floor(f), SAMPLES - 2);
    const t = f - i;
    out[0] = pts[i * 2] + (pts[i * 2 + 2] - pts[i * 2]) * t;
    out[1] = pts[i * 2 + 1] + (pts[i * 2 + 3] - pts[i * 2 + 1]) * t;
    return out;
  };

  const layout = () => {
    const r = wrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    W = r.width;
    H = r.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    vertical = W < 520;
    flow.classList.toggle("is-vertical", vertical);

    const n = LANES.length;
    const [A0, A1, C0, C1] = vertical ? [62, H - 84, 34, W - 34] : [150, W - 162, 62, H - 34];
    const map = vertical ? (a, c) => [c, a] : (a, c) => [a, c];
    const len = A1 - A0;
    const b0 = A0 + len * 0.34, b1 = A0 + len * 0.66;
    const mid = (C0 + C1) / 2, gap = vertical ? 7 : 8;
    const step = (C1 - C0) / (n - 1);

    geo = { A0, A1, b0, b1, map, lanes: [] };
    for (let i = 0; i < n; i++) {
      const cL = C0 + i * step, cB = mid + (SLOT[i] - (n - 1) / 2) * gap, cR = C0 + OUT[i] * step;
      const pts = [];
      cubic(pts, [A0, cL], [A0 + (b0 - A0) * 0.55, cL], [b0 - (b0 - A0) * 0.45, cB], [b0, cB], 50);
      cubic(pts, [b0, cB], [b0 + 1, cB], [b1 - 1, cB], [b1, cB], 20);
      cubic(pts, [b1, cB], [b1 + (A1 - b1) * 0.45, cB], [A1 - (A1 - b1) * 0.55, cR], [A1, cR], 50);
      geo.lanes.push({
        pts: resample(pts.map(([a, c]) => map(a, c)), SAMPLES),
        start: map(A0, cL),
        end: map(A1, cR),
      });
    }
    const half = (n / 2) * gap + 8;
    const [bx0, by0] = map(b0 - 10, mid - half);
    const [bx1, by1] = map(b1 + 10, mid + half);
    geo.bundle = { x: Math.min(bx0, bx1), y: Math.min(by0, by1), w: Math.abs(bx1 - bx0), h: Math.abs(by1 - by0) };
    geo.colLab = vertical ? [W / 2, 18] : [A0 - 70, 24];
    geo.colFab = vertical ? [W / 2, 0] : [(b0 + b1) / 2, 24];
    geo.colProd = vertical ? [W / 2, H - 10] : [A1 + 60, 24];

    positionRefill();
    if (!loopOn) draw(performance.now());
  };

  let refillPos = { left: 0, top: 0 };
  const positionRefill = () => {
    if (!geo || refillBtn.hidden) return;
    const [x, y] = geo.lanes[COFFEE].end;
    const bw = refillBtn.offsetWidth, bh = refillBtn.offsetHeight;
    let left, top;
    if (vertical) {
      left = Math.min(Math.max(x - bw / 2, 6), W - bw - 6);
      top = y + 30; // below the port number
    } else {
      left = x + 40; // just past the P# label
      top = y - bh / 2;
    }
    refillBtn.classList.toggle("is-vertical", vertical); // flips which side the "Click here" hint sits on
    refillPos = { left, top };
    refillBtn.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  };

  // ---- Drawing ----
  const ACC = "61, 255, 138", AMB = "255, 184, 77", RED = "255, 77, 94";
  const tmp = [0, 0], tmp2 = [0, 0];
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  const stroke = (pts, from, to) => {
    const i0 = Math.max(0, Math.floor(from * (SAMPLES - 1)));
    const i1 = Math.min(SAMPLES - 1, Math.ceil(to * (SAMPLES - 1)));
    if (i1 <= i0) return;
    ctx.beginPath();
    ctx.moveTo(pts[i0 * 2], pts[i0 * 2 + 1]);
    for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
    ctx.stroke();
  };

  const flicker = (now) => {
    const v = (Math.sin(now * 0.031) + Math.sin(now * 0.017 + 1.3) + Math.sin(now * 0.093 + 0.4)) / 3;
    return Math.random() < 0.04 ? 0.05 : 0.5 + v * 0.5;
  };

  const pulseAt = (now) => {
    if (finaleAt < 0 || instant) return 0;
    const t = now - finaleAt;
    if (t < 1950) return 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 650);
    return 0.12 + 0.12 * Math.sin((t - 1950) / 650);
  };

  const draw = (now) => {
    if (!geo) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const pulse = pulseAt(now);

    // Faint grid
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0.5; x < W; x += 28) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0.5; y < H; y += 28) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    // Column labels
    ctx.font = "500 10.5px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillStyle = "rgba(139,143,152,0.9)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("LAB", geo.colLab[0], geo.colLab[1]);
    ctx.fillText("PRODUCTION", geo.colProd[0], geo.colProd[1]);
    const b = geo.bundle;
    if (vertical) {
      ctx.save();
      ctx.translate(b.x + b.w + 14, b.y + b.h / 2);
      ctx.rotate(Math.PI / 2);
      ctx.fillText("VALIDATION FABRIC", 0, 0);
      ctx.restore();
    } else {
      ctx.fillText("VALIDATION FABRIC", geo.colFab[0], geo.colFab[1]);
    }

    // Cable cartridge housing
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    ctx.strokeStyle = finished ? `rgba(${ACC}, ${0.35 + pulse * 0.4})` : "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    roundRect(b.x, b.y, b.w, b.h, 8);
    ctx.fill();
    ctx.stroke();
    // housing ribs
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    if (vertical) for (let y = b.y + 10; y < b.y + b.h - 4; y += 10) { ctx.moveTo(b.x + 3, y); ctx.lineTo(b.x + 7, y); ctx.moveTo(b.x + b.w - 7, y); ctx.lineTo(b.x + b.w - 3, y); }
    else for (let x = b.x + 10; x < b.x + b.w - 4; x += 10) { ctx.moveTo(x, b.y + 3); ctx.lineTo(x, b.y + 7); ctx.moveTo(x, b.y + b.h - 7); ctx.lineTo(x, b.y + b.h - 3); }
    ctx.stroke();

    // Lane traces
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    geo.lanes.forEach((g, i) => {
      const lane = lanes[i];
      ctx.shadowBlur = 0;
      ctx.setLineDash([]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      stroke(g.pts, 0, 1);

      if (lane.state === "training" || lane.state === "refill") {
        const s = lane.state === "refill" ? 0 : easeOut(Math.min((now - lane.t0) / TRAIN_MS, 1));
        if (lane.state === "refill") {
          ctx.strokeStyle = `rgba(${AMB}, ${0.3 + 0.3 * Math.sin(now / 90)})`;
          stroke(g.pts, 0, 1);
        }
        ctx.shadowColor = `rgba(${ACC}, 0.9)`;
        ctx.shadowBlur = 16;
        ctx.strokeStyle = `rgba(${ACC}, 0.95)`;
        ctx.lineWidth = 2.4;
        stroke(g.pts, 0, s);
        pointAt(g.pts, s, tmp);
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(tmp[0], tmp[1], 3.2, 0, Math.PI * 2);
        ctx.fill();
      } else if (lane.state === "up") {
        ctx.shadowColor = `rgba(${ACC}, 0.8)`;
        ctx.shadowBlur = 10 + pulse * 18;
        ctx.strokeStyle = `rgba(${ACC}, ${0.5 + pulse * 0.45})`;
        ctx.lineWidth = 2 + pulse * 1.6;
        stroke(g.pts, 0, 1);
      } else if (lane.state === "warn") {
        const f = instant ? 0.8 : flicker(now + i * 97);
        ctx.shadowColor = `rgba(${AMB}, 0.7)`;
        ctx.shadowBlur = 8 * f;
        ctx.strokeStyle = `rgba(${AMB}, ${0.2 + 0.55 * f})`;
        ctx.setLineDash([7, 5]);
        ctx.lineDashOffset = instant ? 0 : -now * 0.04;
        stroke(g.pts, 0, 1);
        ctx.setLineDash([]);
      }
    });
    ctx.shadowBlur = 0;

    // Packets
    if (!instant) {
      ctx.globalCompositeOperation = "lighter";
      geo.lanes.forEach((g, i) => {
        const lane = lanes[i];
        const rgb = lane.state === "warn" ? AMB : ACC;
        for (const p of lane.packets) {
          const a = p.fade;
          for (let k = 4; k >= 0; k--) {
            pointAt(g.pts, p.u - k * 0.011, tmp);
            ctx.fillStyle = `rgba(${rgb}, ${a * (1 - k / 5) * 0.75})`;
            ctx.beginPath();
            ctx.arc(tmp[0], tmp[1], 2.8 - k * 0.38, 0, Math.PI * 2);
            ctx.fill();
          }
          pointAt(g.pts, p.u, tmp);
          ctx.fillStyle = `rgba(255,255,255,${a * 0.9})`;
          ctx.beginPath();
          ctx.arc(tmp[0], tmp[1], 1.3, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      // Dropped-packet sparks
      for (const s of sparks) {
        const t = (now - s.t0) / 450;
        ctx.strokeStyle = `rgba(${RED}, ${0.8 * (1 - t)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3 + t * 9, 0, Math.PI * 2);
        ctx.stroke();
        const r = 3;
        ctx.beginPath();
        ctx.moveTo(s.x - r, s.y - r); ctx.lineTo(s.x + r, s.y + r);
        ctx.moveTo(s.x + r, s.y - r); ctx.lineTo(s.x - r, s.y + r);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    }

    // Ports + labels
    ctx.font = "500 12px 'JetBrains Mono', ui-monospace, monospace";
    geo.lanes.forEach((g, i) => {
      const lane = lanes[i];
      const on = lane.state === "up" || lane.state === "training";
      const warn = lane.state === "warn" || lane.state === "refill";
      const col = on ? `rgba(${ACC}, 1)` : warn ? `rgba(${AMB}, 1)` : "rgba(255,255,255,0.22)";
      const flash = Math.max(0, 1 - (now - lane.flash) / 300);
      for (const [pt, isEnd] of [[g.start, false], [g.end, true]]) {
        ctx.shadowColor = col;
        ctx.shadowBlur = on ? 10 + (isEnd ? flash * 14 : 0) + pulse * 10 : warn ? 6 : 0;
        ctx.fillStyle = "#0b0c0e";
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        roundRect(pt[0] - 6, pt[1] - 6, 12, 12, 3);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = col;
        roundRect(pt[0] - 2.5, pt[1] - 2.5, 5, 5, 1);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = on ? "#f4f5f6" : warn ? `rgba(${AMB}, 1)` : "rgba(139,143,152,0.85)";
      if (vertical) {
        ctx.textAlign = "center";
        ctx.fillText(String(i + 1), g.start[0], g.start[1] - 18);
        ctx.fillText(String(i + 1), g.end[0], g.end[1] + 18);
      } else {
        ctx.textAlign = "right";
        ctx.fillText(LANES[i], g.start[0] - 16, g.start[1]);
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(139,143,152,0.85)";
        ctx.fillText(`P${i + 1}`, g.end[0] + 14, g.end[1]);
      }
    });
  };

  const roundRect = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  // ---- Simulation ----
  const update = (now, dt) => {
    let changed = false;
    lanes.forEach((lane, i) => {
      if (lane.state === "training" && now - lane.t0 >= TRAIN_MS) {
        lane.state = "up";
        lane.flash = now;
        changed = true;
        if (finished && i === COFFEE) finaleAt = now; // refilled after the finale: pulse all six together

      }
      const flowing = lane.state === "up" || lane.state === "warn";
      if (flowing && now >= lane.nextSpawn) {
        const warn = lane.state === "warn";
        lane.packets.push({
          u: 0,
          v: (warn ? 0.32 : 0.42) + Math.random() * 0.12,
          drop: warn ? 0.38 + Math.random() * 0.24 : 2,
          fade: 1,
          dropped: false,
        });
        lane.nextSpawn = now + (warn ? 380 : 230) + Math.random() * 180;
      }
      const g = geo && geo.lanes[i];
      for (let k = lane.packets.length - 1; k >= 0; k--) {
        const p = lane.packets[k];
        if (p.dropped) {
          p.fade -= dt * 6;
          if (p.fade <= 0) lane.packets.splice(k, 1);
          continue;
        }
        p.u += p.v * dt;
        if (p.u >= p.drop) {
          p.dropped = true;
          lane.drops++;
          changed = true;
          if (g) {
            pointAt(g.pts, p.u, tmp2);
            sparks.push({ x: tmp2[0], y: tmp2[1], t0: now });
          }
        } else if (p.u >= 1) {
          lane.packets.splice(k, 1);
          lane.flash = now;
        }
      }
      if (!flowing && lane.packets.length) lane.packets.length = 0;
    });
    for (let k = sparks.length - 1; k >= 0; k--) if (now - sparks[k].t0 > 450) sparks.splice(k, 1);
    if (changed) syncUi();
  };

  let loopOn = false, raf = null, last = 0;
  const frame = (now) => {
    raf = null;
    const dt = Math.min(now - last, 50) / 1000;
    last = now;
    update(now, dt);
    draw(now);
    if (loopOn) raf = requestAnimationFrame(frame);
  };
  const startLoop = () => {
    if (instant || loopOn) return;
    loopOn = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };
  const stopLoop = () => {
    loopOn = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  };

  // ---- Run / reset ----
  const reset = () => {
    runId++;
    running = false;
    queue = SCRIPT.slice();
    qi = 0;
    finished = false;
    finaleAt = -1;
    sparks.length = 0;
    lanes.forEach((l) => {
      l.state = "dim";
      l.packets.length = 0;
      l.drops = 0;
      l.flash = 0;
    });
    refillBtn.hidden = true;
    logEl.textContent = "";
    logEl.appendChild(caret);
    syncUi();
  };

  const run = () => {
    reset();
    startLoop();
    pump();
    if (instant) draw(performance.now());
  };

  // ---- Open / close ----
  let closeTimer = null;
  const open = () => {
    clearTimeout(closeTimer);
    document.documentElement.classList.add("diag-open");
    dlg.showModal();
    layout();
    requestAnimationFrame(() => dlg.classList.add("is-open"));
    if (reduceMotion) dlg.classList.add("is-open");
    run();
  };
  const close = () => {
    if (!dlg.open) return;
    dlg.classList.remove("is-open");
    runId++;
    stopLoop();
    closeTimer = setTimeout(
      () => {
        dlg.close();
        document.documentElement.classList.remove("diag-open");
        opener.focus();
      },
      reduceMotion ? 0 : 280
    );
  };

  opener.addEventListener("click", open);
  $("diagClose").addEventListener("click", close);
  $("diagReplay").addEventListener("click", run);
  dlg.addEventListener("cancel", (e) => {
    e.preventDefault(); // animate out instead of snapping shut
    close();
  });
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) close(); // backdrop
  });

  new ResizeObserver(() => {
    if (dlg.open) layout();
  }).observe(wrap);
})();
