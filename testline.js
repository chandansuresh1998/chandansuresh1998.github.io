// "What I do" — interactive rack validation line + failure walkthrough.
// One rAF clock drives everything: state.t is elapsed ms inside the current
// phase, and every visual (log, checklist, counters, rack) is derived from it,
// so Pause simply stops the clock.
(() => {
  const root = document.getElementById("testLine");
  if (!root) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);

  const TRAYS = 18;
  const fmtMin = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

  const STATIONS = [
    {
      name: "Rack power-on", short: "Power-on", tag: "power-on",
      lede: "Bring the rack up safely",
      desc: "Before a single tray boots, I make sure the rack itself is healthy: power shelves come up clean, the liquid-cooling loop holds pressure, and every management controller answers. A rack that isn't safe to power isn't worth testing.",
      checks: ["Power shelves and PSUs come up within spec", "Coolant loop holds pressure with no leaks", "Every BMC responds over Redfish / IPMI"],
      pass: "The rack is safe to run and fully manageable remotely.",
      catches: "A weak PSU, a weeping coolant fitting, a BMC that never comes up.",
      log: ["$ rack power-on --all-shelves", "power shelves nominal · bus voltage in range", "coolant loop: pressure hold · no leak detected", "redfish: 18/18 compute + 9/9 switch BMCs responding"],
      status: (p) => `Power-on · ${Math.round(TRAYS * p)}/${TRAYS} trays · coolant ${p > 0.55 ? "OK" : "pressurizing"} · BMC ${p > 0.85 ? "up" : "booting"}`,
    },
    {
      name: "PXE boot", short: "PXE boot", tag: "pxe-boot",
      lede: "One known image on every tray",
      desc: "Every compute tray boots over the network into the same test OS. Nothing gets installed by hand, so when a test fails later I know it's the hardware talking, not a one-off setup.",
      checks: ["Each tray gets a lease and finds the boot server", "Test image downloads and its checksum matches", "Every tray reports back with the expected OS version"],
      pass: "All 18 trays are running the same verified image.",
      catches: "A wrong boot order, a dead management port, a tray that never checks in.",
      log: ["$ pxe watch --rack 01", "dhcp: 18 leases issued", "image pulled · sha256 verified", "18/18 trays booted test OS · versions match"],
      status: (p) => `PXE · ${Math.round(TRAYS * p)}/${TRAYS} booted · image ${p > 0.9 ? "verified" : "loading"}`,
    },
    {
      name: "Firmware", short: "Firmware", tag: "firmware",
      lede: "Flash it, verify it, recover it",
      desc: "I install and verify the full firmware set (BMC, BIOS, CPLD, GPU and NVSwitch) against a golden manifest. When a flash fails, the tray goes through a recovery path instead of the scrap pile.",
      checks: ["Every component flashed to the manifest version", "Versions read back and match, tray by tray", "Failed flashes recover cleanly and re-verify"],
      pass: "Every controller runs exactly the intended firmware set.",
      catches: "Mixed versions, half-finished flashes, a bricked controller.",
      log: ["$ fw apply --manifest golden.json", "queued 126 images · BMC · BIOS · CPLD · GPU · NVSwitch", "tray 07 · BMC flash timeout → recovery path → OK", "audit: 126/126 versions match manifest"],
      status: (p) => `Firmware · ${Math.round(126 * p)}/126 images match`,
    },
    {
      name: "Pretest", short: "Pretest", tag: "pretest",
      lede: "A clean baseline before stress",
      desc: "A fast health and inventory check at idle. I confirm the hardware is what the build says it is, every link trained the way it should, and the sensors are telling the truth, so run-in starts from a clean baseline.",
      checks: ["CPU, GPU, DIMM, NVMe and NIC inventory matches the build", "Every PCIe link trains at expected width and speed", "Sensors read back in range through the BMC"],
      pass: "The hardware is correct and every link is healthy at idle.",
      catches: "A missing DIMM, a down-trained link, a sensor reporting nonsense.",
      log: ["$ pretest --rack 01", "inventory: matches build sheet on 18/18 trays", "pcie: all links at expected width / speed", "sensors: 1,152 read · all in range"],
      status: (p) => `Pretest · 0 mismatches · ${Math.round(1152 * p).toLocaleString("en-US")} sensors read`,
    },
    {
      name: "Run-in", short: "Run-in", tag: "run-in", dur: 5600,
      lede: "Make weak parts fail here, not in the field",
      desc: "Hours of full load across GPUs, CPUs, memory and storage while I watch thermals, power and error counters through telemetry. Pretest proves a part works; run-in proves it keeps working when it's hot and busy.",
      checks: ["Sustained stress on GPU, CPU, memory and NVMe", "Thermal and power telemetry stays inside limits", "PCIe, ECC and NVMe error counters stay flat"],
      pass: "A full run-in with zero new errors.",
      catches: "Parts that pass cold and fail hot: marginal links, flaky memory, PSUs that sag under load.",
      log: ["$ stress --gpu --cpu --mem --nvme --hours 4", "telemetry: inlet, coolant and GPU temps every 30 s", "watching PCIe AER · memory ECC · NVMe counters", "4h 12m elapsed · 0 new errors"],
      failLog: ["tray 04 · PCIe correctable errors rising", "tray 04 · slot 2 retrained x16 → x8"],
      status: (p, errs) => `Run-in · ${fmtMin(Math.round(252 * p))} · ${errs} error${errs === 1 ? "" : "s"}`,
    },
    {
      name: "Fabric", short: "Fabric", tag: "fabric",
      lede: "NVLink and the network, end to end",
      desc: "First every GPU has to join the NVLink domain through the switch trays at full width. Then I validate the uplinks to the Arista and NVIDIA switches and run nettest across them.",
      checks: ["Every GPU joins the NVLink domain", "Links hold full width with no flaps", "Switch uplinks pass nettest and the cabling map"],
      pass: "The whole rack talks at full speed, on every link.",
      catches: "A mis-seated cable cartridge, a bad switch port, configuration drift.",
      log: ["$ fabric check --nvlink --uplinks", "nvlink: switch trays up · 72/72 GPUs in domain", "links: full width · 0 flaps", "nettest: uplinks within spec · cabling map verified"],
      status: (p) => `Fabric · ${Math.round(72 * p)}/72 GPUs joined · 0 link flaps`,
    },
    {
      name: "Final test", short: "Final test", tag: "final-test",
      lede: "Ship it the way it was tested",
      desc: "After all that stress, I re-audit firmware and inventory, clear the logs and lock the configuration. Nothing should have changed, and final test is where I prove it.",
      checks: ["Firmware and inventory unchanged since pretest", "Event logs reviewed, archived and cleared", "Configuration locked for shipment"],
      pass: "The rack leaves in exactly the state it was validated in.",
      catches: "Anything that drifted during the earlier stations.",
      log: ["$ final --audit --lock", "re-audit: firmware + inventory unchanged", "logs: SEL archived · cleared", "config: locked"],
      status: (p) => `Final · audit ${Math.round(100 * p)}% · config ${p > 0.9 ? "locked" : "checking"} · logs clean`,
    },
    {
      name: "Ship", short: "Ship", tag: "ship",
      lede: "Production-ready handoff",
      desc: "The rack goes out the door with its full test record attached, ready for a hyperscale data center floor.",
      checks: ["Test record attached to the rack serial", "Handoff checklist complete", "Ready for deployment"],
      pass: "Another rack ready for production.",
      catches: "Nothing, by design. Every problem should already be behind it.",
      log: ["$ handoff --rack 01", "test record attached to rack serial", "handoff checklist complete"],
      status: (p) => `Handoff · record attached · ${p > 0.9 ? "ready for deployment ✓" : "packing"}`,
    },
  ];
  const N = STATIONS.length;
  const RUNIN = 4;
  const FIRMWARE = 2;
  const DEFAULT_DUR = 3600;
  const FAIL_AT = 0.8;     // fraction of run-in where the failing tray trips
  const PASS_HOLD = 650;
  const FAIL_HOLD = 1500;
  const REPAIR = 4200;
  const REPAIR_LOG = [
    { at: 250, text: "debug bench · tray 04 isolated", kind: "cmd" },
    { at: 1300, text: "swap test: fault follows the riser, not the slot", kind: "info" },
    { at: 2400, text: "riser replaced · corrective action filed", kind: "info" },
    { at: 3400, text: "tray 04 → re-entering at Firmware", kind: "ok" },
  ];
  const durOf = (i) => STATIONS[i].dur || DEFAULT_DUR;

  // ---- Rack layout: power shelves, compute trays, switch trays ----
  const LAYOUT = [
    ...Array(2).fill("psu"),
    ...Array(10).fill("c"),
    ...Array(9).fill("sw"),
    ...Array(8).fill("c"),
    ...Array(2).fill("psu"),
  ];
  const PSU_ROWS = LAYOUT.map((t, i) => (t === "psu" ? i : -1)).filter((i) => i >= 0);
  const BODY_ROWS = LAYOUT.map((t, i) => (t !== "psu" ? i : -1)).filter((i) => i >= 0);
  const FAIL_ROW = BODY_ROWS[3]; // a compute tray PXE already lit
  // Stations 1–6 each light one slice of the body; Power-on lights the shelves.
  const litUpTo = (s) => (s < 1 ? 0 : Math.round((BODY_ROWS.length * Math.min(s, 6)) / 6));

  // ---- DOM ----
  const tabsEl = $("tlTabs"), scroller = $("tlScroller"), fillEl = $("tlFill");
  const rowsEl = $("tlRows"), rackEl = $("tlRack"), benchEl = $("tlBench");
  const runBtn = $("tlRun"), pauseBtn = $("tlPause"), failToggle = $("tlFail");
  const logEl = $("tlLog"), live = $("tlLive"), panel = $("tlPanel"), details = $("tlDetails");
  const checksEl = $("tlChecks");

  const check = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const tabs = STATIONS.map((st, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tl__tab";
    b.id = `tl-tab-${i}`;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-controls", "tlPanel");
    b.innerHTML = `<span class="tl__node">${check}</span><span class="tl__idx">${String(i).padStart(2, "0")}</span><span class="tl__name">${st.short}</span><span class="tl__st"></span>`;
    b.addEventListener("click", () => select(i));
    tabsEl.appendChild(b);
    return b;
  });

  const rows = LAYOUT.map((type, i) => {
    const r = document.createElement("div");
    r.className = `ru ru--${type}`;
    // Cascade order within the slice that lights this row
    const body = BODY_ROWS.indexOf(i);
    let k = PSU_ROWS.indexOf(i);
    if (body >= 0) {
      let s = 1;
      while (litUpTo(s) <= body) s++;
      k = body - litUpTo(s - 1);
    }
    r.style.setProperty("--k", k);
    rowsEl.appendChild(r);
    return r;
  });

  // ---- State ----
  const state = {
    idx: 0, phase: "idle", t: 0,
    auto: false, playing: false, paused: false,
    failRun: false, failUsed: false, runId: 0,
    passed: Array(N).fill(false),
  };
  let visible = false, started = false, raf = null, last = null;

  const startStation = (i) => {
    state.idx = i;
    state.phase = "testing";
    state.t = 0;
    state.runId++;
    state.failRun = failToggle.checked && !state.failUsed && i === RUNIN;
    state.playing = true;
    announce();
  };

  const select = (i, { focus = false } = {}) => {
    i = Math.max(0, Math.min(N - 1, i));
    state.auto = false;
    state.paused = false;
    state.failUsed = false;
    state.passed = state.passed.map((_, k) => k < i);
    startStation(i);
    if (focus) tabs[i].focus();
    kick();
  };

  const runLine = () => {
    state.auto = true;
    state.paused = false;
    state.failUsed = false;
    state.passed.fill(false);
    startStation(0);
    kick();
  };

  const advance = () => {
    const s = state;
    if (s.phase === "testing") {
      const d = durOf(s.idx);
      if (s.failRun && s.t >= FAIL_AT * d) {
        s.phase = "fail"; s.t = 0; announce();
      } else if (s.t >= d) {
        s.passed[s.idx] = true;
        s.t = 0;
        if (s.idx === N - 1) { s.phase = "done"; s.playing = false; s.auto = false; }
        else s.phase = "pass";
        announce();
      }
    } else if (s.phase === "pass" && s.t >= PASS_HOLD) {
      if (s.auto) startStation(s.idx + 1);
      else s.playing = false;
    } else if (s.phase === "fail" && s.t >= FAIL_HOLD) {
      s.phase = "repair"; s.t = 0; announce();
    } else if (s.phase === "repair" && s.t >= REPAIR) {
      s.failUsed = true;
      for (let k = FIRMWARE; k < N; k++) s.passed[k] = false;
      s.auto = true;
      startStation(FIRMWARE);
    }
  };

  const tick = (now) => {
    raf = null;
    const dt = last == null ? 0 : Math.min(now - last, 64);
    last = now;
    if (state.playing && !state.paused && visible && !document.hidden) {
      state.t += dt;
      advance();
    }
    render();
    if (state.playing && !state.paused && visible) raf = requestAnimationFrame(tick);
    else last = null;
  };
  const kick = () => {
    if (raf == null) raf = requestAnimationFrame(tick);
  };

  // ---- Derived values ----
  const PHASE_LABEL = { idle: "Ready", testing: "Testing", pass: "Passed", fail: "Failed", repair: "In repair", done: "Shipped" };

  const stationProgress = () => {
    const { phase, t, idx } = state;
    if (phase === "testing") return Math.min(t / durOf(idx), 1);
    if (phase === "pass" || phase === "done") return 1;
    if (phase === "fail") return FAIL_AT;
    if (phase === "repair") return Math.min(t / REPAIR, 1);
    return 0;
  };

  const logLines = () => {
    const { phase, idx } = state;
    if (phase === "idle") return [];
    if (phase === "repair") return REPAIR_LOG;
    const st = STATIONS[idx];
    const d = durOf(idx);
    let lines;
    if (idx === RUNIN && state.failRun) {
      lines = [
        ...st.log.slice(0, 3).map((text, k) => ({ at: [0.04, 0.2, 0.36][k] * d, text, kind: k ? "info" : "cmd" })),
        ...st.failLog.map((text, k) => ({ at: [0.55, 0.68][k] * d, text, kind: "err" })),
      ];
    } else {
      lines = st.log.map((text, k, a) => ({ at: ((k + 0.15) / a.length) * 0.9 * d, text, kind: k ? "info" : "cmd" }));
    }
    if (phase === "pass" || phase === "done") lines.push({ at: 0, text: `✓ PASS ${st.tag}`, kind: "ok" });
    if (phase === "fail") lines.push({ at: 0, text: "✗ FAIL run-in → tray 04 to debug bench", kind: "err" });
    return lines;
  };

  const visibleLog = () => {
    const all = logLines();
    if (state.phase === "testing" || state.phase === "repair") return all.filter((l) => l.at <= state.t);
    return all;
  };

  const errorCount = () => {
    if (state.idx !== RUNIN || !state.failRun) return 0;
    return visibleLog().filter((l) => l.kind === "err" && !l.text.startsWith("✗")).length;
  };

  // ---- Render ----
  let shownIdx = -1, logKey = "", logCount = 0, rowSig = "", tabSig = [];

  const render = () => {
    const { idx, phase, passed } = state;
    const st = STATIONS[idx];
    const p = stationProgress();
    const errs = errorCount();
    const failing = phase === "fail" || phase === "repair";

    // Tabs
    tabs.forEach((tab, k) => {
      const active = k === idx;
      const stText = active
        ? { idle: "", testing: "testing", pass: "pass", done: "pass", fail: "fail", repair: "repair" }[phase]
        : passed[k] ? "pass" : "";
      const sig = `${active}|${passed[k]}|${stText}`;
      if (tabSig[k] !== sig) {
        tabSig[k] = sig;
        tab.classList.toggle("is-active", active);
        tab.classList.toggle("is-pass", passed[k]);
        tab.classList.toggle("is-fail", active && failing);
        tab.setAttribute("aria-selected", active ? "true" : "false");
        tab.tabIndex = active ? 0 : -1;
        tab.querySelector(".tl__st").textContent = stText;
      }
      if (active) tab.style.setProperty("--p", phase === "testing" ? p.toFixed(3) : 0);
    });
    fillEl.style.transform = `scaleX(${idx / (N - 1)})`;

    // Status bar
    $("tlRing").style.setProperty("--p", p.toFixed(3));
    $("tlRing").classList.toggle("is-fail", failing);
    $("tlPct").textContent = `${Math.round(p * 100)}%`;
    $("tlPhase").textContent = PHASE_LABEL[phase];
    $("tlStation").textContent = phase === "repair" ? "Debug bench" : st.name;
    runBtn.textContent = state.auto ? "Restart" : "Run the line";
    pauseBtn.disabled = !state.playing;
    pauseBtn.textContent = state.paused ? "Resume" : "Pause";

    // Live status line + counters
    const statusEl = $("tlStatus");
    let status;
    if (phase === "idle") status = "Ready · press Run the line";
    else if (phase === "repair") status = "Debug bench · tray 04 · isolating fault";
    else if (phase === "fail") status = `${st.status(p, errs)} · FAIL`;
    else status = st.status(p, errs);
    statusEl.textContent = status;
    statusEl.classList.toggle("is-fail", failing);
    $("tlC1").textContent = `${Math.round(p * 100)}%`;
    $("tlC2").textContent = `${phase === "repair" ? TRAYS - 1 : Math.round(TRAYS * p)}/${TRAYS}`;
    $("tlC3").textContent = failing ? 2 : errs;
    $("tlC3").classList.toggle("is-fail", failing || errs > 0);

    // Rack
    let c = -1;
    while (c + 1 < N && passed[c + 1]) c++;
    const lit = new Set();
    if (c >= 0) PSU_ROWS.forEach((r) => lit.add(r));
    BODY_ROWS.slice(0, litUpTo(c)).forEach((r) => lit.add(r));
    const active = new Set();
    if (phase === "testing" || phase === "fail") {
      if (idx === 0) PSU_ROWS.forEach((r) => active.add(r));
      else if (idx < N - 1) BODY_ROWS.slice(litUpTo(idx - 1), litUpTo(idx)).forEach((r) => active.add(r));
      else LAYOUT.forEach((_, r) => active.add(r));
    }
    const sig = `${[...lit].join()}|${[...active].join()}|${phase}|${idx}`;
    if (sig !== rowSig) {
      rowSig = sig;
      rows.forEach((r, i) => {
        r.classList.toggle("is-lit", lit.has(i));
        r.classList.toggle("is-active", active.has(i) && !lit.has(i));
        r.classList.toggle("is-fail", i === FAIL_ROW && failing);
        r.classList.toggle("is-out", i === FAIL_ROW && phase === "repair");
      });
      if (phase === "repair") positionFailRow();
      rackEl.classList.toggle("is-shipped", phase === "done");
      benchEl.classList.toggle("is-busy", phase === "repair");
    }
    rackEl.classList.toggle("is-testing", phase === "testing" && !state.paused);

    // Details (swap with a fade when the station changes)
    if (idx !== shownIdx) {
      shownIdx = idx;
      $("tlName").textContent = st.name;
      $("tlTag").textContent = st.lede;
      $("tlDesc").textContent = st.desc;
      $("tlPass").textContent = st.pass;
      $("tlCatches").textContent = st.catches;
      $("tlLogTag").textContent = `[${st.tag}]`;
      checksEl.innerHTML = st.checks.map((txt) => `<li><span class="tl__box">${check}</span><span>${txt}</span></li>`).join("");
      panel.setAttribute("aria-labelledby", `tl-tab-${idx}`);
      details.classList.remove("is-swap");
      void details.offsetWidth;
      details.classList.add("is-swap");
      centerTab(idx);
    }
    const m = st.checks.length;
    const d = durOf(idx);
    const ticked =
      passed[idx] || phase === "pass" || phase === "done" ? m
      : phase === "testing" ? st.checks.filter((_, k) => state.t >= ((k + 1) / (m + 1)) * d && !(state.failRun && k === m - 1)).length
      : failing && idx === RUNIN ? m - 1
      : 0;
    [...checksEl.children].forEach((li, k) => li.classList.toggle("is-done", k < ticked));

    // Log (append-only within one run of a station)
    const key = `${state.runId}|${phase === "repair" ? "repair" : idx}`;
    if (key !== logKey) {
      logKey = key;
      logCount = 0;
      logEl.textContent = "";
    }
    const lines = visibleLog();
    for (; logCount < lines.length; logCount++) {
      const li = document.createElement("li");
      li.className = lines[logCount].kind;
      li.textContent = lines[logCount].text;
      logEl.appendChild(li);
    }
    logEl.scrollTop = logEl.scrollHeight;
  };

  // Slide the failing tray onto the debug bench
  const positionFailRow = () => {
    const row = rows[FAIL_ROW];
    row.style.removeProperty("--dx");
    row.style.removeProperty("--dy");
    const r = row.getBoundingClientRect();
    const b = benchEl.getBoundingClientRect();
    row.style.setProperty("--dx", `${b.left + (b.width - r.width) / 2 - r.left}px`);
    row.style.setProperty("--dy", `${b.top + b.height / 2 - 8 - (r.top + r.height / 2)}px`);
  };

  // Keep the active station visible in the horizontally scrolling stepper (phones)
  const centerTab = (i) => {
    if (scroller.scrollWidth <= scroller.clientWidth) return;
    const tab = tabs[i];
    scroller.scrollTo({
      left: tab.offsetLeft - (scroller.clientWidth - tab.offsetWidth) / 2,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  };

  const announce = () => {
    const st = STATIONS[state.idx];
    const msg = {
      testing: `${st.name}: testing`,
      pass: `${st.name}: passed`,
      done: "Ship: passed. Rack ready for deployment.",
      fail: "Run-in failed: tray 04 sent to the debug bench",
      repair: "Repairing tray 04, then re-entering at Firmware",
    }[state.phase];
    if (msg) live.textContent = msg;
  };

  // ---- Input: buttons, toggle, keyboard, swipe ----
  runBtn.addEventListener("click", runLine);
  pauseBtn.addEventListener("click", () => {
    state.paused = !state.paused;
    kick();
  });
  failToggle.addEventListener("change", () => {
    if (failToggle.checked) state.failUsed = false;
  });

  tabsEl.addEventListener("keydown", (e) => {
    const map = { ArrowRight: state.idx + 1, ArrowLeft: state.idx - 1, Home: 0, End: N - 1 };
    if (!(e.key in map)) return;
    e.preventDefault();
    select((map[e.key] + N) % N, { focus: true });
  });

  let touch = null;
  panel.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    touch = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  panel.addEventListener("touchend", (e) => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) select(state.idx + (dx < 0 ? 1 : -1));
  }, { passive: true });

  // ---- Run only while on screen; auto-start the first time it's seen ----
  new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !started && !reduceMotion) {
        started = true;
        runLine();
      }
      if (visible) kick();
    },
    { threshold: 0.25 }
  ).observe(root);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) kick();
  });
  window.addEventListener("resize", () => {
    if (state.phase === "repair") positionFailRow();
  });

  render();

  // ---- Failure walkthrough: markers and rail fill track the scroll ----
  const fwList = document.getElementById("fwSteps");
  if (fwList) {
    const steps = [...fwList.children];
    let pending = false;
    const update = () => {
      pending = false;
      const line = window.innerHeight * 0.62;
      const r = fwList.getBoundingClientRect();
      const fill = reduceMotion ? 1 : Math.min(Math.max((line - r.top) / r.height, 0), 1);
      fwList.style.setProperty("--fill", fill.toFixed(3));
      steps.forEach((s) => s.classList.toggle("is-on", reduceMotion || s.getBoundingClientRect().top < line));
    };
    window.addEventListener("scroll", () => {
      if (!pending) {
        pending = true;
        requestAnimationFrame(update);
      }
    }, { passive: true });
    update();
  }
})();
