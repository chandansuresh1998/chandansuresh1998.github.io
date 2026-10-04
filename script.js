(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.getElementById("year").textContent = new Date().getFullYear();

  // ---- Nav: border on scroll, mobile toggle, active link ----
  const nav = document.getElementById("nav");
  const toggle = document.getElementById("navToggle");

  const setMenu = (open) => {
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };
  toggle.addEventListener("click", () => setMenu(!nav.classList.contains("is-open")));
  nav.querySelectorAll(".nav__links a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("is-open")) {
      setMenu(false);
      toggle.focus();
    }
  });

  const navLinks = [...nav.querySelectorAll(".nav__links a")];
  const sections = navLinks.map((a) => document.querySelector(a.getAttribute("href")));
  const sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        navLinks.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === "#" + e.target.id));
      });
    },
    { rootMargin: "-45% 0px -50% 0px" }
  );
  sections.forEach((s) => s && sectionObserver.observe(s));

  // ---- Reveal on scroll ----
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          revealObserver.unobserve(e.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
  );
  document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

  // ---- Count-up numbers ----
  const countObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        countObserver.unobserve(e.target);
        const el = e.target;
        const target = parseFloat(el.dataset.count);
        const decimals = parseInt(el.dataset.decimals || "0", 10);
        const suffix = el.dataset.suffix || "";
        if (reduceMotion) {
          el.textContent = target.toFixed(decimals) + suffix;
          return;
        }
        const duration = 1800;
        const start = performance.now();
        const tick = (now) => {
          const t = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - t, 4);
          el.textContent = (target * eased).toFixed(decimals) + suffix;
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    },
    { threshold: 0.6 }
  );
  document.querySelectorAll("[data-count]").forEach((el) => countObserver.observe(el));

  // ---- Statement: scroll-linked word reveal ----
  // Each word gets --p (0 → 1). The paragraph never moves; only per-word
  // brightness follows scroll, eased toward the scroll target every frame.
  const text = document.getElementById("statementText");
  // Words to highlight in accent green (lowercase, punctuation stripped)
  const highlight = new Set(["gb200", "gb300", "vr200", "nvl72", "meta"]);
  const words = text.textContent.trim().split(/\s+/);
  text.innerHTML = words
    .map((w) => {
      const key = w.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!highlight.has(key)) return `<span class="w">${w}</span>`;
      // Keep trailing punctuation out of the green glow
      const [, core, punct] = w.match(/^(.*?)([^a-z0-9]*)$/i);
      return `<span class="w"><span class="hl">${core}</span>${punct}</span>`;
    })
    .join(" ");
  const wordEls = [...text.querySelectorAll(".w")];
  const SPREAD = 3; // how many words are mid-fade at once
  const wordP = wordEls.map(() => -1);
  let revealTarget = 0;
  let revealShown = 0;
  let revealRaf = null;
  let revealLast = null;

  const readRevealTarget = () => {
    // 0 when the text's top reaches 85% of the viewport,
    // 1 when its center has risen to 40%
    const vh = window.innerHeight;
    const r = text.getBoundingClientRect();
    revealTarget = Math.min(Math.max((vh * 0.85 - r.top) / (vh * 0.45 + r.height / 2), 0), 1);
  };
  const paintReveal = () => {
    const span = wordEls.length + SPREAD;
    wordEls.forEach((el, i) => {
      const p = Math.min(Math.max((revealShown * span - i) / SPREAD, 0), 1);
      const q = Math.round(p * 1000) / 1000;
      if (q !== wordP[i]) {
        wordP[i] = q;
        el.style.setProperty("--p", q);
      }
    });
  };
  const revealFrame = (now) => {
    revealRaf = null;
    const dt = revealLast == null ? 16 : Math.min(now - revealLast, 64);
    revealLast = now;
    // Frame-rate independent ease: ~90% of the gap closes in ~0.2 s
    revealShown += (revealTarget - revealShown) * (1 - Math.exp(-dt / 90));
    if (Math.abs(revealTarget - revealShown) < 0.0005) revealShown = revealTarget;
    paintReveal();
    if (revealShown !== revealTarget) revealRaf = requestAnimationFrame(revealFrame);
    else revealLast = null;
  };
  if (!reduceMotion) {
    readRevealTarget();
    revealShown = revealTarget; // no fade-in on load if the page opens mid-section
    paintReveal();
  }

  // ---- Scroll loop (rAF-throttled) ----
  let ticking = false;
  const onScroll = () => {
    nav.classList.toggle("is-scrolled", window.scrollY > 10);

    if (!reduceMotion) {
      readRevealTarget();
      if (revealRaf == null && revealShown !== revealTarget) revealRaf = requestAnimationFrame(revealFrame);
    }
    ticking = false;
  };
  window.addEventListener("resize", onScroll, { passive: true });

  // ---- Recommendations panel (shares the diagnostics panel's frame + animation) ----
  const recs = document.getElementById("recs");
  const recsOpen = document.getElementById("recsOpen");
  if (recs && recsOpen) {
    let recsTimer = null;
    const closeRecs = () => {
      if (!recs.open) return;
      recs.classList.remove("is-open");
      recsTimer = setTimeout(() => {
        recs.close();
        document.documentElement.classList.remove("diag-open");
        recsOpen.focus();
      }, reduceMotion ? 0 : 280);
    };
    recsOpen.addEventListener("click", () => {
      clearTimeout(recsTimer);
      document.documentElement.classList.add("diag-open");
      recs.showModal();
      recs.querySelector(".recs__body").scrollTop = 0;
      requestAnimationFrame(() => recs.classList.add("is-open"));
    });
    document.getElementById("recsClose").addEventListener("click", closeRecs);
    recs.addEventListener("cancel", (e) => {
      e.preventDefault();
      closeRecs();
    });
    recs.addEventListener("click", (e) => {
      if (e.target === recs) closeRecs();
    });
  }
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        requestAnimationFrame(onScroll);
        ticking = true;
      }
    },
    { passive: true }
  );
  onScroll();
})();
