/* =========================================================
   Future Me — app logic (vanilla JS)
   ========================================================= */
(() => {
  'use strict';

  const STORAGE_KEY = 'futureMe.messages.v1';
  const THEME_KEY = 'futureMe.theme';
  const NAME_KEY = 'futureMe.name';
  const MIN_LEAD_MS = 60 * 1000; // unlock must be at least a minute away
  const MAX_YEARS_AHEAD = 100;
  const QUOTE_INTERVAL_MS = 12000;
  const REVEAL_DELAY_MS = 650;

  const QUOTES = [
    { text: 'The future depends on what you do today.', author: 'Mahatma Gandhi' },
    { text: 'You are never too old to set another goal or to dream a new dream.', author: 'C. S. Lewis' },
    { text: 'What you do today can improve all your tomorrows.', author: 'Ralph Marston' },
    { text: 'The best way to predict the future is to create it.', author: 'Peter Drucker' },
    { text: 'Small deeds done are better than great deeds planned.', author: 'Peter Marshall' },
    { text: 'Act as if what you do makes a difference. It does.', author: 'William James' },
    { text: 'It always seems impossible until it’s done.', author: 'Nelson Mandela' },
    { text: 'Be kind to your future self. They are counting on you.', author: 'Unknown' },
    { text: 'A year from now you may wish you had started today.', author: 'Karen Lamb' },
    { text: 'Life can only be understood backwards; but it must be lived forwards.', author: 'Søren Kierkegaard' },
    { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
    { text: 'Every moment is a fresh beginning.', author: 'T. S. Eliot' },
  ];

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- DOM ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const els = {
    themeToggle: $('#theme-toggle'),
    quoteCard: $('#quote-card'),
    quoteText: $('#quote-text'),
    quoteAuthor: $('#quote-author'),
    quoteNext: $('#quote-next'),
    compose: $('#compose'),
    form: $('#compose-form'),
    name: $('#name'),
    message: $('#message'),
    date: $('#unlock-date'),
    charCount: $('#char-count'),
    presets: $('#presets'),
    formError: $('#form-error'),
    nextUp: $('#next-up'),
    statTotal: $('#stat-total'),
    statSealed: $('#stat-sealed'),
    statOpened: $('#stat-opened'),
    filters: $('#filters'),
    list: $('#capsule-list'),
    empty: $('#empty-state'),
    toasts: $('#toasts'),
    template: $('#capsule-template'),
    canvas: $('#confetti'),
    exportBtn: $('#export-btn'),
    importInput: $('#import-input'),
  };

  const BASE_TITLE = document.title;

  // ---------- State ----------
  let messages = loadMessages();
  let currentFilter = 'all';
  const cards = new Map(); // message id -> card element currently rendered

  // ---------- Storage ----------
  function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function safeSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  }

  function isValidMessage(m) {
    return m && typeof m.id === 'string' && typeof m.text === 'string' &&
      Number.isFinite(m.createdAt) && Number.isFinite(m.unlockAt);
  }

  function loadMessages() {
    try {
      const data = JSON.parse(safeGet(STORAGE_KEY) || '[]');
      return Array.isArray(data) ? data.filter(isValidMessage) : [];
    } catch {
      return [];
    }
  }

  function saveMessages() {
    const ok = safeSet(STORAGE_KEY, JSON.stringify(messages));
    if (!ok) toast('Couldn’t save — browser storage may be full or disabled.', 'error');
    return ok;
  }

  function makeId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  const isUnlocked = (m, now = Date.now()) => now >= m.unlockAt;
  const findMessage = (id) => messages.find((m) => m.id === id);

  // ---------- Formatting ----------
  const pad = (n) => String(n).padStart(2, '0');

  function toLocalInputValue(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatDate(ts, withTime = false) {
    const opts = { year: 'numeric', month: 'short', day: 'numeric' };
    if (withTime) Object.assign(opts, { hour: 'numeric', minute: '2-digit' });
    return new Date(ts).toLocaleString(undefined, opts);
  }

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  function formatRelative(ts, now = Date.now()) {
    const diff = ts - now;
    const abs = Math.abs(diff);
    const units = [
      ['year', 365 * 864e5],
      ['month', 30 * 864e5],
      ['week', 7 * 864e5],
      ['day', 864e5],
      ['hour', 36e5],
      ['minute', 6e4],
      ['second', 1e3],
    ];
    for (const [unit, ms] of units) {
      if (abs >= ms || unit === 'second') return rtf.format(Math.round(diff / ms), unit);
    }
    return '';
  }

  // ---------- Theme ----------
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    els.themeToggle.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
  }

  function initTheme() {
    const saved = safeGet(THEME_KEY);
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
    applyTheme(saved === 'dark' || saved === 'light' ? saved : systemDark.matches ? 'dark' : 'light');

    // Follow OS theme changes until the user picks a theme explicitly.
    systemDark.addEventListener('change', (e) => {
      const pref = safeGet(THEME_KEY);
      if (pref !== 'dark' && pref !== 'light') applyTheme(e.matches ? 'dark' : 'light');
    });

    els.themeToggle.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      safeSet(THEME_KEY, next);
    });
  }

  // ---------- Quotes ----------
  let quoteIndex = Math.floor(Math.random() * QUOTES.length);
  let quoteTimer = null;

  function renderQuote(animate = true) {
    const { text, author } = QUOTES[quoteIndex];
    const apply = () => {
      els.quoteText.textContent = text;
      els.quoteAuthor.textContent = `— ${author}`;
      els.quoteCard.classList.remove('is-changing');
    };
    if (!animate || prefersReducedMotion) return apply();
    els.quoteCard.classList.add('is-changing');
    setTimeout(apply, 350);
  }

  function advanceQuote() {
    quoteIndex = (quoteIndex + 1) % QUOTES.length;
    renderQuote();
  }

  function initQuotes() {
    renderQuote(false);
    quoteTimer = setInterval(advanceQuote, QUOTE_INTERVAL_MS);
    els.quoteNext.addEventListener('click', () => {
      advanceQuote();
      clearInterval(quoteTimer);
      quoteTimer = setInterval(advanceQuote, QUOTE_INTERVAL_MS);
    });
  }

  // ---------- Toasts ----------
  function toast(text, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast${type === 'error' ? ' is-error' : ''}`;
    el.textContent = text;
    els.toasts.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 300);
    }, 4200);
  }

  // ---------- Confetti ----------
  const confetti = (() => {
    const canvas = els.canvas;
    const ctx = canvas.getContext('2d');
    const colors = ['#6a5af9', '#ff8a5b', '#17a174', '#ffd166', '#ef476f', '#9b8dff'];
    let particles = [];
    let frame = null;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function step() {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      particles = particles.filter((p) => p.life > 0);
      for (const p of particles) {
        p.vy += 0.22;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 1;
        ctx.save();
        ctx.globalAlpha = Math.min(1, p.life / 40);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      frame = particles.length ? requestAnimationFrame(step) : null;
    }

    function burst(x, y, count = 90) {
      if (prefersReducedMotion) return;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 3 + Math.random() * 7;
        particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 5,
          w: 6 + Math.random() * 6,
          h: 4 + Math.random() * 4,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.3,
          color: colors[(Math.random() * colors.length) | 0],
          life: 90 + Math.random() * 50,
        });
      }
      if (!frame) frame = requestAnimationFrame(step);
    }

    function burstFrom(el) {
      const r = el.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + Math.min(r.height / 2, 120));
    }

    resize();
    window.addEventListener('resize', resize);
    return { burstFrom };
  })();

  // ---------- Compose form ----------
  // Add months without overflowing short months (Jan 31 + 1 month → Feb 28/29, not Mar 3).
  function addMonths(d, n) {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
  }

  function presetDate(key) {
    const d = new Date();
    switch (key) {
      // Round up to the next whole minute: the input drops seconds, which could
      // otherwise leave barely more than MIN_LEAD_MS of lead time.
      case 'demo': d.setMinutes(d.getMinutes() + 2, 60, 0); break;
      case 'week': d.setDate(d.getDate() + 7); break;
      case 'month': addMonths(d, 1); break;
      case 'half': addMonths(d, 6); break;
      case 'year': addMonths(d, 12); break;
    }
    return d;
  }

  function maxUnlockDate() {
    const d = new Date();
    d.setFullYear(d.getFullYear() + MAX_YEARS_AHEAD);
    return d;
  }

  function refreshMinDate() {
    els.date.min = toLocalInputValue(new Date(Date.now() + MIN_LEAD_MS));
    els.date.max = toLocalInputValue(maxUnlockDate());
  }

  function updateCharCount() {
    const len = els.message.value.length;
    const max = Number(els.message.maxLength) || 2000;
    els.charCount.textContent = `${len} / ${max}`;
    els.charCount.classList.toggle('is-near', len > max * 0.9);
  }

  function clearActivePreset() {
    $$('.chip', els.presets).forEach((c) => c.classList.remove('is-active'));
  }

  function showError(text, field) {
    els.formError.textContent = text;
    els.formError.hidden = false;
    if (field) {
      field.classList.remove('is-invalid');
      void field.offsetWidth; // restart shake animation
      field.classList.add('is-invalid');
      field.focus();
    }
  }

  function clearError() {
    els.formError.hidden = true;
    $$('.is-invalid', els.form).forEach((f) => f.classList.remove('is-invalid'));
  }

  function handleSubmit(e) {
    e.preventDefault();
    clearError();
    refreshMinDate();

    const name = els.name.value.trim();
    const text = els.message.value.trim();
    const unlockAt = els.date.value ? new Date(els.date.value).getTime() : NaN;

    if (!name) return showError('Tell future you who this is from.', els.name);
    if (!text) return showError('Your letter is empty — write something to future you.', els.message);
    if (!Number.isFinite(unlockAt)) return showError('Pick the date this letter should open.', els.date);
    if (unlockAt - Date.now() < MIN_LEAD_MS) {
      return showError('Choose a moment at least one minute in the future.', els.date);
    }
    if (unlockAt > maxUnlockDate().getTime()) {
      return showError(`Let’s keep it within ${MAX_YEARS_AHEAD} years — future you should be around to read it.`, els.date);
    }

    const msg = { id: makeId(), name, text, createdAt: Date.now(), unlockAt, seen: false };
    messages.push(msg);
    if (!saveMessages()) {
      messages.pop();
      return;
    }
    safeSet(NAME_KEY, name);

    els.message.value = '';
    els.date.value = '';
    clearActivePreset();
    updateCharCount();

    els.compose.classList.remove('is-sealing');
    void els.compose.offsetWidth;
    els.compose.classList.add('is-sealing');

    if (currentFilter === 'opened') setFilter('all', false);
    render({ highlightId: msg.id });
    toast(`Sealed! It opens ${formatRelative(unlockAt)}. ✉️`);
  }

  function initForm() {
    const savedName = safeGet(NAME_KEY);
    if (savedName) els.name.value = savedName;

    refreshMinDate();
    updateCharCount();

    els.form.addEventListener('submit', handleSubmit);
    els.message.addEventListener('input', updateCharCount);
    els.form.addEventListener('input', (e) => {
      if (e.target.classList.contains('is-invalid')) clearError();
    });
    els.date.addEventListener('input', clearActivePreset);
    els.date.addEventListener('focus', refreshMinDate);

    els.message.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        els.form.requestSubmit();
      }
    });

    els.presets.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      els.date.value = toLocalInputValue(presetDate(chip.dataset.preset));
      clearActivePreset();
      chip.classList.add('is-active');
      clearError();
    });
  }

  // ---------- Dashboard ----------
  function setFilter(filter, rerender = true) {
    currentFilter = filter;
    $$('.filter', els.filters).forEach((btn) => {
      const active = btn.dataset.filter === filter;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    if (rerender) render();
  }

  function sortMessages(list, now) {
    // Opened letters first (most recently opened on top), then sealed ones by soonest unlock.
    return [...list].sort((a, b) => {
      const ua = isUnlocked(a, now);
      const ub = isUnlocked(b, now);
      if (ua !== ub) return ua ? -1 : 1;
      return ua ? b.unlockAt - a.unlockAt : a.unlockAt - b.unlockAt;
    });
  }

  function render({ highlightId } = {}) {
    const now = Date.now();
    const visible = sortMessages(messages, now).filter((m) => {
      if (currentFilter === 'sealed') return !isUnlocked(m, now);
      if (currentFilter === 'opened') return isUnlocked(m, now);
      return true;
    });

    els.list.replaceChildren();
    cards.clear();

    let revealQueue = 0;
    visible.forEach((m, i) => {
      const card = buildCard(m);
      card.style.setProperty('--i', Math.min(i, 8));
      if (m.id === highlightId) card.classList.add('is-new');
      els.list.appendChild(card);
      cards.set(m.id, card);

      if (isUnlocked(m, now)) {
        if (m.seen) {
          showOpened(card, m);
        } else {
          // Arrived while you were away — play the reveal, staggered.
          // `queued` keeps tick() from revealing it early and collapsing the stagger.
          updateCountdown(card, m, now);
          card.dataset.queued = '';
          setTimeout(() => {
            delete card.dataset.queued;
            reveal(card, m);
          }, 500 + revealQueue++ * 700);
        }
      } else {
        updateCountdown(card, m, now);
      }
    });

    els.empty.hidden = visible.length > 0;
    if (!visible.length) {
      const [title, sub] = {
        all: ['Nothing here yet', 'Write your first letter — future you is waiting.'],
        sealed: ['No sealed letters', 'Everything you’ve written has already arrived.'],
        opened: ['No opened letters yet', 'Your sealed letters will appear here once their day comes.'],
      }[currentFilter];
      $('.empty-title', els.empty).textContent = title;
      $('.empty-sub', els.empty).textContent = sub;
    }

    updateStats(now);
  }

  function buildCard(m) {
    const card = els.template.content.firstElementChild.cloneNode(true);
    card.dataset.id = m.id;

    $('.capsule-from', card).textContent = m.name || 'you';
    const written = $('.capsule-written', card);
    written.textContent = formatDate(m.createdAt);
    written.dateTime = new Date(m.createdAt).toISOString();
    const unlock = $('.capsule-unlock', card);
    unlock.textContent = formatDate(m.unlockAt, true);
    unlock.dateTime = new Date(m.unlockAt).toISOString();

    const del = $('.delete-btn', card);
    let confirmTimer = null;
    del.addEventListener('click', () => {
      if (!del.classList.contains('is-confirming')) {
        del.classList.add('is-confirming');
        del.setAttribute('aria-label', 'Click again to confirm delete');
        confirmTimer = setTimeout(() => {
          del.classList.remove('is-confirming');
          del.setAttribute('aria-label', 'Delete letter');
        }, 3000);
        return;
      }
      clearTimeout(confirmTimer);
      removeMessage(m.id, card);
    });

    return card;
  }

  function removeMessage(id, card) {
    if (card.classList.contains('is-removing')) return;
    card.classList.add('is-removing');
    setTimeout(() => {
      messages = messages.filter((m) => m.id !== id);
      saveMessages();
      render();
      toast('Letter deleted.');
    }, prefersReducedMotion ? 0 : 340);
  }

  function setNum(el, value) {
    if (el.textContent === value) return;
    el.textContent = value;
    if (prefersReducedMotion) return;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  function updateCountdown(card, m, now) {
    const totalSec = Math.max(0, Math.ceil((m.unlockAt - now) / 1000));
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const min = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;

    setNum($('[data-unit="d"]', card), String(d));
    setNum($('[data-unit="h"]', card), pad(h));
    setNum($('[data-unit="m"]', card), pad(min));
    setNum($('[data-unit="s"]', card), pad(s));

    const span = Math.max(1, m.unlockAt - m.createdAt);
    const pct = Math.min(100, Math.max(0, ((now - m.createdAt) / span) * 100));
    $('.progress-fill', card).style.width = `${pct}%`;
    $('.progress', card).setAttribute('aria-valuenow', String(Math.round(pct)));
    $('.progress-pct', card).textContent = `${pct < 10 ? pct.toFixed(1) : Math.floor(pct)}% of the way`;
  }

  function showOpened(card, m) {
    card.classList.remove('is-sealed', 'is-unsealing');
    card.classList.add('is-opened');
    $('.status-text', card).textContent = 'Opened';
    $('.sealed-view', card).hidden = true;
    $('.letter-body', card).textContent = m.text;
    $('.letter-name', card).textContent = `${m.name || 'You'}, ${formatDate(m.createdAt)}`;
    $('.opened-view', card).hidden = false;
  }

  function reveal(card, m) {
    if (!card.isConnected || card.classList.contains('is-opened') || card.classList.contains('is-unsealing')) return;

    // Don't waste the moment on a background tab — flag it in the title and
    // reveal when the user comes back (the clock retries every second).
    if (document.hidden) {
      document.title = `💌 A letter arrived! · ${BASE_TITLE}`;
      return;
    }

    m.seen = true;
    saveMessages();

    $('.status-text', card).textContent = 'Opening…';
    card.classList.add('is-unsealing');

    setTimeout(() => {
      if (!card.isConnected) return;
      showOpened(card, m);
      card.classList.add('is-revealed');
      confetti.burstFrom(card);
      card.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'nearest' });
      updateStats();
    }, prefersReducedMotion ? 0 : REVEAL_DELAY_MS);

    toast(`💌 A letter from ${m.name || 'your past self'} just arrived!`);
  }

  function updateStats(now = Date.now()) {
    const sealed = messages.filter((m) => !isUnlocked(m, now));
    els.statTotal.textContent = messages.length;
    els.statSealed.textContent = sealed.length;
    els.statOpened.textContent = messages.length - sealed.length;

    if (!messages.length) {
      els.nextUp.textContent = 'No letters yet.';
    } else if (!sealed.length) {
      els.nextUp.textContent = 'Every letter has arrived. Time to write a new one?';
    } else {
      const next = sealed.reduce((a, b) => (a.unlockAt < b.unlockAt ? a : b));
      els.nextUp.textContent = `Next letter arrives ${formatRelative(next.unlockAt, now)}.`;
    }
  }

  // ---------- Backup / restore ----------
  function exportBackup() {
    if (!messages.length) return toast('Nothing to back up yet — write a letter first.');
    const payload = { app: 'future-me', version: 1, exportedAt: new Date().toISOString(), messages };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    a.href = url;
    a.download = `future-me-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Backed up ${messages.length} letter${messages.length === 1 ? '' : 's'}.`);
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let incoming;
      try {
        const data = JSON.parse(reader.result);
        incoming = Array.isArray(data) ? data : data && data.messages;
        if (!Array.isArray(incoming)) throw new Error('bad format');
      } catch {
        return toast('That file isn’t a Future Me backup.', 'error');
      }

      const known = new Set(messages.map((m) => m.id));
      const added = incoming
        .filter((m) => {
          if (!isValidMessage(m) || known.has(m.id)) return false;
          known.add(m.id); // also drops duplicates within the file itself
          return true;
        })
        .map((m) => ({
          id: m.id,
          name: typeof m.name === 'string' ? m.name.slice(0, 60) : '',
          text: m.text.slice(0, 2000),
          createdAt: m.createdAt,
          unlockAt: m.unlockAt,
          seen: m.seen === true,
        }));

      if (!added.length) return toast('No new letters found in that backup.');
      messages = messages.concat(added);
      if (!saveMessages()) {
        messages = messages.slice(0, messages.length - added.length);
        return;
      }
      render();
      toast(`Restored ${added.length} letter${added.length === 1 ? '' : 's'}.`);
    };
    reader.onerror = () => toast('Couldn’t read that file.', 'error');
    reader.readAsText(file);
  }

  // ---------- Clock ----------
  let lastStatsUpdate = 0;

  function tick() {
    const now = Date.now();
    let needsRender = false;

    for (const [id, card] of cards) {
      const m = findMessage(id);
      if (!m || !card.classList.contains('is-sealed') || card.classList.contains('is-unsealing')) continue;
      updateCountdown(card, m, now);
      if (isUnlocked(m, now) && !('queued' in card.dataset)) reveal(card, m);
    }

    // A letter arrived that's hidden by the current filter — re-render so it can appear.
    // The "sealed" filter never shows unlocked letters, so re-rendering there would loop forever.
    if (currentFilter !== 'sealed') {
      for (const m of messages) {
        if (!m.seen && isUnlocked(m, now) && !cards.has(m.id)) needsRender = true;
      }
    }

    if (needsRender) {
      render();
    } else if (now - lastStatsUpdate > 5000) {
      updateStats(now);
      lastStatsUpdate = now;
    }
  }

  function initDashboard() {
    els.filters.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter');
      if (btn && btn.dataset.filter !== currentFilter) setFilter(btn.dataset.filter);
    });

    // Keep multiple tabs in sync.
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY) return;
      messages = loadMessages();
      render();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      document.title = BASE_TITLE;
      tick();
    });

    els.exportBtn.addEventListener('click', exportBackup);
    els.importInput.addEventListener('change', () => {
      const file = els.importInput.files[0];
      if (file) importBackup(file);
      els.importInput.value = '';
    });

    render();
    setInterval(tick, 1000);
  }

  // ---------- Boot ----------
  initTheme();
  initQuotes();
  initForm();
  initDashboard();
})();
