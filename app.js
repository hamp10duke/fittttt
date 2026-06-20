// ── Supabase config ───────────────────────────────────
const SB_URL = 'https://mfsdwdcxjahjtonwselc.supabase.co';
const SB_KEY = 'sb_publishable_GQoO9s_NiiFeg-qOriEv5g_rgCbRRBR';
const SB_HEADERS = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' };

// ── Storage — localStorage cache + Supabase sync ─────
// Reads are instant from cache. Writes go to cache immediately
// then sync to Supabase in the background.
const cache = {};

function cacheGet(k) {
  if (cache[k] !== undefined) return cache[k];
  try { const v = JSON.parse(localStorage.getItem(k) || 'null'); cache[k] = v; return v; } catch { return null; }
}

function cacheSet(k, v) {
  cache[k] = v;
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
}

async function sbRead(k) {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/tracker_data?key=eq.${k}&select=value`, { headers: SB_HEADERS });
    if (!res.ok) return null;
    const rows = await res.json();
    if (rows.length === 0) return null;
    const v = rows[0].value;
    cacheSet(k, v);
    return v;
  } catch { return null; }
}

async function sbWrite(k, v) {
  try {
    await fetch(`${SB_URL}/rest/v1/tracker_data`, {
      method: 'POST',
      headers: SB_HEADERS,
      body: JSON.stringify({ key: k, value: v, updated_at: new Date().toISOString() })
    });
  } catch (e) { console.warn('Supabase write failed, data saved locally', e); }
}

// Public API — synchronous getters use cache, setters write cache then sync
const getWorkouts = () => cacheGet('workouts') || [];
const getRuns     = () => cacheGet('runs') || [];
const getStats    = () => cacheGet('bodystats') || [];
const getMeals    = () => cacheGet('meals') || [];

function saveWorkouts(v) { cacheSet('workouts', v); sbWrite('workouts', v); }
function saveRuns(v)     { cacheSet('runs', v);     sbWrite('runs', v); }
function saveBodyStats(v){ cacheSet('bodystats', v);sbWrite('bodystats', v); }
function saveMeals(v)    { cacheSet('meals', v);    sbWrite('meals', v); }

// Pull latest from Supabase on load, then re-render
async function syncFromSupabase() {
  const syncIndicator = document.getElementById('sync-indicator');
  if (syncIndicator) { syncIndicator.textContent = 'Syncing...'; syncIndicator.style.color = 'var(--text3)'; }
  const keys = ['workouts', 'runs', 'bodystats', 'meals', 'routes', 'program_state'];
  await Promise.all(keys.map(k => sbRead(k)));
  refreshHome();
  refreshDashboard();
  renderStatsTable();
  renderHistory('all');
  try { renderFoodPage(); } catch {}
  if (syncIndicator) { syncIndicator.textContent = 'Synced ✓'; syncIndicator.style.color = 'var(--accent2)'; setTimeout(() => { syncIndicator.textContent = ''; }, 3000); }
}

// ── Navigation ────────────────────────────────────────
function navTo(page) {
  if (isMobile()) closeMobileNav();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  // Highlight matching nav item
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick') && n.getAttribute('onclick').includes("'" + page + "'")) n.classList.add('active');
  });
  if (page === 'dashboard') refreshDashboard();
  if (page === 'history') renderHistory('all');
  if (page === 'charts') { const btns = document.querySelectorAll('#chart-range-btns .btn'); if (btns.length) { btns[0].style.borderColor = 'var(--accent)'; btns[0].style.color = 'var(--accent)'; } renderCharts(); }
  if (page === 'body-stats') renderStatsTable();
  if (page === 'log-workout') { initWorkoutForm(); resetTimers(); timerShow(); }
  else timerHide();
  if (page === 'hiit') initHiitPage();
  if (page === 'routes') initRoutesPage();
  if (page === 'programs') renderProgramsPage();
  if (page === 'data') renderDataPage();
  if (page === 'plan') renderPlanPage();
  if (page === 'food') initFoodPage();
  if (page === 'home') refreshHome();
}

function nav(page) {
  navTo(page);
}

function launchWorkout(dayKey) {
  // Navigate to log workout, set the type, load preset with last weights
  navTo('log-workout');
  const sel = document.getElementById('workout-type');
  if (sel) {
    // Set the value
    const opt = [...sel.options].find(o => o.value === dayKey);
    if (opt) sel.value = dayKey;
  }
  // Small delay to let page render, then load preset
  setTimeout(() => loadPreset(), 50);
}

function refreshHome() {
  const now = new Date();
  const dateEl = document.getElementById('landing-date');
  if (dateEl) dateEl.textContent = now.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });

  // Today's calories
  const food = getMealsSummaryForDate(today());
  const calEl = document.getElementById('ls-cal');
  if (calEl) calEl.textContent = food.count > 0 ? food.cal : '—';

  // Total workouts
  const wkEl = document.getElementById('ls-workouts');
  if (wkEl) wkEl.textContent = getWorkouts().length;

  // Latest weight
  const stats = getStats().sort((a,b) => a.date.localeCompare(b.date));
  const latest = stats.filter(s=>s.weight).pop();
  const wtEl = document.getElementById('ls-weight');
  if (wtEl) wtEl.textContent = latest ? latest.weight + ' lbs' : '—';

  // Build workout selector grid from active program
  const grid = document.getElementById('landing-workout-grid');
  if (!grid) return;

  const prog = getActiveProgram();
  const travel = isTravelMode();
  const dayLabels = {
    push:'Push', pull:'Pull', legs:'Legs', kb_cardio:'KB Cardio',
    upper_a:'Upper A', upper_b:'Upper B', lower_a:'Lower A', lower_b:'Lower B'
  };
  const dayIcons = {
    push: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12h2m14 0h2M6 7l1 10M17 7l1 10M8 12h8"/></svg>`,
    pull: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 9l7 7 7-7"/></svg>`,
    legs: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v10M8 19l4-6 4 6"/></svg>`,
    kb_cardio: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M8 8H4M20 8h-4M12 12v8"/></svg>`,
    upper_a: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12h2m14 0h2M6 7l1 10M17 7l1 10M8 12h8"/></svg>`,
    upper_b: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12h2m14 0h2M6 7l1 10M17 7l1 10M8 12h8"/></svg>`,
    lower_a: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v10M8 19l4-6 4 6"/></svg>`,
    lower_b: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v10M8 19l4-6 4 6"/></svg>`,
  };

  // Check which workouts were done today
  const todayWorkouts = getWorkouts().filter(w => w.date === today());
  const doneTodayTypes = new Set(todayWorkouts.map(w => w.type));

  grid.innerHTML = prog.days.map(day => {
    const done = doneTodayTypes.has(day);
    const label = dayLabels[day] || day;
    const icon = dayIcons[day] || dayIcons.push;
    const travelLabel = travel ? ' ✈' : '';
    return `<div class="landing-card" onclick="launchWorkout('${day}')" style="gap:10px;padding:20px 16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;width:100%;">
        <div class="landing-card-icon" style="background:rgba(127,119,221,0.12);width:36px;height:36px;border-radius:10px;flex-shrink:0;">
          <div style="color:#7F77DD;">${icon}</div>
        </div>
        ${done ? `<span style="font-size:10px;color:var(--accent);font-family:'DM Mono',monospace;background:var(--accent-dim);padding:2px 7px;border-radius:10px;">✓ done</span>` : ''}
      </div>
      <div style="width:100%;text-align:left;">
        <div class="landing-card-label" style="font-size:15px;">${label}${travelLabel}</div>
        <div style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;margin-top:2px;">${prog.name}</div>
      </div>
    </div>`;
  }).join('');
}

function today() {
  return new Date().toISOString().split('T')[0];
}

// ── Toast ─────────────────────────────────────────────
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Dashboard ─────────────────────────────────────────
function refreshDashboard() {
  const now = new Date();
  document.getElementById('dash-date').textContent = now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  const stats = getStats();
  const workouts = getWorkouts();
  const runs = getRuns();

  // Weight stat
  if (stats.length > 0) {
    const sorted = [...stats].sort((a,b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    document.getElementById('stat-weight').textContent = latest.weight || '—';
    if (sorted.length > 1) {
      const prev = sorted[sorted.length - 2];
      const diff = (parseFloat(latest.weight) - parseFloat(prev.weight)).toFixed(1);
      const el = document.getElementById('stat-weight-delta');
      el.textContent = (diff > 0 ? '▲ +' : '▼ ') + diff + ' lbs from last';
      el.className = 'stat-delta ' + (diff > 0 ? 'delta-up' : 'delta-down');
    }
    // Progress bar
    const start = 240, goal = 222;
    const current = parseFloat(latest.weight);
    const lost = start - current;
    const total = start - goal;
    const pct = Math.min(100, Math.max(0, Math.round((lost / total) * 100)));
    document.getElementById('stat-to-goal').textContent = Math.max(0, (current - goal).toFixed(1));
    document.getElementById('stat-goal-pct').textContent = pct + '% of goal';
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-pct').textContent = pct + '%';
    document.getElementById('progress-label').textContent = lost > 0 ? `Lost ${lost.toFixed(1)} lbs of ${total} lbs goal` : 'Keep going — log your progress!';
  }

  // Workout / run counts
  document.getElementById('stat-workouts').textContent = workouts.length;
  document.getElementById('stat-runs').textContent = runs.length;

  // Program week
  const prog = getActiveProgram();
  const week = getProgramWeek();
  const travel = isTravelMode();
  document.getElementById('stat-prog-week').textContent = week;
  document.getElementById('stat-prog-of').textContent = ` / ${prog.weeks}`;
  document.getElementById('stat-prog-name').textContent = prog.name + (travel ? ' · ✈ Travel' : '');
  document.getElementById('stat-prog-label').textContent = 'Week';

  // Today's calories
  const todayFood = getMealsSummaryForDate(today());
  if (todayFood.count > 0) {
    document.getElementById('stat-cal').textContent = todayFood.cal;
    const rem = 2500 - todayFood.cal;
    const calSub = document.getElementById('stat-cal-sub');
    calSub.textContent = rem > 0 ? rem + ' remaining' : Math.abs(rem) + ' over target';
    calSub.className = 'stat-delta ' + (rem < 0 ? 'delta-up' : rem < 200 ? 'delta-down' : 'delta-neutral');
  }

  // This week
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const plan = ['push','run','pull','rest','legs','run','rest'];
  const dow = (now.getDay() + 6) % 7; // 0=Mon
  // Find Monday of this week
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow);

  const weekDates = Array.from({length:7}, (_,i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().split('T')[0];
  });

  const allActivity = [
    ...workouts.map(w => ({ date: w.date, type: w.type })),
    ...runs.map(r => ({ date: r.date, type: 'run' }))
  ];

  const html = days.map((d, i) => {
    const done = allActivity.some(a => a.date === weekDates[i]);
    const isToday = i === dow;
    const dotClass = done ? 'done' : (isToday ? 'today' : '');
    const icon = plan[i] === 'rest' ? '—' : (plan[i] === 'run' ? '↑' : '◆');
    return `<div class="week-day">
      <div class="week-dot ${dotClass}">${done ? '✓' : icon}</div>
      <div class="week-day-label">${d}</div>
    </div>`;
  }).join('');
  document.getElementById('week-tracker').innerHTML = html;

  // Recent
  const all = [
    ...workouts.map(w => ({ ...w, kind: 'workout' })),
    ...runs.map(r => ({ ...r, kind: 'run' }))
  ].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 5);

  if (all.length === 0) {
    document.getElementById('recent-list').innerHTML = `<div class="empty"><div class="empty-icon">◎</div><div class="empty-text">No activity logged yet</div></div>`;
    return;
  }
  document.getElementById('recent-list').innerHTML = all.map(a => {
    const tag = a.kind === 'run'
      ? `<span class="tag tag-run">run</span>`
      : `<span class="tag tag-${a.type}">${a.type}</span>`;
    const detail = a.kind === 'run'
      ? `${a.distance || '—'} mi · ${a.duration || '—'} min`
      : `${(a.exercises||[]).length} exercises`;
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;min-width:76px;">${a.date}</span>
      ${tag}
      <span style="font-size:13px;color:var(--text2);flex:1;">${detail}</span>
      <span style="font-size:12px;color:var(--text3);">${a.notes ? a.notes.slice(0,40) : ''}</span>
    </div>`;
  }).join('');
}

// ── Workout stopwatch ─────────────────────────────────
let wtInterval = null;
let wtSeconds = 0;
let wtRunning = false;

function wtFmt(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map(v => String(v).padStart(2,'0')).join(':');
}

function wtStart() {
  if (wtRunning) return;
  wtRunning = true;
  wtSeconds = 0;
  const clk = document.getElementById('wt-clock');
  clk.classList.remove('paused');
  clk.classList.add('running');
  document.getElementById('wt-btn-start').style.display = 'none';
  document.getElementById('wt-btn-pause').style.display = '';
  document.getElementById('wt-btn-reset').style.display = '';
  wtInterval = setInterval(() => {
    wtSeconds++;
    clk.textContent = wtFmt(wtSeconds);
    liveSync({ wtSeconds, wtRunning: true });
  }, 1000);
}

function wtPause() {
  if (!wtRunning) return;
  wtRunning = false;
  clearInterval(wtInterval);
  const clk = document.getElementById('wt-clock');
  clk.classList.remove('running');
  clk.classList.add('paused');
  document.getElementById('wt-btn-pause').style.display = 'none';
  document.getElementById('wt-btn-resume').style.display = '';
}

function wtResume() {
  if (wtRunning) return;
  wtRunning = true;
  const clk = document.getElementById('wt-clock');
  clk.classList.remove('paused');
  clk.classList.add('running');
  document.getElementById('wt-btn-resume').style.display = 'none';
  document.getElementById('wt-btn-pause').style.display = '';
  wtInterval = setInterval(() => {
    wtSeconds++;
    clk.textContent = wtFmt(wtSeconds);
    liveSync({ wtSeconds, wtRunning: true });
  }, 1000);
}

function wtReset() {
  clearInterval(wtInterval);
  wtRunning = false;
  wtSeconds = 0;
  const clk = document.getElementById('wt-clock');
  clk.textContent = '00:00:00';
  clk.classList.remove('running');
  clk.classList.add('paused');
  document.getElementById('wt-btn-start').style.display = '';
  document.getElementById('wt-btn-pause').style.display = 'none';
  document.getElementById('wt-btn-resume').style.display = 'none';
  document.getElementById('wt-btn-reset').style.display = 'none';
}

// ── Countdown timers ──────────────────────────────────
const cdState = {
  set:  { interval: null, remaining: 60,  total: 60,  running: false },
  ex:   { interval: null, remaining: 180, total: 180, running: false },
};

function cdFmt(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m + ':' + String(sec).padStart(2,'0');
}

function cdStart(id, total) {
  const st = cdState[id];
  if (st.running) return;
  if (st.remaining <= 0) { st.remaining = total; st.total = total; }
  st.running = true;
  const timeEl = document.getElementById('cd-' + id + '-time');
  const fillEl = document.getElementById('cd-' + id + '-fill');
  if (timeEl) timeEl.className = 'timer-bar-time running';
  st.interval = setInterval(() => {
    st.remaining--;
    if (timeEl) timeEl.textContent = cdFmt(st.remaining);
    const pct = (st.remaining / st.total) * 100;
    if (fillEl) {
      fillEl.style.width = pct + '%';
      if (st.remaining <= 10) fillEl.style.background = 'var(--red)';
      else if (st.remaining <= 20) fillEl.style.background = 'var(--amber)';
      else fillEl.style.background = 'var(--accent)';
    }
    if (st.remaining <= 0) {
      clearInterval(st.interval);
      st.running = false;
      if (timeEl) { timeEl.textContent = 'Go!'; timeEl.className = 'timer-bar-time done'; }
      cdBeep();
    }
  }, 1000);
}

function cdReset(id, total) {
  const st = cdState[id];
  clearInterval(st.interval);
  st.running = false;
  st.remaining = total;
  st.total = total;
  const timeEl = document.getElementById('cd-' + id + '-time');
  const fillEl = document.getElementById('cd-' + id + '-fill');
  if (timeEl) { timeEl.textContent = cdFmt(total); timeEl.className = 'timer-bar-time'; }
  if (fillEl) { fillEl.style.width = '100%'; fillEl.style.background = 'var(--accent)'; }
}

function cdBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.15, 0.3].forEach(offset => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.12);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.12);
    });
  } catch(e) {}
}

// Reset timers when navigating away / back to workout page
function resetTimers() {
  wtReset();
  cdReset('set', 60);
  cdReset('ex', 180);
}

function timerToggleCollapse() {}
function timerShow() {
  document.getElementById('timer-bar').classList.add('visible');
  document.querySelector('.main').classList.add('timer-visible');
  startLiveSync();
}
function timerHide() {
  document.getElementById('timer-bar').classList.remove('visible');
  document.querySelector('.main').classList.remove('timer-visible');
  stopLiveSync();
}
// ── Programs ──────────────────────────────────────────
const PROGRAMS = {
  cut: {
    id: 'cut',
    name: 'Cut',
    subtitle: 'Push / Pull / Legs + KB Cardio',
    goal: 'Lose fat, preserve muscle',
    weeks: 12,
    color: '#7F77DD',
    days: ['push','pull','legs','kb_cardio'],
    schedule: ['push','kb_cardio','pull','rest','legs','kb_cardio','rest'],
    workouts: {
      push: [
        { name: 'Barbell bench press',             sets: 4, reps: '5–6',        note: 'Primary chest driver' },
        { name: 'Dumbbell incline press',           sets: 3, reps: '8–10',       note: 'Upper chest' },
        { name: 'Dumbbell overhead press',          sets: 3, reps: '8–10',       note: 'Seated or standing' },
        { name: 'Dumbbell lateral raises',          sets: 3, reps: '12–15',      note: 'Slow, controlled' },
        { name: 'Dumbbell tricep overhead ext.',    sets: 3, reps: '10–12',      note: 'Long head emphasis' },
        { name: 'Diamond push-ups',                 sets: 2, reps: 'Failure',    note: 'Finisher' },
        { name: 'Hanging knee raise',               sets: 4, reps: '12–15',      note: 'Lower abs — add weight when easy' },
        { name: 'Weighted decline crunch',          sets: 3, reps: '12–15',      note: 'DB on chest, decline bench or floor' },
        { name: 'Long-lever plank',                 sets: 3, reps: '30–40 sec',  note: 'Arms extended further than standard plank' },
        { name: 'KB windmill',                      sets: 3, reps: '6–8/side',   note: 'Light KB, lateral oblique and hip focus' },
      ],
      pull: [
        { name: 'Barbell bent-over row',            sets: 4, reps: '5–6',        note: 'Heavy, overhand grip' },
        { name: 'Dumbbell single-arm row',          sets: 3, reps: '8–10',       note: 'Brace on bench' },
        { name: 'Dumbbell chest-supported row',     sets: 3, reps: '10–12',      note: 'Prone on incline bench' },
        { name: 'Dumbbell face pulls (bent-over)',  sets: 3, reps: '12–15',      note: 'Rear delt / upper back' },
        { name: 'Dumbbell curl (alternating)',      sets: 3, reps: '10–12',      note: 'Supinate at top' },
        { name: 'Hammer curl',                      sets: 2, reps: '12',         note: 'Brachialis / forearms' },
        { name: 'Ab wheel rollout',                 sets: 4, reps: '8–12',       note: 'Anti-extension — go slow' },
        { name: 'Bicycle crunch',                   sets: 3, reps: '20/side',    note: 'Obliques, slow full rotation' },
        { name: 'Dead bug with KB hold',            sets: 3, reps: '10/side',    note: 'Press KB overhead while extending opposite limbs' },
        { name: 'Suitcase carry (KB)',              sets: 3, reps: '30–40 sec/side', note: 'Walk with KB in one hand — lateral core and QL' },
      ],
      legs: [
        { name: 'Barbell Romanian deadlift',        sets: 4, reps: '5–6',        note: 'Hamstring hinge focus' },
        { name: 'Dumbbell goblet squat',            sets: 4, reps: '8–10',       note: 'Use 110 lb DB' },
        { name: 'DB split squat (rear foot elevated)', sets: 3, reps: '8–10/leg', note: 'Bench for rear foot' },
        { name: 'Dumbbell walking lunges',          sets: 3, reps: '12/leg',     note: 'Down a hallway or outside' },
        { name: 'Single-leg calf raise',            sets: 3, reps: '15–20',      note: 'Edge of a step' },
        { name: 'Hollow body hold',                 sets: 3, reps: '20–30 sec',  note: 'Back pressed flat, arms overhead' },
        { name: 'Reverse crunch',                   sets: 4, reps: '15–20',      note: 'Hips curl up off floor — add ankle weight' },
        { name: 'Side plank with hip dip',          sets: 3, reps: '12/side',    note: 'Dip hip to floor and raise — oblique focus' },
        { name: 'DB woodchop',                      sets: 3, reps: '12/side',    note: 'High to low diagonal — rotational oblique' },
      ],
      kb_cardio: [
        { name: 'KB swing',                         sets: 5, reps: '20',         note: '44 lb KB — drive hips, not arms. 45s rest between sets' },
        { name: 'KB goblet squat to press',         sets: 4, reps: '12',         note: 'Squat deep, press overhead at top' },
        { name: 'KB clean and press',               sets: 4, reps: '8/side',     note: 'Clean to rack, press overhead — alternate sides' },
        { name: 'KB sumo deadlift high pull',       sets: 4, reps: '12',         note: 'Wide stance, explosive pull to chin' },
        { name: 'KB around the world',              sets: 3, reps: '10/direction', note: 'Circle KB around waist — core and shoulder' },
        { name: 'KB single-arm swing',              sets: 3, reps: '15/side',    note: 'Same as two-hand swing but grip one hand' },
        { name: 'KB halo',                          sets: 3, reps: '10/direction', note: 'Circle KB around head — shoulder mobility' },
        { name: 'Turkish get-up',                   sets: 2, reps: '3/side',     note: 'Slow and deliberate — full body stability' },
      ],
    },
    travel: {
      push: [
        { name: 'Push-up',                          sets: 4, reps: '15–20',      note: 'Slow 3s down, 1s pause' },
        { name: 'Wide push-up',                     sets: 3, reps: '12–15',      note: 'Chest emphasis' },
        { name: 'Pike push-up',                     sets: 3, reps: '10–12',      note: 'Shoulder press pattern' },
        { name: 'Diamond push-up',                  sets: 3, reps: '10–12',      note: 'Tricep focus' },
        { name: 'Decline push-up',                  sets: 3, reps: '10–12',      note: 'Feet on bed or chair' },
        { name: 'Lateral raise (no weight)',        sets: 3, reps: '20–25',      note: 'Pause 2s at top' },
        { name: 'Lying leg raise',                  sets: 4, reps: '12–15',      note: 'Lower abs' },
        { name: 'Hollow body hold',                 sets: 3, reps: '25–30 sec',  note: 'Arms overhead, back flat' },
        { name: 'Long-lever plank',                 sets: 3, reps: '30 sec',     note: 'Arms extended further forward than standard' },
        { name: 'Side plank with hip dip',          sets: 3, reps: '10/side',    note: 'Oblique focus' },
      ],
      pull: [
        { name: 'Inverted row (under desk/table)',  sets: 4, reps: '8–12',       note: 'Lie under sturdy table' },
        { name: 'Towel door row (single arm)',      sets: 3, reps: '12–15',      note: 'Loop towel around door handle' },
        { name: 'Superman hold',                    sets: 3, reps: '12 · 2s hold', note: 'Prone on floor' },
        { name: 'Prone Y-T-W raise',               sets: 3, reps: '10 each',    note: 'Face down, arms in Y/T/W' },
        { name: 'Isometric bicep curl (towel)',     sets: 3, reps: '8 · 5s holds', note: 'Stand on towel, pull up' },
        { name: 'Chin-up / pull-up',               sets: 3, reps: 'Max reps',   note: 'Door frame bar if available' },
        { name: 'Dead bug',                         sets: 4, reps: '10/side',    note: 'Back flat to floor' },
        { name: 'Bicycle crunch',                   sets: 3, reps: '20/side',    note: 'Full slow rotation' },
        { name: 'Hollow body hold',                 sets: 3, reps: '20–30 sec',  note: 'Back pressed flat' },
        { name: 'Suitcase carry (bag/luggage)',     sets: 3, reps: '30 sec/side', note: 'Heavy bag in one hand — lateral core' },
      ],
      legs: [
        { name: 'Bulgarian split squat',            sets: 4, reps: '10–12/leg',  note: 'Rear foot on bed' },
        { name: 'Jump squat',                       sets: 4, reps: '15–20',      note: 'Explode up — power without load' },
        { name: 'Walking lunge',                    sets: 3, reps: '16/leg',     note: 'Long stride, corridor if possible' },
        { name: 'Single-leg Romanian deadlift',     sets: 3, reps: '10–12/leg',  note: 'Balance on one leg, hinge' },
        { name: 'Glute bridge',                     sets: 3, reps: '20–25',      note: 'Pause 2s at top' },
        { name: 'Single-leg calf raise',            sets: 3, reps: '20–25/leg',  note: 'Use a step or door threshold' },
        { name: 'Reverse crunch',                   sets: 4, reps: '15–20',      note: 'Hips curl up off the floor' },
        { name: 'Side plank with hip dip',          sets: 3, reps: '10/side',    note: 'Oblique focus' },
        { name: 'DB woodchop (no weight)',          sets: 3, reps: '15/side',    note: 'Mimic the motion without load — rotational core' },
      ],
      kb_cardio: [
        { name: 'KB swing',                         sets: 5, reps: '20',         note: 'If KB available — otherwise jump squat' },
        { name: 'Burpee',                           sets: 4, reps: '15',         note: 'Full body — jump optional to protect knees' },
        { name: 'Mountain climber',                 sets: 4, reps: '20/side',    note: 'Fast — metabolic core work' },
        { name: 'Jump squat',                       sets: 4, reps: '15',         note: 'Explosive — rest 45s between sets' },
        { name: 'Push-up to plank hold',            sets: 3, reps: '10 + 20 sec', note: 'Push-up then hold plank' },
        { name: 'Lateral lunge',                    sets: 3, reps: '12/side',    note: 'Side to side — no knee stress' },
        { name: 'Hollow body hold',                 sets: 3, reps: '25–30 sec',  note: 'Core compression' },
        { name: 'Side plank with hip dip',          sets: 3, reps: '10/side',    note: 'Oblique finisher' },
      ],
    },
  },

  recomp: {
    id: 'recomp',
    name: 'Recomposition',
    subtitle: 'Upper / Lower Split',
    goal: 'Build muscle, maintain weight',
    weeks: 12,
    color: '#1D9E75',
    days: ['upper_a','lower_a','upper_b','lower_b'],
    schedule: ['upper_a','run','lower_a','rest','upper_b','lower_b','rest'],
    workouts: {
      upper_a: [
        { name: 'Barbell bench press',           sets: 4, reps: '6–8',   note: 'Controlled descent' },
        { name: 'Dumbbell bent-over row',        sets: 4, reps: '6–8',   note: 'Heavy, squeeze at top' },
        { name: 'Dumbbell overhead press',       sets: 3, reps: '8–10',  note: 'Strict form' },
        { name: 'Dumbbell incline curl',         sets: 3, reps: '10–12', note: 'Full stretch at bottom' },
        { name: 'Skull crusher (DB)',            sets: 3, reps: '10–12', note: 'Elbows locked in' },
        { name: 'Cable face pull (DB bent-over)',sets: 3, reps: '15',    note: 'External rotation focus' },
        { name: 'Ab wheel rollout',              sets: 3, reps: '8–12',  note: 'Core anti-extension' },
      ],
      lower_a: [
        { name: 'Barbell Romanian deadlift',     sets: 4, reps: '6–8',   note: 'Hinge pattern, heavy' },
        { name: 'Dumbbell goblet squat',         sets: 4, reps: '8–10',  note: 'Deep, controlled' },
        { name: 'DB Bulgarian split squat',      sets: 3, reps: '8–10/leg', note: 'Quad dominant' },
        { name: 'Dumbbell leg curl (lying)',     sets: 3, reps: '10–12', note: 'Slow eccentric' },
        { name: 'Single-leg calf raise',         sets: 4, reps: '15–20', note: 'Full range' },
        { name: 'Reverse crunch',                sets: 3, reps: '15',    note: 'Lower abs' },
        { name: 'Side plank',                    sets: 2, reps: '40 sec/side', note: 'Lateral core' },
      ],
      upper_b: [
        { name: 'Dumbbell incline press',        sets: 4, reps: '8–10',  note: 'Upper chest focus' },
        { name: 'Dumbbell chest-supported row',  sets: 4, reps: '8–10',  note: 'Strict, no momentum' },
        { name: 'Dumbbell lateral raise',        sets: 4, reps: '12–15', note: 'Slow, no swinging' },
        { name: 'Dumbbell hammer curl',          sets: 3, reps: '10–12', note: 'Brachialis focus' },
        { name: 'Overhead tricep ext. (DB)',     sets: 3, reps: '10–12', note: 'Long head stretch' },
        { name: 'Dumbbell shrug',                sets: 3, reps: '15',    note: 'Hold 2s at top' },
        { name: 'Plank',                         sets: 3, reps: '45 sec', note: 'Full body tension' },
      ],
      lower_b: [
        { name: 'Dumbbell sumo squat',           sets: 4, reps: '8–10',  note: 'Wide stance, glute focus' },
        { name: 'Dumbbell walking lunge',        sets: 3, reps: '12/leg', note: 'Long stride' },
        { name: 'Single-leg RDL',                sets: 3, reps: '10/leg', note: 'Balance and hamstring' },
        { name: 'Glute bridge (single leg)',     sets: 3, reps: '15/leg', note: 'Pause at top' },
        { name: 'Standing calf raise (DB)',      sets: 4, reps: '20',    note: 'Full ROM' },
        { name: 'Dead bug',                      sets: 3, reps: '10/side', note: 'Opposite arm/leg' },
        { name: 'Bicycle crunch',                sets: 3, reps: '20/side', note: 'Slow, full rotation' },
      ],
    },
    travel: {
      upper_a: [
        { name: 'Push-up',                       sets: 4, reps: '15–20', note: 'Slow 3s down' },
        { name: 'Inverted row',                  sets: 4, reps: '10–12', note: 'Under sturdy table' },
        { name: 'Pike push-up',                  sets: 3, reps: '10–12', note: 'Shoulder press pattern' },
        { name: 'Isometric bicep curl (towel)',  sets: 3, reps: '8 · 5s holds', note: 'Pull hard' },
        { name: 'Diamond push-up',               sets: 3, reps: '10–12', note: 'Tricep focus' },
        { name: 'Prone Y-T-W raise',             sets: 3, reps: '10 each', note: 'Rear delt' },
        { name: 'Ab wheel / plank',              sets: 3, reps: '30 sec', note: 'Core' },
      ],
      lower_a: [
        { name: 'Bulgarian split squat',         sets: 4, reps: '10–12/leg', note: 'Rear foot on bed' },
        { name: 'Jump squat',                    sets: 4, reps: '15',    note: 'Power focus' },
        { name: 'Single-leg RDL',                sets: 3, reps: '10/leg', note: 'Balance and hamstring' },
        { name: 'Glute bridge',                  sets: 3, reps: '20',    note: 'Pause at top' },
        { name: 'Single-leg calf raise',         sets: 4, reps: '20/leg', note: 'Step edge' },
        { name: 'Reverse crunch',                sets: 3, reps: '15',    note: 'Lower abs' },
        { name: 'Side plank',                    sets: 2, reps: '40 sec/side', note: 'Lateral core' },
      ],
      upper_b: [
        { name: 'Decline push-up',               sets: 4, reps: '12–15', note: 'Feet on bed' },
        { name: 'Towel door row',                sets: 4, reps: '12–15', note: 'Single arm' },
        { name: 'Lateral raise (no weight)',     sets: 4, reps: '20–25', note: 'Pause 2s at top' },
        { name: 'Hammer curl (no weight)',       sets: 3, reps: '15',    note: 'Slow, controlled' },
        { name: 'Tricep dip (chair)',            sets: 3, reps: '12–15', note: 'Straight legs for more load' },
        { name: 'Superman hold',                 sets: 3, reps: '12 · 2s', note: 'Rear chain' },
        { name: 'Plank',                         sets: 3, reps: '45 sec', note: 'Full tension' },
      ],
      lower_b: [
        { name: 'Sumo squat (bodyweight)',       sets: 4, reps: '15–20', note: 'Wide stance, glute focus' },
        { name: 'Walking lunge',                 sets: 3, reps: '16/leg', note: 'Corridor if possible' },
        { name: 'Single-leg RDL',                sets: 3, reps: '10/leg', note: 'Hinge on one leg' },
        { name: 'Single-leg glute bridge',       sets: 3, reps: '15/leg', note: 'Pause at top' },
        { name: 'Single-leg calf raise',         sets: 4, reps: '20/leg', note: 'Full ROM' },
        { name: 'Dead bug',                      sets: 3, reps: '10/side', note: 'Back flat' },
        { name: 'Bicycle crunch',                sets: 3, reps: '20/side', note: 'Full rotation' },
      ],
    },
  },

  hypertrophy: {
    id: 'hypertrophy',
    name: 'Hypertrophy',
    subtitle: 'High Volume Push / Pull / Legs',
    goal: 'Maximize muscle growth',
    weeks: 12,
    color: '#f0c87a',
    days: ['push','pull','legs'],
    schedule: ['push','pull','legs','rest','push','pull','rest'],
    workouts: {
      push: [
        { name: 'Dumbbell bench press',          sets: 4, reps: '10–12', note: 'Full stretch at bottom' },
        { name: 'Dumbbell incline press',        sets: 4, reps: '10–12', note: 'Upper chest' },
        { name: 'Dumbbell overhead press',       sets: 3, reps: '10–12', note: 'Strict — no leg drive' },
        { name: 'Dumbbell lateral raise',        sets: 4, reps: '15–20', note: 'Slow, cables-style' },
        { name: 'Dumbbell chest fly',            sets: 3, reps: '12–15', note: 'Deep stretch, controlled' },
        { name: 'Overhead tricep ext. (DB)',     sets: 3, reps: '12–15', note: 'Long head focus' },
        { name: 'Tricep kickback',               sets: 3, reps: '15',    note: 'Squeeze at full extension' },
        { name: 'Weighted crunch',               sets: 3, reps: '15–20', note: 'Slow and deliberate' },
        { name: 'Plank with shoulder tap',       sets: 3, reps: '30 sec', note: 'Anti-rotation' },
      ],
      pull: [
        { name: 'Dumbbell bent-over row',        sets: 4, reps: '10–12', note: 'Squeeze lat at top' },
        { name: 'Dumbbell single-arm row',       sets: 4, reps: '10–12', note: 'Full ROM' },
        { name: 'Chest-supported row (DB)',      sets: 3, reps: '12–15', note: 'No cheating — strict' },
        { name: 'Dumbbell rear delt fly',        sets: 4, reps: '15–20', note: 'Prone on incline bench' },
        { name: 'Dumbbell curl (alternating)',   sets: 4, reps: '12',    note: 'Supinate — full contraction' },
        { name: 'Hammer curl',                   sets: 3, reps: '12',    note: 'Brachialis thickness' },
        { name: 'Incline curl',                  sets: 3, reps: '12',    note: 'Stretch at bottom' },
        { name: 'Ab wheel rollout',              sets: 3, reps: '10',    note: 'Core anti-extension' },
        { name: 'Bicycle crunch',                sets: 3, reps: '20/side', note: 'Slow rotation' },
      ],
      legs: [
        { name: 'Dumbbell goblet squat',         sets: 4, reps: '10–12', note: 'Pause 2s at bottom' },
        { name: 'Dumbbell RDL',                  sets: 4, reps: '10–12', note: 'Deep stretch, slow' },
        { name: 'DB Bulgarian split squat',      sets: 3, reps: '10–12/leg', note: 'Quad dominant' },
        { name: 'Dumbbell walking lunge',        sets: 3, reps: '14/leg', note: 'Long stride' },
        { name: 'Dumbbell sumo squat',           sets: 3, reps: '12–15', note: 'Glute focus' },
        { name: 'Standing calf raise (DB)',      sets: 4, reps: '20',    note: 'Full ROM, pause at top' },
        { name: 'Lying leg raise',               sets: 3, reps: '15',    note: 'Lower abs' },
        { name: 'Reverse crunch',                sets: 3, reps: '15',    note: 'Curl hips up' },
        { name: 'Side plank',                    sets: 2, reps: '40 sec/side', note: 'Lateral stability' },
      ],
    },
    travel: {
      push: [
        { name: 'Push-up',                       sets: 5, reps: '15–20', note: 'Slow 3s down' },
        { name: 'Wide push-up',                  sets: 4, reps: '12–15', note: 'Chest stretch' },
        { name: 'Decline push-up',               sets: 3, reps: '12',    note: 'Feet on bed' },
        { name: 'Diamond push-up',               sets: 3, reps: '12',    note: 'Tricep focus' },
        { name: 'Pike push-up',                  sets: 3, reps: '12',    note: 'Shoulder focus' },
        { name: 'Lateral raise (no weight)',     sets: 4, reps: '20–25', note: 'Pause at top' },
        { name: 'Tricep dip (chair)',            sets: 3, reps: '15',    note: 'Slow descent' },
        { name: 'Crunch',                        sets: 3, reps: '20',    note: 'No momentum' },
        { name: 'Plank',                         sets: 3, reps: '45 sec', note: 'Full tension' },
      ],
      pull: [
        { name: 'Inverted row',                  sets: 5, reps: '10–12', note: 'Under table' },
        { name: 'Towel door row',                sets: 4, reps: '12–15', note: 'Single arm' },
        { name: 'Superman hold',                 sets: 4, reps: '12 · 2s', note: 'Rear chain' },
        { name: 'Prone Y-T-W raise',             sets: 3, reps: '10 each', note: 'Rear delt' },
        { name: 'Chin-up / pull-up',             sets: 3, reps: 'Max',   note: 'Door frame if available' },
        { name: 'Isometric curl (towel)',        sets: 3, reps: '8 · 5s', note: 'Hard contraction' },
        { name: 'Dead bug',                      sets: 3, reps: '10/side', note: 'Back flat' },
        { name: 'Bicycle crunch',                sets: 3, reps: '20/side', note: 'Slow rotation' },
        { name: 'Hollow body hold',              sets: 3, reps: '25 sec', note: 'Full core engagement' },
      ],
      legs: [
        { name: 'Bulgarian split squat',         sets: 5, reps: '12/leg', note: 'Rear foot on bed' },
        { name: 'Jump squat',                    sets: 4, reps: '15–20', note: 'Power' },
        { name: 'Walking lunge',                 sets: 4, reps: '16/leg', note: 'Corridor' },
        { name: 'Single-leg RDL',                sets: 3, reps: '12/leg', note: 'Balance focus' },
        { name: 'Sumo squat (bodyweight)',       sets: 3, reps: '20',    note: 'Glute emphasis' },
        { name: 'Single-leg calf raise',         sets: 4, reps: '20/leg', note: 'Step edge' },
        { name: 'Lying leg raise',               sets: 3, reps: '15',    note: 'Lower abs' },
        { name: 'Reverse crunch',                sets: 3, reps: '15',    note: 'Curl hips up' },
        { name: 'Side plank',                    sets: 2, reps: '40 sec/side', note: 'Lateral stability' },
      ],
    },
  },

  strength: {
    id: 'strength',
    name: 'Strength',
    subtitle: 'Heavy Compound Focus',
    goal: 'Maximize strength gains',
    weeks: 8,
    color: '#f07a7a',
    days: ['push','pull','legs'],
    schedule: ['push','rest','pull','rest','legs','rest','rest'],
    workouts: {
      push: [
        { name: 'Barbell bench press',           sets: 5, reps: '3–5',   note: 'Max intensity — long rest 3–5 min' },
        { name: 'Dumbbell overhead press',       sets: 4, reps: '5–6',   note: 'Strict, no leg drive' },
        { name: 'Dumbbell incline press',        sets: 3, reps: '6–8',   note: 'Heavy' },
        { name: 'Dumbbell lateral raise',        sets: 3, reps: '12',    note: 'Accessory' },
        { name: 'Overhead tricep ext. (DB)',     sets: 3, reps: '8–10',  note: 'Heavy, controlled' },
        { name: 'Plank',                         sets: 3, reps: '45 sec', note: 'Core stability' },
      ],
      pull: [
        { name: 'Barbell bent-over row',         sets: 5, reps: '3–5',   note: 'Max weight — match bench' },
        { name: 'Dumbbell single-arm row',       sets: 4, reps: '6–8',   note: 'Heavy, brace hard' },
        { name: 'Dumbbell chest-supported row',  sets: 3, reps: '8–10',  note: 'Strict form' },
        { name: 'Dumbbell curl (alternating)',   sets: 3, reps: '8',     note: 'Heavy' },
        { name: 'Hammer curl',                   sets: 3, reps: '8',     note: 'Heavy' },
        { name: 'Dead bug',                      sets: 3, reps: '10/side', note: 'Core stability' },
      ],
      legs: [
        { name: 'Barbell Romanian deadlift',     sets: 5, reps: '3–5',   note: 'Max weight — 3–5 min rest' },
        { name: 'Dumbbell goblet squat',         sets: 4, reps: '6–8',   note: 'Heavy — 110s' },
        { name: 'DB Bulgarian split squat',      sets: 3, reps: '6–8/leg', note: 'Heavy, controlled' },
        { name: 'Single-leg RDL',                sets: 3, reps: '8/leg',  note: 'Loaded if possible' },
        { name: 'Standing calf raise (DB)',      sets: 4, reps: '12',    note: 'Heavy, slow' },
        { name: 'Ab wheel rollout',              sets: 3, reps: '8–10',  note: 'Core anti-extension' },
      ],
    },
    travel: {
      push: [
        { name: 'Push-up (weighted if possible)',sets: 5, reps: '10–15', note: 'Use backpack for load' },
        { name: 'Pike push-up',                  sets: 4, reps: '10–12', note: 'Shoulder strength' },
        { name: 'Diamond push-up',               sets: 4, reps: '10–12', note: 'Tricep strength' },
        { name: 'Tricep dip (chair)',            sets: 3, reps: '12–15', note: 'Slow, heavy' },
        { name: 'Lateral raise (no weight)',     sets: 3, reps: '20',    note: 'Pause at top' },
        { name: 'Plank',                         sets: 3, reps: '45 sec', note: 'Core' },
      ],
      pull: [
        { name: 'Inverted row',                  sets: 5, reps: '8–10',  note: 'Feet elevated for more load' },
        { name: 'Towel door row',                sets: 4, reps: '10–12', note: 'Single arm, heavy' },
        { name: 'Chin-up / pull-up',             sets: 5, reps: 'Max',   note: 'Door frame — primary lift' },
        { name: 'Isometric curl (towel)',        sets: 3, reps: '6 · 8s', note: 'Max contraction' },
        { name: 'Superman hold',                 sets: 3, reps: '10 · 3s', note: 'Rear chain' },
        { name: 'Dead bug',                      sets: 3, reps: '10/side', note: 'Core stability' },
      ],
      legs: [
        { name: 'Bulgarian split squat',         sets: 5, reps: '10/leg', note: 'Slow — use backpack for load' },
        { name: 'Jump squat',                    sets: 5, reps: '10',    note: 'Max power' },
        { name: 'Single-leg RDL',                sets: 4, reps: '10/leg', note: 'Slow, controlled' },
        { name: 'Pistol squat (assisted)',       sets: 3, reps: '5/leg',  note: 'Use door frame for balance' },
        { name: 'Single-leg calf raise',         sets: 4, reps: '15/leg', note: 'Loaded if possible' },
        { name: 'Ab wheel / plank',              sets: 3, reps: '45 sec', note: 'Core stability' },
      ],
    },
  },
};

// ── Program state ─────────────────────────────────────
const DEFAULT_PROGRAM_STATE = {
  programId: 'cut',
  startDate: '2026-03-25',
  travelMode: false,
};

function getProgramState() {
  const saved = cacheGet('program_state');
  return saved || DEFAULT_PROGRAM_STATE;
}

function saveProgramState(state) {
  cacheSet('program_state', state);
  sbWrite('program_state', state);
}

function getActiveProgram() {
  const state = getProgramState();
  return PROGRAMS[state.programId] || PROGRAMS.cut;
}

function isTravelMode() {
  return getProgramState().travelMode || false;
}

function getProgramWeek() {
  const state = getProgramState();
  const start = new Date(state.startDate);
  const now = new Date();
  const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  return Math.min(Math.max(1, Math.floor(diffDays / 7) + 1), getActiveProgram().weeks);
}

// Build PLAN from active program for backward compat
function buildPLAN() {
  const prog = getActiveProgram();
  const travel = isTravelMode();
  const source = travel ? prog.travel : prog.workouts;
  const plan = {};
  Object.keys(source).forEach(day => {
    plan[day] = source[day];
    // Also add travel_ prefixed keys for bodyweight detection
    if (travel) plan['travel_' + day] = source[day];
  });
  return plan;
}

// Legacy PLAN — now dynamic
let PLAN = buildPLAN();

// ── Workout form ──────────────────────────────────────
let exCount = 0;
const TIMED_PATTERN = /(\d+)\s*sec/i;
const BODYWEIGHT_TYPES = ['travel_push','travel_pull','travel_legs','travel_upper_a','travel_upper_b','travel_lower_a','travel_lower_b','kb_cardio'];

function isBodyweightWorkout() {
  if (isTravelMode()) return true;
  return BODYWEIGHT_TYPES.includes(document.getElementById('workout-type').value);
}

function parseSecs(repsStr) {
  const m = String(repsStr).match(TIMED_PATTERN);
  return m ? parseInt(m[1]) : null;
}

function initWorkoutForm() {
  document.getElementById('workout-date').value = today();
  document.getElementById('exercise-blocks').innerHTML = '';
  exCount = 0;

  // Rebuild PLAN from active program + travel mode
  PLAN = buildPLAN();

  // Populate workout type select from active program
  const prog = getActiveProgram();
  const travel = isTravelMode();
  const dayLabels = { push:'Push', pull:'Pull', legs:'Legs', upper_a:'Upper A', upper_b:'Upper B', lower_a:'Lower A', lower_b:'Lower B' };
  const sel = document.getElementById('workout-type');
  sel.innerHTML = prog.days.map(d =>
    `<option value="${d}">${prog.name} — ${dayLabels[d]||d}${travel ? ' ✈' : ''}</option>`
  ).join('') + `<option disabled>──────────</option><option value="custom">Custom</option>`;

  sel.onchange = () => {
    const hint = document.getElementById('preset-hint');
    hint.style.display = PLAN[sel.value] ? 'block' : 'none';
  };
}

function buildSetRow(exId, setNum, repsDefault, isBodyweight, rowClass) {
  const isTimed = parseSecs(repsDefault) !== null;
  const secs = parseSecs(repsDefault);
  const uid = `ex${exId}s${setNum}_${Date.now()}`;

  const row = document.createElement('div');
  row.className = 'set-row' + (isBodyweight ? ' bodyweight' : '');
  row.dataset.logged = '0';

  let weightHtml = isBodyweight ? '' : `<input type="number" placeholder="lbs" step="2.5" style="font-size:13px;" onblur="persistSession()">`;

  let repHtml;
  if (isTimed) {
    repHtml = `<div class="set-timer" id="st-${uid}" data-secs="${secs}" onclick="toggleSetTimer('${uid}',${secs})">${cdFmt(secs)}</div>`;
  } else {
    const initVal = isNaN(parseInt(repsDefault)) ? 10 : parseInt(repsDefault);
    repHtml = `<div class="rep-stepper" id="rs-${uid}">
      <button class="rep-btn" onclick="stepRep('${uid}',-1)">−</button>
      <span class="rep-val" id="rv-${uid}">${initVal}</span>
      <button class="rep-btn" onclick="stepRep('${uid}',1)">+</button>
    </div>`;
  }

  row.innerHTML = `
    <span class="set-num">${setNum}</span>
    ${weightHtml}
    ${repHtml}
    <button class="btn-check" id="chk-${uid}" onclick="logSet('${uid}',${isTimed},${secs||0})" title="Mark done">✓</button>
    <button class="btn-icon" onclick="this.closest('.set-row').remove()" title="Remove">×</button>
  `;
  return row;
}

function stepRep(uid, delta) {
  const el = document.getElementById('rv-' + uid);
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  el.textContent = Math.max(0, current + delta);
}

// Per-set countdown timers
const setTimers = {};
function toggleSetTimer(uid, secs) {
  const el = document.getElementById('st-' + uid);
  if (!el) return;
  if (setTimers[uid]?.running) return;
  const st = { running: true, remaining: secs, total: secs };
  setTimers[uid] = st;
  el.classList.add('running');
  st.interval = setInterval(() => {
    st.remaining--;
    el.textContent = cdFmt(st.remaining);
    if (st.remaining <= 0) {
      clearInterval(st.interval);
      st.running = false;
      el.textContent = 'Done!';
      el.classList.remove('running');
      el.classList.add('done');
      cdBeep();
      // Auto-check the set
      logSet(uid, true, secs);
    }
  }, 1000);
}

function logSet(uid, isTimed, secs) {
  const chk = document.getElementById('chk-' + uid);
  if (!chk) return;
  const row = chk.closest('.set-row');
  if (!row || row.dataset.logged === '1') return;
  row.dataset.logged = '1';
  chk.classList.add('done');

  // Mark rep stepper as logged (full opacity)
  const rs = document.getElementById('rs-' + uid);
  if (rs) rs.classList.add('logged');

  // Auto-start rest timers
  const exBlock = row.closest('.exercise-block');
  const allRows = exBlock ? [...exBlock.querySelectorAll('.set-row')] : [];
  const isLast = allRows.indexOf(row) === allRows.length - 1;
  if (isLast) {
    cdReset('set', 60); cdReset('ex', 180); cdStart('ex', 180);
  } else {
    cdReset('set', 60); cdStart('set', 60);
  }
  if (!wtRunning && wtSeconds === 0) wtStart();

  // Push live state
  liveSync({ lastSetAt: Date.now() });
  persistSession();
}

// Exercises that are always bodyweight — no weight input
const BODYWEIGHT_EXERCISES = new Set([
  'push-up','push up','wide push-up','wide push up','diamond push-up','diamond push up',
  'decline push-up','decline push up','pike push-up','pike push up',
  'pull-up','pull up','chin-up','chin up','inverted row',
  'dip','tricep dip','chair dip',
  'bulgarian split squat','split squat','walking lunge','lunge','reverse lunge',
  'jump squat','squat (bodyweight)','sumo squat (bodyweight)',
  'glute bridge','single-leg glute bridge','single leg glute bridge',
  'single-leg rdl','single leg rdl','single leg romanian deadlift',
  'dead bug','hollow body hold','hollow rock','plank','side plank',
  'plank with shoulder tap','bicycle crunch','crunch','reverse crunch',
  'lying leg raise','hanging knee raise','ab wheel rollout','ab wheel',
  'superman hold','prone y-t-w raise','prone ytw raise',
  'towel door row','isometric bicep curl (towel)','isometric curl (towel)',
  'lateral raise (no weight)','hammer curl (no weight)',
  'burpee','mountain climber','jumping jack',
]);

function isBodyweightExercise(name) {
  return BODYWEIGHT_EXERCISES.has(name.toLowerCase().trim());
}

function getLastWeight(exerciseName) {
  // Search workout history most-recent-first for this exercise name
  const workouts = getWorkouts().sort((a,b) => b.date.localeCompare(a.date));
  for (const w of workouts) {
    for (const ex of (w.exercises || [])) {
      if (ex.name.toLowerCase().trim() === exerciseName.toLowerCase().trim()) {
        // Find highest weight used in any set
        const weights = (ex.sets || [])
          .map(s => parseFloat(s.weight))
          .filter(v => !isNaN(v) && v > 0);
        if (weights.length) return Math.max(...weights);
      }
    }
  }
  return null;
}

function loadPreset() {
  const type = document.getElementById('workout-type').value;
  const exercises = PLAN[type];
  if (!exercises) { toast('No preset for custom workouts'); return; }
  document.getElementById('exercise-blocks').innerHTML = '';
  exCount = 0;
  document.getElementById('preset-hint').style.display = 'none';
  const isTravelType = BODYWEIGHT_TYPES.includes(type);

  exercises.forEach(ex => {
    exCount++;
    const id = 'ex-' + exCount;
    const div = document.createElement('div');
    div.className = 'exercise-block';
    div.id = id;
    // Per-exercise bodyweight detection
    const bw = isTravelType || isBodyweightExercise(ex.name);
    const lastWeight = bw ? null : getLastWeight(ex.name);
    const colHeader = bw
      ? `<div style="display:grid;grid-template-columns:24px auto auto auto;gap:8px;margin-bottom:6px;font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;padding:0 0 2px 0;"><span></span><span>Reps / time</span><span></span><span></span></div>`
      : `<div style="display:grid;grid-template-columns:24px 1fr auto auto auto;gap:8px;margin-bottom:6px;font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;padding:0 0 2px 0;"><span></span><span>Weight (lbs)</span><span>Reps / time</span><span></span><span></span></div>`;
    const weightHint = lastWeight ? `<span style="font-size:10px;color:var(--accent);margin-top:2px;font-family:'DM Mono',monospace;">↑ last: ${lastWeight} lbs</span>` : '';
    div.innerHTML = `
      <div class="ex-header">
        <div style="flex:1;">
          <input type="text" value="${ex.name}" style="width:100%;background:transparent;border:none;border-bottom:1px solid var(--border2);border-radius:0;padding:4px 0;font-size:14px;font-weight:500;color:var(--text);" class="ex-name-input">
          <div style="font-size:11px;color:var(--text3);margin-top:3px;font-family:'DM Mono',monospace;">${ex.note}</div>
          ${weightHint}
        </div>
        <button class="btn-icon" onclick="document.getElementById('${id}').remove()" title="Remove" style="margin-left:10px;">×</button>
      </div>
      ${colHeader}
      <div class="set-rows-${exCount}"></div>
      <button class="btn btn-ghost btn-sm" onclick="addSet(${exCount})" style="margin-top:6px;">+ Set</button>
    `;
    document.getElementById('exercise-blocks').appendChild(div);
    const container = div.querySelector('.set-rows-' + exCount);
    for (let s = 1; s <= ex.sets; s++) {
      const row = buildSetRow(exCount, s, ex.reps, bw);
      // Pre-fill last weight into the weight input
      if (lastWeight) {
        const weightInput = row.querySelector('input[type="number"]');
        if (weightInput) weightInput.value = lastWeight;
      }
      container.appendChild(row);
    }
  });
  toast('Plan loaded — weights pre-filled from last session');
}

function applyLastWeightToBlock(exId) {
  const block = document.getElementById('ex-' + exId);
  if (!block) return;
  const name = block.querySelector('.ex-name-input')?.value?.trim();
  if (!name) return;
  const lastWeight = getLastWeight(name);
  if (!lastWeight) return;
  block.querySelectorAll('.set-rows-' + exId + ' input[type="number"]').forEach(inp => {
    if (!inp.value) inp.value = lastWeight;
  });
  let hint = block.querySelector('.weight-hint');
  if (!hint) {
    hint = document.createElement('span');
    hint.className = 'weight-hint';
    hint.style.cssText = 'font-size:10px;color:var(--accent);margin-top:2px;font-family:"DM Mono",monospace;display:block;';
    const nameWrap = block.querySelector('.ex-header > div') || block.querySelector('.ex-header');
    if (nameWrap) nameWrap.appendChild(hint);
  }
  hint.textContent = `↑ last: ${lastWeight} lbs`;
}

function addExercise() {
  exCount++;
  const id = 'ex-' + exCount;
  const currentCount = exCount;
  const isBodyweight = isBodyweightWorkout();
  const div = document.createElement('div');
  div.className = 'exercise-block';
  div.id = id;
  const colHeader = isBodyweight
    ? `<div style="display:grid;grid-template-columns:24px auto auto auto;gap:8px;margin-bottom:6px;font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;"><span></span><span>Reps / time</span><span></span><span></span></div>`
    : `<div style="display:grid;grid-template-columns:24px 1fr auto auto auto;gap:8px;margin-bottom:6px;font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;"><span></span><span>Weight (lbs)</span><span>Reps</span><span></span><span></span></div>`;
  div.innerHTML = `
    <div class="ex-header">
      <div style="flex:1;">
        <input type="text" placeholder="Exercise name" style="width:100%;background:transparent;border:none;border-bottom:1px solid var(--border2);border-radius:0;padding:4px 0;font-size:14px;font-weight:500;color:var(--text);" class="ex-name-input">
      </div>
      <button class="btn-icon" onclick="document.getElementById('${id}').remove()" title="Remove" style="margin-left:10px;">×</button>
    </div>
    ${colHeader}
    <div class="set-rows-${currentCount}"></div>
    <button class="btn btn-ghost btn-sm" onclick="addSet(${currentCount})" style="margin-top:6px;">+ Set</button>
  `;
  document.getElementById('exercise-blocks').appendChild(div);
  div.querySelector('.ex-name-input').addEventListener('blur', () => applyLastWeightToBlock(currentCount));
  addSet(currentCount);
}

function addSet(exId) {
  const container = document.querySelector('.set-rows-' + exId);
  const setNum = container.children.length + 1;
  const exBlock = container.closest('.exercise-block');
  const exName = exBlock?.querySelector('.ex-name-input')?.value || '';
  const bw = isBodyweightWorkout() || isBodyweightExercise(exName);
  const row = buildSetRow(exId, setNum, '10', bw);
  if (!bw && exName) {
    const lastWeight = getLastWeight(exName);
    if (lastWeight) {
      const weightInput = row.querySelector('input[type="number"]');
      if (weightInput) weightInput.value = lastWeight;
    }
  }
  container.appendChild(row);
}

function saveWorkout() {
  const date = document.getElementById('workout-date').value;
  const type = document.getElementById('workout-type').value;
  const notes = document.getElementById('workout-notes').value;
  if (!date) { toast('Please set a date'); return; }

  const exercises = [];
  document.querySelectorAll('.exercise-block').forEach(block => {
    const name = block.querySelector('.ex-name-input')?.value.trim();
    if (!name) return;
    const sets = [];
    block.querySelectorAll('.set-row').forEach(row => {
      const weightInput = row.querySelector('input[type="number"]');
      const weight = weightInput ? weightInput.value : '';
      // Get reps from stepper or timed display
      const repVal = row.querySelector('.rep-val');
      const setTimer = row.querySelector('.set-timer');
      const reps = repVal ? repVal.textContent : (setTimer ? setTimer.dataset.secs + 's' : '');
      const logged = row.dataset.logged === '1';
      if (logged || weight || reps) sets.push({ weight, reps, logged });
    });
    if (sets.length) exercises.push({ name, sets });
  });

  const workouts = getWorkouts();
  workouts.push({ id: Date.now(), date, type, notes, exercises });
  saveWorkouts(workouts);
  toast('Workout saved ✓');
  clearPersistedSession();
  document.getElementById('workout-notes').value = '';
  document.getElementById('exercise-blocks').innerHTML = '';
  exCount = 0;
  addExercise();
  // Clear live session
  sbWrite('live_session', null);
}

// ── Live session sync (Supabase real-time) ────────────
let liveChannel = null;
let liveDebounce = null;
let isReceiving = false;

// ── Session persistence (survive page reload) ─────────
const SESSION_KEY = 'acct_live_session';

function persistSession() {
  // Write synchronously to localStorage immediately — no debounce
  const session = {
    ts: Date.now(),
    wtSeconds,
    wtRunning,
    workoutType: document.getElementById('workout-type')?.value || '',
    workoutDate: document.getElementById('workout-date')?.value || today(),
    workoutNotes: document.getElementById('workout-notes')?.value || '',
    exercises: serializeSession()
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearPersistedSession() {
  localStorage.removeItem(SESSION_KEY);
}

function restoreSessionIfExists() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return false;
  try {
    const session = JSON.parse(raw);
    // Only restore if session is less than 12 hours old and has exercises
    const age = Date.now() - (session.ts || 0);
    if (age > 12 * 60 * 60 * 1000) { clearPersistedSession(); return false; }
    if (!session.exercises || !session.exercises.length) { clearPersistedSession(); return false; }

    // Navigate to log workout page
    navTo('log-workout');

    // Restore date, type, notes
    const dateEl = document.getElementById('workout-date');
    const typeEl = document.getElementById('workout-type');
    const notesEl = document.getElementById('workout-notes');
    if (dateEl && session.workoutDate) dateEl.value = session.workoutDate;
    if (notesEl && session.workoutNotes) notesEl.value = session.workoutNotes;

    // Restore workout type if it exists in select
    if (typeEl && session.workoutType) {
      const opt = [...typeEl.options].find(o => o.value === session.workoutType);
      if (opt) typeEl.value = session.workoutType;
    }

    // Restore exercises
    document.getElementById('exercise-blocks').innerHTML = '';
    exCount = 0;
    const prog = getActiveProgram();
    const travel = isTravelMode();

    session.exercises.forEach(ex => {
      if (!ex.name) return;
      exCount++;
      const id = 'ex-' + exCount;
      const bw = isBodyweightExercise(ex.name) || travel;
      const div = document.createElement('div');
      div.className = 'exercise-block';
      div.id = id;
      const colHeader = bw
        ? `<div style="display:grid;grid-template-columns:24px auto auto auto;gap:8px;margin-bottom:6px;font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;"><span></span><span>Reps / time</span><span></span><span></span></div>`
        : `<div style="display:grid;grid-template-columns:24px 1fr auto auto auto;gap:8px;margin-bottom:6px;font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;"><span></span><span>Weight (lbs)</span><span>Reps</span><span></span><span></span></div>`;
      div.innerHTML = `
        <div class="ex-header">
          <div style="flex:1;">
            <input type="text" value="${ex.name}" style="width:100%;background:transparent;border:none;border-bottom:1px solid var(--border2);border-radius:0;padding:4px 0;font-size:14px;font-weight:500;color:var(--text);" class="ex-name-input">
          </div>
          <button class="btn-icon" onclick="document.getElementById('${id}').remove()" title="Remove" style="margin-left:10px;">×</button>
        </div>
        ${colHeader}
        <div class="set-rows-${exCount}"></div>
        <button class="btn btn-ghost btn-sm" onclick="addSet(${exCount})" style="margin-top:6px;">+ Set</button>
      `;
      document.getElementById('exercise-blocks').appendChild(div);
      const container = div.querySelector('.set-rows-' + exCount);
      (ex.sets || []).forEach((set, i) => {
        const row = buildSetRow(exCount, i + 1, set.reps || '10', bw);
        const weightInput = row.querySelector('input[type="number"]');
        if (weightInput && set.weight) weightInput.value = set.weight;
        const repVal = row.querySelector('.rep-val');
        if (repVal && set.reps) repVal.textContent = parseInt(set.reps) || set.reps;
        if (set.logged) {
          row.dataset.logged = '1';
          row.querySelector('.btn-check')?.classList.add('done');
          row.querySelector('.rep-stepper')?.classList.add('logged');
        }
        container.appendChild(row);
      });
    });

    // Restore workout clock
    if (session.wtSeconds > 0) {
      wtSeconds = session.wtSeconds;
      const clk = document.getElementById('wt-clock');
      if (clk) clk.textContent = wtFmt(wtSeconds);
    }

    toast('↩ Workout restored from before reload');
    timerShow();
    return true;
  } catch(e) {
    clearPersistedSession();
    return false;
  }
}

// Warn on accidental reload/close during active workout
function setupBeforeUnload() {
  window.addEventListener('beforeunload', e => {
    const hasSession = localStorage.getItem(SESSION_KEY);
    const hasBlocks = document.querySelectorAll('.exercise-block').length > 0;
    const onWorkoutPage = document.getElementById('page-log-workout')?.classList.contains('active');
    if (hasSession && hasBlocks && onWorkoutPage) {
      e.preventDefault();
      e.returnValue = 'You have an unsaved workout in progress. Are you sure you want to leave?';
      return e.returnValue;
    }
  });
}

function liveSync(patch) {
  if (isReceiving) return;
  clearTimeout(liveDebounce);
  liveDebounce = setTimeout(async () => {
    const session = {
      ts: Date.now(),
      wtSeconds,
      wtRunning,
      exercises: serializeSession(),
      ...patch
    };
    await sbWrite('live_session', session);
  }, 300);
}

function serializeSession() {
  const blocks = [];
  document.querySelectorAll('.exercise-block').forEach(block => {
    const name = block.querySelector('.ex-name-input')?.value || '';
    const sets = [];
    block.querySelectorAll('.set-row').forEach(row => {
      const weightInput = row.querySelector('input[type="number"]');
      const repVal = row.querySelector('.rep-val');
      const setTimer = row.querySelector('.set-timer');
      sets.push({
        weight: weightInput?.value || '',
        reps: repVal ? repVal.textContent : (setTimer?.dataset.secs + 's' || ''),
        logged: row.dataset.logged === '1'
      });
    });
    blocks.push({ name, sets });
  });
  return blocks;
}

function startLiveSync() {
  if (liveChannel) liveChannel.unsubscribe();
  document.getElementById('live-dot').style.display = '';

  liveChannel = {
    _poll: setInterval(async () => {
      const data = await sbRead('live_session');
      if (!data || !data.ts) return;
      // Only apply if from another device (timestamp differs by >2s from local)
      if (Math.abs(data.ts - Date.now()) < 2000) return;
      applyLiveSession(data);
    }, 3000),
    unsubscribe() { clearInterval(this._poll); }
  };
}

function stopLiveSync() {
  if (liveChannel) { liveChannel.unsubscribe(); liveChannel = null; }
  document.getElementById('live-dot').style.display = 'none';
}

function applyLiveSession(data) {
  isReceiving = true;
  // Sync workout clock
  if (data.wtSeconds !== undefined) {
    wtSeconds = data.wtSeconds;
    const clk = document.getElementById('wt-clock');
    if (clk) clk.textContent = wtFmt(wtSeconds);
  }
  isReceiving = false;
}

// ── Run log ───────────────────────────────────────────
function saveRun() {
  const date = document.getElementById('run-date').value;
  const type = document.getElementById('run-type').value;
  const distance = document.getElementById('run-distance').value;
  const duration = document.getElementById('run-duration').value;
  const pace = document.getElementById('run-pace').value;
  const notes = document.getElementById('run-notes').value;
  if (!date) { toast('Please set a date'); return; }

  const runs = getRuns();
  runs.push({ id: Date.now(), date, type, distance, duration, pace, notes });
  saveRuns(runs);
  toast('Run saved ✓');
  ['run-distance','run-duration','run-pace','run-notes'].forEach(id => document.getElementById(id).value = '');
}

// ── Body stats ────────────────────────────────────────
function saveStats() {
  const date = document.getElementById('stats-date').value;
  const weight = document.getElementById('stats-weight').value;
  const waist = document.getElementById('stats-waist').value;
  const chest = document.getElementById('stats-chest').value;
  const hips = document.getElementById('stats-hips').value;
  const notes = document.getElementById('stats-notes').value;
  if (!date) { toast('Please set a date'); return; }

  const stats = getStats();
  stats.push({ id: Date.now(), date, weight, waist, chest, hips, notes });
  saveBodyStats(stats);
  toast('Stats saved ✓');
  renderStatsTable();
  ['stats-weight','stats-waist','stats-chest','stats-hips','stats-notes'].forEach(id => document.getElementById(id).value = '');
}

function renderStatsTable() {
  const dateEl = document.getElementById('stats-date');
  if (dateEl) dateEl.value = today();
  const stats = getStats().sort((a,b) => b.date.localeCompare(a.date));
  const tbody = document.getElementById('stats-table-body');
  const empty = document.getElementById('stats-empty');
  if (!tbody) return;
  if (stats.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  tbody.innerHTML = stats.map(s => `
    <tr>
      <td class="num">${s.date}</td>
      <td class="num">${s.weight ? s.weight + ' lbs' : '—'}</td>
      <td class="num">${s.waist ? s.waist + '"' : '—'}</td>
      <td class="num">${s.chest ? s.chest + '"' : '—'}</td>
      <td class="num">${s.hips ? s.hips + '"' : '—'}</td>
      <td style="color:var(--text3);font-size:12px;">${s.notes || ''}</td>
      <td style="white-space:nowrap;display:flex;gap:4px;">
        <button class="btn btn-ghost btn-sm" onclick="editStat(${s.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteStat(${s.id})">Delete</button>
      </td>
    </tr>`).join('');
}

function deleteStat(id) {
  saveBodyStats(getStats().filter(s => s.id !== id));
  renderStatsTable();
  toast('Entry deleted');
}

function editStat(id) {
  const s = getStats().find(s => s.id === id);
  if (!s) return;
  document.getElementById('stats-date').value = s.date;
  document.getElementById('stats-weight').value = s.weight || '';
  document.getElementById('stats-waist').value = s.waist || '';
  document.getElementById('stats-chest').value = s.chest || '';
  document.getElementById('stats-hips').value = s.hips || '';
  document.getElementById('stats-notes').value = s.notes || '';
  const btn = document.querySelector('#page-body-stats .btn-primary');
  if (btn) { btn.textContent = 'Update entry'; btn.setAttribute('onclick', `updateStat(${id})`); }
  document.querySelector('#page-body-stats .card').scrollIntoView({ behavior: 'smooth' });
  toast('Editing entry — make changes and save');
}

function updateStat(id) {
  const stats = getStats().filter(s => s.id !== id);
  stats.push({ id, date: document.getElementById('stats-date').value, weight: document.getElementById('stats-weight').value, waist: document.getElementById('stats-waist').value, chest: document.getElementById('stats-chest').value, hips: document.getElementById('stats-hips').value, notes: document.getElementById('stats-notes').value });
  saveBodyStats(stats);
  toast('Entry updated ✓');
  const btn = document.querySelector('#page-body-stats .btn-primary');
  if (btn) { btn.textContent = 'Save entry'; btn.setAttribute('onclick', 'saveStats()'); }
  ['stats-weight','stats-waist','stats-chest','stats-hips','stats-notes'].forEach(id => document.getElementById(id).value = '');
  renderStatsTable();
}

// ── History ───────────────────────────────────────────
let historyFilter = 'all';
function filterHistory(f) {
  historyFilter = f;
  document.querySelectorAll('[id^="filter-"]').forEach(b => { b.style.borderColor = ''; b.style.color = ''; });
  const btn = document.getElementById('filter-' + f);
  if (btn) { btn.style.borderColor = 'var(--accent)'; btn.style.color = 'var(--accent)'; }
  renderHistory(f);
}

function renderHistory(filter) {
  const workouts = getWorkouts().map(w => ({ ...w, kind: 'workout' }));
  const runs = getRuns().map(r => ({ ...r, kind: 'run' }));
  let all = [...workouts, ...runs].sort((a,b) => b.date.localeCompare(a.date));
  if (filter !== 'all') {
    if (filter === 'run') all = all.filter(a => a.kind === 'run');
    else all = all.filter(a => a.kind === 'workout' && a.type === filter);
  }

  const tbody = document.getElementById('history-tbody');
  const empty = document.getElementById('history-empty');
  if (all.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  tbody.innerHTML = all.map(a => {
    const tag = a.kind === 'run'
      ? `<span class="tag tag-run">${a.type === 'interval' ? 'intervals' : a.type === 'walk' ? 'walk' : a.type === 'run' ? 'run' : a.type}</span>`
      : `<span class="tag tag-${a.type}">${a.type}</span>`;
    const detail = a.kind === 'run'
      ? `${a.distance || '—'} mi · ${a.duration || '—'} min · ${a.pace || '—'} /mi`
      : (a.exercises||[]).map(e => `<span style="display:inline-block;margin-right:8px;">${e.name} <span style="color:var(--text3)">(${e.sets.length} sets)</span></span>`).join('');
    const delFn = a.kind === 'run' ? `deleteRun(${a.id})` : `deleteWorkout(${a.id})`;
    const editFn = a.kind === 'run' ? `editRun(${a.id})` : `editWorkout(${a.id})`;
    return `<tr>
      <td class="num" style="white-space:nowrap">${a.date}</td>
      <td>${tag}</td>
      <td style="font-size:12px;color:var(--text2);">${detail}</td>
      <td style="font-size:12px;color:var(--text3);">${(a.notes||'').slice(0,50)}</td>
      <td style="white-space:nowrap;display:flex;gap:4px;">
        <button class="btn btn-ghost btn-sm" onclick="${editFn}">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="${delFn}">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

function deleteWorkout(id) { saveWorkouts(getWorkouts().filter(w => w.id !== id)); renderHistory(historyFilter); toast('Deleted'); }
function deleteRun(id) { saveRuns(getRuns().filter(r => r.id !== id)); renderHistory(historyFilter); toast('Deleted'); }

function editRun(id) {
  const run = getRuns().find(r => r.id === id);
  if (!run) return;
  // Navigate to log run and pre-populate
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-log-run').classList.add('active');
  document.getElementById('run-date').value = run.date;
  document.getElementById('run-type').value = run.type || 'steady';
  document.getElementById('run-distance').value = run.distance || '';
  document.getElementById('run-duration').value = run.duration || '';
  document.getElementById('run-pace').value = run.pace || '';
  document.getElementById('run-notes').value = run.notes || '';
  // Change save button to update
  const btn = document.querySelector('#page-log-run .btn-primary');
  btn.textContent = 'Update run';
  btn.onclick = () => updateRun(id);
  toast('Editing run — make changes and save');
}

function updateRun(id) {
  const runs = getRuns().filter(r => r.id !== id);
  runs.push({
    id,
    strava_id: getRuns().find(r => r.id === id)?.strava_id,
    date: document.getElementById('run-date').value,
    type: document.getElementById('run-type').value,
    distance: document.getElementById('run-distance').value,
    duration: document.getElementById('run-duration').value,
    pace: document.getElementById('run-pace').value,
    notes: document.getElementById('run-notes').value,
  });
  saveRuns(runs);
  toast('Run updated ✓');
  // Reset save button
  const btn = document.querySelector('#page-log-run .btn-primary');
  btn.textContent = 'Save run';
  btn.onclick = saveRun;
  ['run-distance','run-duration','run-pace','run-notes'].forEach(id => document.getElementById(id).value = '');
}

function editWorkout(id) {
  const workout = getWorkouts().find(w => w.id === id);
  if (!workout) return;
  // Navigate to log workout
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-log-workout').classList.add('active');
  initWorkoutForm();
  resetTimers();
  timerShow();
  document.getElementById('workout-date').value = workout.date;
  document.getElementById('workout-type').value = workout.type || 'push';
  document.getElementById('workout-notes').value = workout.notes || '';
  // Pre-fill exercises
  document.getElementById('exercise-blocks').innerHTML = '';
  exCount = 0;
  const isBodyweight = BODYWEIGHT_TYPES.includes(workout.type);
  (workout.exercises || []).forEach(ex => {
    exCount++;
    const id = 'ex-' + exCount;
    const div = document.createElement('div');
    div.className = 'exercise-block';
    div.id = id;
    const colHeader = isBodyweight
      ? `<div style="display:grid;grid-template-columns:24px auto auto auto;gap:8px;margin-bottom:6px;font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;"><span></span><span>Reps / time</span><span></span><span></span></div>`
      : `<div style="display:grid;grid-template-columns:24px 1fr auto auto auto;gap:8px;margin-bottom:6px;font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;"><span></span><span>Weight (lbs)</span><span>Reps</span><span></span><span></span></div>`;
    div.innerHTML = `
      <div class="ex-header">
        <div style="flex:1;">
          <input type="text" value="${ex.name}" style="width:100%;background:transparent;border:none;border-bottom:1px solid var(--border2);border-radius:0;padding:4px 0;font-size:14px;font-weight:500;color:var(--text);" class="ex-name-input">
        </div>
        <button class="btn-icon" onclick="document.getElementById('${id}').remove()" title="Remove" style="margin-left:10px;">×</button>
      </div>
      ${colHeader}
      <div class="set-rows-${exCount}"></div>
      <button class="btn btn-ghost btn-sm" onclick="addSet(${exCount})" style="margin-top:6px;">+ Set</button>
    `;
    document.getElementById('exercise-blocks').appendChild(div);
    const container = div.querySelector('.set-rows-' + exCount);
    (ex.sets || []).forEach((set, i) => {
      const row = buildSetRow(exCount, i + 1, set.reps || '10', isBodyweight);
      // Pre-fill weight
      const weightInput = row.querySelector('input[type="number"]');
      if (weightInput && set.weight) weightInput.value = set.weight;
      // Pre-fill reps in stepper
      const repVal = row.querySelector('.rep-val');
      if (repVal && set.reps) repVal.textContent = parseInt(set.reps) || set.reps;
      if (set.logged) { row.dataset.logged = '1'; row.querySelector('.btn-check')?.classList.add('done'); row.querySelector('.rep-stepper')?.classList.add('logged'); }
      container.appendChild(row);
    });
  });
  // Change save button to update
  const btn = document.querySelector('#page-log-workout .btn-primary[onclick="saveWorkout()"]');
  if (btn) { btn.textContent = 'Update workout'; btn.setAttribute('onclick', `updateWorkout(${id})`); }
  toast('Editing workout — make changes and save');
}

function updateWorkout(id) {
  const date = document.getElementById('workout-date').value;
  const type = document.getElementById('workout-type').value;
  const notes = document.getElementById('workout-notes').value;
  const exercises = [];
  document.querySelectorAll('.exercise-block').forEach(block => {
    const name = block.querySelector('.ex-name-input')?.value.trim();
    if (!name) return;
    const sets = [];
    block.querySelectorAll('.set-row').forEach(row => {
      const weightInput = row.querySelector('input[type="number"]');
      const repVal = row.querySelector('.rep-val');
      const setTimer = row.querySelector('.set-timer');
      sets.push({ weight: weightInput?.value || '', reps: repVal ? repVal.textContent : (setTimer?.dataset.secs + 's' || ''), logged: row.dataset.logged === '1' });
    });
    if (sets.length) exercises.push({ name, sets });
  });
  const workouts = getWorkouts().filter(w => w.id !== id);
  workouts.push({ id, date, type, notes, exercises });
  saveWorkouts(workouts);
  toast('Workout updated ✓');
  // Reset save button
  const btn = document.querySelector(`#page-log-workout .btn-primary`);
  if (btn) { btn.textContent = 'Save workout'; btn.setAttribute('onclick', 'saveWorkout()'); }
  document.getElementById('exercise-blocks').innerHTML = '';
  exCount = 0;
  addExercise();
}

// ── Charts ────────────────────────────────────────────
let chartInstances = {};
let chartRangeDays = 30;

function setChartRange(days, el) {
  chartRangeDays = days;
  document.querySelectorAll('#chart-range-btns .btn').forEach(b => { b.style.borderColor = ''; b.style.color = ''; });
  el.style.borderColor = 'var(--accent)'; el.style.color = 'var(--accent)';
  renderCharts();
}

function chartDefaults() {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1f2120', titleColor: '#8a9189', bodyColor: '#e8ebe8', borderColor: '#272927', borderWidth: 1 } },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#5a615a', font: { family: 'DM Mono', size: 10 }, maxTicksLimit: 8 } },
      y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#5a615a', font: { family: 'DM Mono', size: 10 } } }
    }
  };
}

function filterByRange(items, dateKey) {
  if (!chartRangeDays) return items;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - chartRangeDays);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  return items.filter(i => (i[dateKey] || '') >= cutoffStr);
}

function destroyChart(key) {
  if (chartInstances[key]) { chartInstances[key].destroy(); delete chartInstances[key]; }
}

function renderCharts() {
  const allStats    = getStats().sort((a,b) => a.date.localeCompare(b.date));
  const allWorkouts = getWorkouts();
  const allRuns     = getRuns();

  const stats    = filterByRange(allStats, 'date');
  const workouts = filterByRange(allWorkouts, 'date');
  const runs     = filterByRange(allRuns, 'date');

  // ── Summary stats ──
  const totalVol = workouts.reduce((sum, w) => {
    (w.exercises||[]).forEach(ex => (ex.sets||[]).forEach(s => {
      const w = parseFloat(s.weight) || 0;
      const r = parseInt(s.reps) || 0;
      sum += w * r;
    }));
    return sum;
  }, 0);
  const totalMiles = runs.reduce((s,r) => s + (parseFloat(r.distance)||0), 0);
  const avgWeight = stats.length ? (stats.reduce((s,st) => s + (parseFloat(st.weight)||0), 0) / stats.filter(s=>s.weight).length) : 0;

  document.getElementById('cs-workouts').textContent = workouts.length;
  document.getElementById('cs-volume').textContent = totalVol > 1000 ? (totalVol/1000).toFixed(1) + 'k' : Math.round(totalVol);
  document.getElementById('cs-miles').textContent = totalMiles.toFixed(1);
  document.getElementById('cs-weight').textContent = avgWeight ? avgWeight.toFixed(1) : '—';

  // ── Weight chart ──
  destroyChart('weight');
  const wCtx = document.getElementById('chart-weight').getContext('2d');
  chartInstances.weight = new Chart(wCtx, {
    type: 'line',
    data: {
      labels: stats.filter(s=>s.weight).map(s => s.date),
      datasets: [
        { data: stats.filter(s=>s.weight).map(s => parseFloat(s.weight)||null), borderColor: '#b8f07a', backgroundColor: 'rgba(184,240,122,0.06)', pointBackgroundColor: '#b8f07a', pointRadius: 3, tension: 0.3, fill: true },
        { data: stats.filter(s=>s.weight).map(() => 222), borderColor: 'rgba(240,122,122,0.35)', borderDash: [4,4], pointRadius: 0, fill: false }
      ]
    },
    options: { ...chartDefaults(), plugins: { ...chartDefaults().plugins, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: { label: ctx => ctx.datasetIndex === 0 ? ctx.parsed.y + ' lbs' : 'Goal: 222 lbs' } } } }
  });

  // ── Weekly volume ──
  const volByWeek = {};
  workouts.forEach(w => {
    const wk = weekStart(w.date);
    if (!volByWeek[wk]) volByWeek[wk] = 0;
    (w.exercises||[]).forEach(ex => (ex.sets||[]).forEach(s => {
      volByWeek[wk] += (parseFloat(s.weight)||0) * (parseInt(s.reps)||0);
    }));
  });
  const volKeys = Object.keys(volByWeek).sort();
  destroyChart('volume');
  const volCtx = document.getElementById('chart-volume').getContext('2d');
  chartInstances.volume = new Chart(volCtx, {
    type: 'bar',
    data: { labels: volKeys.map(k => k.slice(5)), datasets: [{ data: volKeys.map(k => Math.round(volByWeek[k])), backgroundColor: 'rgba(127,119,221,0.3)', borderColor: '#7F77DD', borderWidth: 1, borderRadius: 3 }] },
    options: { ...chartDefaults(), plugins: { ...chartDefaults().plugins, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: { label: ctx => ctx.parsed.y.toLocaleString() + ' lbs' } } } }
  });

  // ── Weekly miles ──
  const milesByWeek = {};
  runs.forEach(r => {
    const wk = weekStart(r.date);
    milesByWeek[wk] = (milesByWeek[wk] || 0) + (parseFloat(r.distance)||0);
  });
  const milesKeys = Object.keys(milesByWeek).sort();
  destroyChart('miles');
  const milesCtx = document.getElementById('chart-miles').getContext('2d');
  chartInstances.miles = new Chart(milesCtx, {
    type: 'bar',
    data: { labels: milesKeys.map(k => k.slice(5)), datasets: [{ data: milesKeys.map(k => parseFloat(milesByWeek[k].toFixed(2))), backgroundColor: 'rgba(122,184,240,0.3)', borderColor: '#7ab8f0', borderWidth: 1, borderRadius: 3 }] },
    options: { ...chartDefaults(), plugins: { ...chartDefaults().plugins, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: { label: ctx => ctx.parsed.y + ' mi' } } } }
  });

  // ── 1RM — populate exercise selector ──
  const exNames = new Set();
  allWorkouts.forEach(w => (w.exercises||[]).forEach(ex => { if (ex.name) exNames.add(ex.name); }));
  const sel = document.getElementById('orm-exercise');
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">— select exercise —</option>' + [...exNames].sort().map(n => `<option value="${n}" ${n===currentVal?'selected':''}>${n}</option>`).join('');

  destroyChart('orm');
  const ormCtx = document.getElementById('chart-orm').getContext('2d');
  if (sel.value) {
    const ormData = [];
    allWorkouts.filter(w => filterByRange([w],'date').length).forEach(w => {
      (w.exercises||[]).filter(e => e.name === sel.value).forEach(ex => {
        (ex.sets||[]).forEach(s => {
          const wt = parseFloat(s.weight);
          const rp = parseInt(s.reps);
          if (wt > 0 && rp > 0 && rp < 37) {
            const orm = wt * (36 / (37 - rp));
            ormData.push({ date: w.date, orm: Math.round(orm) });
          }
        });
      });
    });
    const ormByDate = {};
    ormData.forEach(d => { ormByDate[d.date] = Math.max(ormByDate[d.date]||0, d.orm); });
    const ormKeys = Object.keys(ormByDate).sort();
    chartInstances.orm = new Chart(ormCtx, {
      type: 'line',
      data: { labels: ormKeys, datasets: [{ data: ormKeys.map(k => ormByDate[k]), borderColor: '#f0c87a', backgroundColor: 'rgba(240,200,122,0.06)', pointBackgroundColor: '#f0c87a', pointRadius: 4, tension: 0.3, fill: true }] },
      options: { ...chartDefaults(), plugins: { ...chartDefaults().plugins, tooltip: { ...chartDefaults().plugins.tooltip, callbacks: { label: ctx => 'Est. 1RM: ' + ctx.parsed.y + ' lbs' } } } }
    });
  } else {
    chartInstances.orm = new Chart(ormCtx, { type: 'line', data: { labels: [], datasets: [] }, options: chartDefaults() });
    // Show placeholder
    ormCtx.fillStyle = '#5a615a';
    ormCtx.font = '13px DM Mono';
    ormCtx.textAlign = 'center';
    ormCtx.fillText('Select an exercise above', ormCtx.canvas.width/2, 100);
  }

  // ── Activity calendar heatmap ──
  renderCalendar(allWorkouts, allRuns);
}

function weekStart(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

function renderCalendar(workouts, runs) {
  const container = document.getElementById('chart-calendar');
  if (!container) return;

  // Build activity map
  const actMap = {};
  workouts.forEach(w => { actMap[w.date] = (actMap[w.date]||0) + 1; });
  runs.forEach(r => { actMap[r.date] = (actMap[r.date]||0) + 1; });

  // Last 26 weeks (6 months)
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 181);
  // Align to Monday
  while (startDate.getDay() !== 1) startDate.setDate(startDate.getDate() - 1);

  const weeks = [];
  let cur = new Date(startDate);
  while (cur <= today) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const ds = cur.toISOString().split('T')[0];
      week.push({ date: ds, count: actMap[ds]||0, future: cur > today });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }

  const dayLabels = ['M','T','W','T','F','S','S'];
  const cellSize = 14, gap = 3;

  let html = `<div style="display:flex;gap:${gap}px;align-items:flex-start;">`;
  // Day labels
  html += `<div style="display:flex;flex-direction:column;gap:${gap}px;padding-top:18px;">`;
  dayLabels.forEach(l => html += `<div style="width:10px;height:${cellSize}px;font-size:9px;color:var(--text3);font-family:'DM Mono',monospace;line-height:${cellSize}px;text-align:right;">${l}</div>`);
  html += `</div>`;

  // Weeks
  weeks.forEach(week => {
    // Month label on top of first day of new month
    const firstDay = week[0];
    const monthLabel = firstDay.date.slice(5,7) === firstDay.date.slice(5,7) && new Date(firstDay.date).getDate() <= 7
      ? new Date(firstDay.date).toLocaleDateString('en-US',{month:'short'})
      : '';

    html += `<div style="display:flex;flex-direction:column;gap:${gap}px;">`;
    html += `<div style="height:14px;font-size:9px;color:var(--text3);font-family:'DM Mono',monospace;">${new Date(firstDay.date).getDate() <= 7 ? new Date(firstDay.date).toLocaleDateString('en-US',{month:'short'}) : ''}</div>`;
    week.forEach(day => {
      const c = day.count;
      const bg = day.future ? 'transparent' :
        c === 0 ? 'var(--surface3)' :
        c === 1 ? 'rgba(184,240,122,0.3)' :
        c === 2 ? 'rgba(184,240,122,0.55)' :
                  '#b8f07a';
      html += `<div title="${day.date}${c ? ': '+c+' session'+(c>1?'s':'') : ''}" style="width:${cellSize}px;height:${cellSize}px;border-radius:3px;background:${bg};cursor:${c?'pointer':'default'};" ${c ? `onclick="showDayDetail('${day.date}')"` : ''}></div>`;
    });
    html += `</div>`;
  });

  html += `</div>`;
  // Legend
  html += `<div style="display:flex;align-items:center;gap:6px;margin-top:10px;font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;">
    <span>Less</span>
    <div style="width:12px;height:12px;border-radius:2px;background:var(--surface3);"></div>
    <div style="width:12px;height:12px;border-radius:2px;background:rgba(184,240,122,0.3);"></div>
    <div style="width:12px;height:12px;border-radius:2px;background:rgba(184,240,122,0.55);"></div>
    <div style="width:12px;height:12px;border-radius:2px;background:#b8f07a;"></div>
    <span>More</span>
  </div>`;
  container.innerHTML = html;
}

function showDayDetail(date) {
  const workouts = getWorkouts().filter(w => w.date === date);
  const runs = getRuns().filter(r => r.date === date);
  const parts = [];
  workouts.forEach(w => parts.push(w.type + ' workout'));
  runs.forEach(r => parts.push(r.distance + ' mi run'));
  toast(date + ': ' + parts.join(', '));
}

// ── Nutrition insights ────────────────────────────────
let nutritionRangeDays = 7;
let ntrCalChart = null;
let ntrMacroChart = null;

function setNutritionRange(days, el) {
  nutritionRangeDays = days;
  document.querySelectorAll('[id^="ntr-btn-"]').forEach(b => { b.style.borderColor = ''; b.style.color = ''; });
  el.style.borderColor = 'var(--accent)'; el.style.color = 'var(--accent)';
  renderNutritionInsights();
}

function renderNutritionInsights() {
  const meals = getMeals();
  if (!meals.length) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - nutritionRangeDays);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  // Group by date
  const byDate = {};
  meals.forEach(m => {
    if (m.date < cutoffStr) return;
    if (!byDate[m.date]) byDate[m.date] = { cal:0, pro:0, carb:0, fat:0 };
    m.items.forEach(it => {
      byDate[m.date].cal  += it.cal    || 0;
      byDate[m.date].pro  += it.protein || 0;
      byDate[m.date].carb += it.carbs  || 0;
      byDate[m.date].fat  += it.fat    || 0;
    });
  });

  const days = Object.keys(byDate).sort();
  const n = days.length;
  if (!n) {
    document.getElementById('ntr-avg-cal').textContent = '—';
    document.getElementById('ntr-insights').textContent = 'No data for this range.';
    return;
  }

  const avg = key => Math.round(days.reduce((s,d) => s + byDate[d][key], 0) / n);
  const avgCal  = avg('cal');
  const avgPro  = avg('pro');
  const avgCarb = avg('carb');
  const avgFat  = avg('fat');

  const TARGETS = { cal: 2500, pro: 210, carb: 250, fat: 70 };

  // Avg cards
  const pctOf = (v, t) => Math.round((v/t)*100);
  const deltaStr = (v, t) => {
    const diff = v - t;
    return (diff >= 0 ? '+' : '') + diff + (diff >= 0 ? ' over' : ' short');
  };
  const deltaClass = (v, t) => v >= t*0.9 && v <= t*1.1 ? 'delta-down' : 'delta-up';

  document.getElementById('ntr-avg-cal').textContent  = avgCal.toLocaleString();
  document.getElementById('ntr-avg-pro').textContent  = avgPro;
  document.getElementById('ntr-avg-carb').textContent = avgCarb;
  document.getElementById('ntr-avg-fat').textContent  = avgFat;
  [['cal',avgCal],['pro',avgPro],['carb',avgCarb],['fat',avgFat]].forEach(([k,v]) => {
    const el = document.getElementById('ntr-delta-' + k);
    const t = k==='cal' ? TARGETS.cal : k==='pro' ? TARGETS.pro : k==='carb' ? TARGETS.carb : TARGETS.fat;
    el.textContent = deltaStr(v, t);
    el.className = 'stat-delta ' + deltaClass(v, t);
  });

  // Hit rates
  const hitGrid = document.getElementById('ntr-hit-grid');
  const metrics = [
    { label:'Calories', key:'cal', target: TARGETS.cal, lo: 0.85, hi: 1.1 },
    { label:'Protein',  key:'pro', target: TARGETS.pro, lo: 0.9,  hi: 2 },
    { label:'Carbs',    key:'carb',target: TARGETS.carb,lo: 0.7,  hi: 1.2 },
    { label:'Fat',      key:'fat', target: TARGETS.fat, lo: 0,    hi: 1.15 },
  ];
  hitGrid.innerHTML = metrics.map(m => {
    const hits = days.filter(d => {
      const v = byDate[d][m.key];
      return v >= m.target * m.lo && v <= m.target * m.hi;
    }).length;
    const pct = Math.round((hits/n)*100);
    const color = pct >= 70 ? 'var(--accent)' : pct >= 40 ? 'var(--amber)' : 'var(--red)';
    return `<div style="background:var(--surface2);border-radius:var(--radius-sm);padding:8px 10px;">
      <div style="font-size:11px;color:var(--text3);margin-bottom:4px;">${m.label}</div>
      <div style="font-size:16px;font-weight:500;color:${color};font-family:'DM Mono',monospace;">${pct}%</div>
      <div style="font-size:10px;color:var(--text3);">${hits} / ${n} days</div>
    </div>`;
  }).join('');

  // Daily calorie chart
  if (ntrCalChart) { ntrCalChart.destroy(); ntrCalChart = null; }
  const calCtx = document.getElementById('ntr-cal-chart')?.getContext('2d');
  if (calCtx) {
    ntrCalChart = new Chart(calCtx, {
      type: 'bar',
      data: {
        labels: days.map(d => d.slice(5)),
        datasets: [
          { data: days.map(d => Math.round(byDate[d].cal)), backgroundColor: days.map(d => byDate[d].cal >= TARGETS.cal*0.85 ? 'rgba(184,240,122,0.6)' : 'rgba(240,122,122,0.5)'), borderRadius: 3 },
          { data: days.map(() => TARGETS.cal), type:'line', borderColor:'rgba(255,255,255,0.2)', borderDash:[4,4], pointRadius:0, fill:false }
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label: c => c.datasetIndex===0 ? c.parsed.y.toLocaleString() + ' cal' : 'Target' } } },
        scales:{
          x:{ grid:{ color:'rgba(255,255,255,0.04)' }, ticks:{ color:'#5a615a', font:{ size:9 }, maxTicksLimit:10 } },
          y:{ grid:{ color:'rgba(255,255,255,0.04)' }, ticks:{ color:'#5a615a', font:{ size:9 } } }
        }
      }
    });
  }

  // Macro donut
  if (ntrMacroChart) { ntrMacroChart.destroy(); ntrMacroChart = null; }
  const macroCtx = document.getElementById('ntr-macro-chart')?.getContext('2d');
  const proteinCal = avgPro * 4;
  const carbCal    = avgCarb * 4;
  const fatCal     = avgFat * 9;
  const totalMacroCal = proteinCal + carbCal + fatCal || 1;
  if (macroCtx) {
    ntrMacroChart = new Chart(macroCtx, {
      type: 'doughnut',
      data: {
        labels: ['Protein','Carbs','Fat'],
        datasets: [{ data: [proteinCal, carbCal, fatCal], backgroundColor:['#7ab8f0','#f0c87a','#f07a7a'], borderWidth:0, hoverOffset:4 }]
      },
      options: {
        responsive:true, maintainAspectRatio:false, cutout:'65%',
        plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label: c => c.label + ': ' + Math.round((c.raw/totalMacroCal)*100) + '%' } } }
      }
    });
  }

  // Insights text
  const proteinPct = Math.round((proteinCal/totalMacroCal)*100);
  const carbPct    = Math.round((carbCal/totalMacroCal)*100);
  const fatPct     = Math.round((fatCal/totalMacroCal)*100);
  const proShort   = TARGETS.pro - avgPro;
  const insights = [];
  if (proShort > 20)  insights.push(`Protein is averaging <b>${avgPro}g</b> — ${Math.round(proShort)}g short of your 210g target. That's ${Math.round(proShort/25)} extra servings of chicken breast or scoops of protein powder per day.`);
  else if (proShort > 0) insights.push(`Protein is close — averaging <b>${avgPro}g</b>, just ${Math.round(proShort)}g shy of target.`);
  else insights.push(`Protein target hit — averaging <b>${avgPro}g</b>.`);
  if (fatPct > 35)    insights.push(`Fat is <b>${fatPct}%</b> of calories — higher than the ~28% ideal for a cut. Worth auditing cooking oils, sauces, and cheese.`);
  if (avgCal < TARGETS.cal * 0.8) insights.push(`Calories are averaging <b>${avgCal.toLocaleString()}</b> — well below the 2,500 target. Chronic undereating can slow recovery.`);
  const daysLogged = n;
  const totalDays = nutritionRangeDays;
  if (daysLogged < totalDays * 0.6) insights.push(`Only logged <b>${daysLogged} of ${totalDays}</b> days — the averages may not reflect full intake.`);
  document.getElementById('ntr-insights').innerHTML = insights.map(i => `<p style="margin:0 0 10px;">${i}</p>`).join('');
}

// ── Food & Drink ──────────────────────────────────────
const FOOD_TARGETS = { cal: 2500, protein: 210, carbs: 250, fat: 70 };
let foodItemCount = 0;

function initFoodPage() {
  document.getElementById('food-date').value = today();
  renderFoodPage();
  renderNutritionInsights();
  document.getElementById('food-item-rows').innerHTML = '';
  foodItemCount = 0;
  addFoodItem();
}

function foodNavDay(dir) {
  const d = new Date(document.getElementById('food-date').value || today());
  d.setDate(d.getDate() + dir);
  document.getElementById('food-date').value = d.toISOString().split('T')[0];
  renderFoodPage();
}

function addFoodItem() {
  foodItemCount++;
  const id = 'fi-' + foodItemCount;
  const div = document.createElement('div');
  div.id = id;
  div.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr auto;gap:6px;margin-bottom:6px;align-items:center;';
  div.innerHTML = `
    <input type="text" placeholder="Food or drink name" style="font-size:13px;">
    <input type="number" placeholder="0" min="0" style="font-size:13px;" class="fi-cal">
    <input type="number" placeholder="0" min="0" step="0.1" style="font-size:13px;" class="fi-pro">
    <input type="number" placeholder="0" min="0" step="0.1" style="font-size:13px;" class="fi-carb">
    <input type="number" placeholder="0" min="0" step="0.1" style="font-size:13px;" class="fi-fat">
    <button class="btn-icon" onclick="document.getElementById('${id}').remove()" title="Remove">×</button>
  `;
  document.getElementById('food-item-rows').appendChild(div);
}

function saveMeal() {
  const date = document.getElementById('food-date').value || today();
  const mealType = document.getElementById('food-meal-type').value;
  const mealName = document.getElementById('food-meal-name').value.trim() || mealType;
  const notes = document.getElementById('food-notes').value.trim();

  const items = [];
  document.querySelectorAll('#food-item-rows > div').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const name = inputs[0].value.trim();
    if (!name) return;
    items.push({
      name,
      cal: parseFloat(inputs[1].value) || 0,
      protein: parseFloat(inputs[2].value) || 0,
      carbs: parseFloat(inputs[3].value) || 0,
      fat: parseFloat(inputs[4].value) || 0,
    });
  });

  if (!items.length) { toast('Add at least one item'); return; }

  const meals = getMeals();
  meals.push({ id: Date.now(), date, mealType, mealName, notes, items });
  saveMeals(meals);
  toast('Meal saved ✓');

  // Reset form
  document.getElementById('food-meal-name').value = '';
  document.getElementById('food-notes').value = '';
  document.getElementById('food-item-rows').innerHTML = '';
  foodItemCount = 0;
  addFoodItem();
  renderFoodPage();
}

function deleteMeal(id) {
  saveMeals(getMeals().filter(m => m.id !== id));
  renderFoodPage();
  toast('Meal deleted');
}

function renderFoodPage() {
  const dateEl = document.getElementById('food-date');
  if (!dateEl) return; // page not yet initialised
  const date = dateEl.value || today();
  const isToday = date === today();
  document.getElementById('food-date-label').textContent = isToday ? 'Today' : date;
  document.getElementById('food-log-title').textContent = isToday ? "Today's log" : `Log for ${date}`;

  const meals = getMeals().filter(m => m.date === date);

  // Totals
  let totCal = 0, totPro = 0, totCarb = 0, totFat = 0;
  meals.forEach(m => m.items.forEach(it => {
    totCal += it.cal; totPro += it.protein; totCarb += it.carbs; totFat += it.fat;
  }));

  // Summary cards
  const pct = (v, t) => Math.min(100, Math.round((v / t) * 100));
  const rem = (v, t) => { const r = t - v; return r > 0 ? r + ' remaining' : Math.abs(r) + ' over'; };
  const remColor = (v, t) => v > t ? 'var(--red)' : v > t * 0.9 ? 'var(--amber)' : 'var(--text3)';

  document.getElementById('fs-cal').textContent = Math.round(totCal);
  document.getElementById('fp-cal').style.width = pct(totCal, FOOD_TARGETS.cal) + '%';
  document.getElementById('fp-cal').style.background = totCal > FOOD_TARGETS.cal ? 'var(--red)' : 'var(--accent)';
  document.getElementById('fd-cal').textContent = rem(Math.round(totCal), FOOD_TARGETS.cal);
  document.getElementById('fd-cal').style.color = remColor(totCal, FOOD_TARGETS.cal);

  document.getElementById('fs-pro').textContent = Math.round(totPro);
  document.getElementById('fp-pro').style.width = pct(totPro, FOOD_TARGETS.protein) + '%';
  document.getElementById('fd-pro').textContent = rem(Math.round(totPro), FOOD_TARGETS.protein) + 'g';
  document.getElementById('fd-pro').style.color = remColor(totPro, FOOD_TARGETS.protein);

  document.getElementById('fs-carb').textContent = Math.round(totCarb);
  document.getElementById('fp-carb').style.width = pct(totCarb, FOOD_TARGETS.carbs) + '%';
  document.getElementById('fd-carb').textContent = 'target: ~' + FOOD_TARGETS.carbs + 'g';

  document.getElementById('fs-fat').textContent = Math.round(totFat);
  document.getElementById('fp-fat').style.width = pct(totFat, FOOD_TARGETS.fat) + '%';
  document.getElementById('fd-fat').textContent = 'target: ~' + FOOD_TARGETS.fat + 'g';

  // Meal list grouped by meal type order
  const ORDER = ['breakfast','lunch','dinner','snack','drink'];
  const mealTypeLabel = { breakfast:'Breakfast', lunch:'Lunch', dinner:'Dinner', snack:'Snack', drink:'Drink' };
  const mealTagClass = { breakfast:'tag-push', lunch:'tag-pull', dinner:'tag-legs', snack:'tag-run', drink:'tag-run' };

  if (meals.length === 0) {
    document.getElementById('food-meal-list').innerHTML = `<div class="empty"><div class="empty-icon">◎</div><div class="empty-text">No meals logged for this day</div></div>`;
    return;
  }

  const sorted = [...meals].sort((a,b) => ORDER.indexOf(a.mealType) - ORDER.indexOf(b.mealType));
  document.getElementById('food-meal-list').innerHTML = sorted.map(m => {
    const mCal = m.items.reduce((s,i) => s + i.cal, 0);
    const mPro = m.items.reduce((s,i) => s + i.protein, 0);
    const mCarb = m.items.reduce((s,i) => s + i.carbs, 0);
    const mFat = m.items.reduce((s,i) => s + i.fat, 0);
    const itemsHtml = m.items.map(it => `
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px;">
        <span style="color:var(--text2)">${it.name}</span>
        <span style="font-family:'DM Mono',monospace;color:var(--text)">${Math.round(it.cal)}</span>
        <span style="font-family:'DM Mono',monospace;color:var(--blue)">${it.protein.toFixed(1)}g</span>
        <span style="font-family:'DM Mono',monospace;color:var(--amber)">${it.carbs.toFixed(1)}g</span>
        <span style="font-family:'DM Mono',monospace;color:var(--red)">${it.fat.toFixed(1)}g</span>
      </div>`).join('');
    return `
      <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <span class="tag ${mealTagClass[m.mealType] || 'tag-push'}">${mealTypeLabel[m.mealType]||m.mealType}</span>
          <span style="font-size:14px;font-weight:500;color:var(--text);flex:1;">${m.mealName}</span>
          <span style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;">${Math.round(mCal)} cal · ${mPro.toFixed(0)}g pro</span>
          <button class="btn btn-ghost btn-sm" onclick="editMeal(${m.id})" style="margin-left:auto;">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteMeal(${m.id})">Delete</button>
        </div>
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:8px;padding:0 0 4px;font-size:10px;color:var(--text3);font-family:'DM Mono',monospace;">
          <span>item</span><span>cal</span><span>protein</span><span>carbs</span><span>fat</span>
        </div>
        ${itemsHtml}
        ${m.notes ? `<div style="font-size:11px;color:var(--text3);margin-top:6px;">${m.notes}</div>` : ''}
      </div>`;
  }).join('');
}

// Also add meals summary to dashboard recent activity
function getMealsSummaryForDate(date) {
  const meals = getMeals().filter(m => m.date === date);
  let cal = 0; meals.forEach(m => m.items.forEach(i => cal += i.cal));
  return { count: meals.length, cal: Math.round(cal) };
}

function editMeal(id) {
  const meal = getMeals().find(m => m.id === id);
  if (!meal) return;
  // Pre-populate the log form
  document.getElementById('food-meal-type').value = meal.mealType || 'breakfast';
  document.getElementById('food-meal-name').value = meal.mealName || '';
  document.getElementById('food-notes').value = meal.notes || '';
  // Clear and refill items
  document.getElementById('food-item-rows').innerHTML = '';
  foodItemCount = 0;
  meal.items.forEach(item => {
    foodItemCount++;
    const iid = 'fi-' + foodItemCount;
    const div = document.createElement('div');
    div.id = iid;
    div.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr auto;gap:6px;margin-bottom:6px;align-items:center;';
    div.innerHTML = `
      <input type="text" value="${item.name}" style="font-size:13px;">
      <input type="number" value="${Math.round(item.cal)}" min="0" style="font-size:13px;" class="fi-cal">
      <input type="number" value="${item.protein.toFixed(1)}" min="0" step="0.1" style="font-size:13px;" class="fi-pro">
      <input type="number" value="${item.carbs.toFixed(1)}" min="0" step="0.1" style="font-size:13px;" class="fi-carb">
      <input type="number" value="${item.fat.toFixed(1)}" min="0" step="0.1" style="font-size:13px;" class="fi-fat">
      <button class="btn-icon" onclick="document.getElementById('${iid}').remove()" title="Remove">×</button>
    `;
    document.getElementById('food-item-rows').appendChild(div);
  });
  // Switch save button to update
  const btn = document.querySelector('#page-food .btn-primary[onclick="saveMeal()"]');
  if (btn) { btn.textContent = 'Update meal'; btn.setAttribute('onclick', `updateMeal(${id})`); }
  // Scroll to form
  document.querySelector('#page-food .card').scrollIntoView({ behavior: 'smooth' });
  toast('Editing meal — make changes and save');
}

function updateMeal(id) {
  const date = document.getElementById('food-date').value || today();
  const mealType = document.getElementById('food-meal-type').value;
  const mealName = document.getElementById('food-meal-name').value.trim() || mealType;
  const notes = document.getElementById('food-notes').value.trim();
  const items = [];
  document.querySelectorAll('#food-item-rows > div').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const name = inputs[0].value.trim();
    if (!name) return;
    items.push({ name, cal: parseFloat(inputs[1].value) || 0, protein: parseFloat(inputs[2].value) || 0, carbs: parseFloat(inputs[3].value) || 0, fat: parseFloat(inputs[4].value) || 0 });
  });
  if (!items.length) { toast('Add at least one item'); return; }
  const meals = getMeals().filter(m => m.id !== id);
  meals.push({ id, date, mealType, mealName, notes, items });
  saveMeals(meals);
  toast('Meal updated ✓');
  // Reset form
  document.getElementById('food-meal-name').value = '';
  document.getElementById('food-notes').value = '';
  document.getElementById('food-item-rows').innerHTML = '';
  foodItemCount = 0;
  addFoodItem();
  const btn = document.querySelector('#page-food .btn-primary');
  if (btn) { btn.textContent = 'Save meal'; btn.setAttribute('onclick', 'saveMeal()'); }
  renderFoodPage();
}

// ── Routes ────────────────────────────────────────────
const getRoutes = () => cacheGet('routes') || {};
const saveRoutes = v => { cacheSet('routes', v); sbWrite('routes', v); };

let routeMap = null;
let routePolyline = null;
let routeMarkers = [];
let routeTileLayer = null;
let routeFilter = 'all';

function getMapTileUrl() {
  return {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors'
  };
}

function getMapFilter() {
  return document.body.classList.contains('light')
    ? 'grayscale(100%) brightness(1.05) contrast(0.9)'
    : 'grayscale(100%) invert(1) brightness(0.85) contrast(0.9)';
}

function getRouteColor() {
  return document.body.classList.contains('light') ? '#2a7d1e' : '#c8ff6a';
}

function updateMapTheme() {
  if (!routeMap) return;
  const { url, attribution } = getMapTileUrl();
  if (routeTileLayer) routeMap.removeLayer(routeTileLayer);
  routeTileLayer = L.tileLayer(url, { attribution, maxZoom: 19 }).addTo(routeMap);
  // Apply filter to tile pane
  const tilePane = routeMap.getPanes().tilePane;
  if (tilePane) tilePane.style.filter = getMapFilter();
  if (routePolyline) routePolyline.setStyle({ color: getRouteColor() });
}

function initRoutesPage() {
  renderRoutesList();
  initRoutesPageMobile();
  if (!routeMap) {
    setTimeout(() => {
      const mapEl = document.getElementById('route-map');
      if (!mapEl || routeMap) return;
      routeMap = L.map('route-map', { zoomControl: true }).setView([33.55, -117.73], 12);
      const { url, attribution } = getMapTileUrl();
      routeTileLayer = L.tileLayer(url, { attribution, maxZoom: 19 }).addTo(routeMap);
      const tilePane = routeMap.getPanes().tilePane;
      if (tilePane) tilePane.style.filter = getMapFilter();
    }, 150);
  } else {
    updateMapTheme();
  }
}

function filterRoutes(f, el) {
  routeFilter = f;
  document.querySelectorAll('#page-routes .btn').forEach(b => { b.style.borderColor = ''; b.style.color = ''; });
  el.style.borderColor = 'var(--accent)'; el.style.color = 'var(--accent)';
  renderRoutesList();
}

function renderRoutesList() {
  const runs = getRuns().sort((a,b) => b.date.localeCompare(a.date));
  const routes = getRoutes();
  const container = document.getElementById('routes-list');
  if (!container) return;

  let filtered = runs;
  if (routeFilter === 'nike') filtered = runs.filter(r => r.nike);
  if (routeFilter === 'strava') filtered = runs.filter(r => r.strava_id);

  // Only show runs that have route data
  const withRoutes = filtered.filter(r => {
    const key = r.nike ? 'nike_' + r.date + '_' + r.duration : r.strava_id ? 'strava_' + r.strava_id : null;
    return key && routes[key];
  });
  const withoutRoutes = filtered.filter(r => {
    const key = r.nike ? 'nike_' + r.date + '_' + r.duration : r.strava_id ? 'strava_' + r.strava_id : null;
    return !key || !routes[key];
  });
  const allFiltered = [...withRoutes, ...withoutRoutes];

  if (!allFiltered.length) {
    container.innerHTML = `<div class="empty"><div class="empty-icon">◎</div><div class="empty-text">No runs found</div></div>`;
    return;
  }

  container.innerHTML = allFiltered.map(r => {
    const key = r.nike ? 'nike_' + r.date + '_' + r.duration : r.strava_id ? 'strava_' + r.strava_id : null;
    const hasRoute = key && routes[key];
    const src = r.nike ? '🏃 Nike' : r.strava_id ? '⚡ Strava' : 'Manual';
    const isStrava = !!r.strava_id;
    const badge = hasRoute
      ? `<span style="font-size:10px;color:var(--accent);margin-left:auto;">📍 GPS</span>`
      : isStrava
        ? `<button onclick="event.stopPropagation();fetchStravaRoute('${r.strava_id}','${r.date}','${r.duration}')" style="font-size:10px;margin-left:auto;background:rgba(252,76,2,0.15);border:none;color:#fc4c02;padding:2px 6px;border-radius:4px;cursor:pointer;">↓ Load route</button>`
        : `<span style="font-size:10px;color:var(--text3);margin-left:auto;">no GPS</span>`;
    return `<div onclick="selectRoute('${r.date}','${r.duration}','${r.strava_id||''}',${r.nike||false})"
      style="padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer;transition:background 0.1s;"
      onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''"
    >
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:2px;">
        <span style="font-size:13px;font-weight:500;color:var(--text);">${r.date}</span>
        <span style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;">${r.distance||'?'} mi</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:11px;color:var(--text3);">${src}</span>
        <span style="font-size:11px;color:var(--text3);">· ${r.duration||'?'} min · ${r.pace||'?'}/mi</span>
        ${badge}
      </div>
    </div>`;
  }).join('');
}

async function fetchStravaRoute(stravaId, date, duration) {
  toast('Fetching route from Strava...');
  try {
    const token = await stravaRefreshToken();
    if (!token) { toast('Strava not connected'); return; }

    const res = await fetch(`https://www.strava.com/api/v3/activities/${stravaId}`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();

    if (!data.map?.polyline && !data.map?.summary_polyline) {
      toast('No route data available for this run');
      return;
    }

    // Decode Google encoded polyline
    const encoded = data.map.polyline || data.map.summary_polyline;
    const coords = decodePolyline(encoded);

    if (!coords.length) { toast('Could not decode route'); return; }

    // Store and display
    const routes = getRoutes();
    routes[`strava_${stravaId}`] = coords;
    saveRoutes(routes);
    renderRoutesList();
    selectRoute(date, duration, stravaId, false);
    toast('Route loaded ✓');
  } catch(e) {
    console.error(e);
    toast('Failed to fetch route — try again');
  }
}

function decodePolyline(encoded) {
  // Google Polyline Algorithm decoder
  const coords = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}

function selectRoute(date, duration, stravaId, isNike) {
  const routes = getRoutes();
  const key = isNike ? `nike_${date}_${duration}` : stravaId ? `strava_${stravaId}` : null;
  const coords = key ? routes[key] : null;

  // Find the run for info
  const run = getRuns().find(r => r.date === date && String(r.duration) === String(duration));

  // Update info panel
  document.getElementById('route-info').style.display = 'block';
  document.getElementById('ri-date').textContent = date + (isNike ? ' · Nike Run Club' : stravaId ? ' · Strava' : '');
  document.getElementById('ri-dist').textContent = (run?.distance || '?') + ' mi';
  document.getElementById('ri-detail').textContent = (run?.duration || '?') + ' min · ' + (run?.pace || '?') + ' /mi';

  if (!coords || !coords.length) {
    document.getElementById('route-map-empty').style.display = 'flex';
    document.getElementById('route-map-empty').querySelector('div:last-child').textContent = 'No GPS data for this run';
    return;
  }

  document.getElementById('route-map-empty').style.display = 'none';

  // Clear previous route and markers
  if (routePolyline) { routeMap.removeLayer(routePolyline); routePolyline = null; }
  routeMarkers.forEach(m => routeMap.removeLayer(m));
  routeMarkers = [];

  const color = getRouteColor();
  routePolyline = L.polyline(coords, {
    color,
    weight: 4,
    opacity: 0.95,
    lineJoin: 'round',
    lineCap: 'round'
  }).addTo(routeMap);

  // Start dot (white) and end dot (accent)
  if (coords.length > 1) {
    const isLight = document.body.classList.contains('light');
    const startM = L.circleMarker(coords[0], {
      radius: 5, fillColor: '#ffffff', color: color, weight: 2, fillOpacity: 1
    }).addTo(routeMap);
    const endM = L.circleMarker(coords[coords.length-1], {
      radius: 5, fillColor: color, color: isLight ? '#fff' : '#0e0f0e', weight: 2, fillOpacity: 1
    }).addTo(routeMap);
    routeMarkers = [startM, endM];
  }

  routeMap.fitBounds(routePolyline.getBounds(), { padding: [40, 40] });
}

// ── Mobile layout ─────────────────────────────────────
const isMobile = () => window.innerWidth <= 700;

function initMobileLayout() {
  const mobileHeader = document.getElementById('mobile-nav-header');
  const desktopLogo = document.getElementById('desktop-logo');
  const sidebarBody = document.getElementById('sidebar-body');
  if (isMobile()) {
    mobileHeader.style.display = 'flex';
    desktopLogo.style.display = 'none';
    sidebarBody.classList.remove('open'); // collapsed by default
  } else {
    mobileHeader.style.display = 'none';
    desktopLogo.style.display = 'block';
    sidebarBody.style.display = 'block'; // always visible on desktop
  }
  // Apply mobile grid class to nav
  const navItems = document.querySelector('.sidebar-mobile-grid');
  if (!navItems) return;
}

function toggleMobileNav() {
  const body = document.getElementById('sidebar-body');
  const btn = document.getElementById('hamburger-btn');
  const open = body.classList.toggle('open');
  btn.textContent = open ? '✕' : '☰';
}

function closeMobileNav() {
  const body = document.getElementById('sidebar-body');
  const btn = document.getElementById('hamburger-btn');
  body.classList.remove('open');
  btn.textContent = '☰';
}

let routesListOpen = true;
function toggleRoutesList() {
  routesListOpen = !routesListOpen;
  const list = document.getElementById('routes-list');
  const toggle = document.getElementById('routes-toggle-label');
  const mapContainer = document.getElementById('routes-map-container');
  if (routesListOpen) {
    list.style.maxHeight = '40vh';
    list.style.overflow = 'auto';
    if (toggle) toggle.textContent = 'Runs ▾';
    if (mapContainer) mapContainer.style.height = 'calc(60vh - 52px)';
  } else {
    list.style.maxHeight = '0';
    list.style.overflow = 'hidden';
    if (toggle) toggle.textContent = 'Runs ▸';
    if (mapContainer) mapContainer.style.height = 'calc(100vh - 52px)';
  }
  if (routeMap) setTimeout(() => routeMap.invalidateSize(), 50);
}

function initRoutesPageMobile() {
  const toggle = document.getElementById('routes-list-toggle');
  const grid = document.getElementById('routes-grid');
  const listPanel = document.getElementById('routes-list-panel');
  const mapContainer = document.getElementById('routes-map-container');
  const dragHandle = document.getElementById('routes-drag-handle');

  if (isMobile()) {
    grid.style.gridTemplateColumns = '1fr';
    grid.style.gridTemplateRows = 'auto 1fr';
    grid.style.height = '100vh';
    listPanel.style.borderRight = 'none';
    listPanel.style.borderBottom = '1px solid var(--border)';
    listPanel.style.overflow = 'visible';
    listPanel.style.flexShrink = '0';
    if (toggle) toggle.style.display = 'flex';
    if (dragHandle) dragHandle.style.display = 'flex';
    const list = document.getElementById('routes-list');
    list.style.maxHeight = '38vh';
    list.style.overflow = 'auto';
    if (mapContainer) mapContainer.style.flex = '1';
  } else {
    grid.style.gridTemplateColumns = '300px 1fr';
    grid.style.gridTemplateRows = '';
    grid.style.height = '100vh';
    listPanel.style.borderRight = '1px solid var(--border)';
    listPanel.style.borderBottom = '';
    listPanel.style.flexShrink = '';
    if (toggle) toggle.style.display = 'none';
    if (dragHandle) dragHandle.style.display = 'none';
    const list = document.getElementById('routes-list');
    list.style.maxHeight = '';
    list.style.overflow = 'auto';
    if (mapContainer) mapContainer.style.flex = '';
  }
}

let dragStartY = 0, dragStartHeight = 0;
function startRoutesDrag(e) {
  e.preventDefault();
  const list = document.getElementById('routes-list');
  dragStartY = e.touches ? e.touches[0].clientY : e.clientY;
  dragStartHeight = list.offsetHeight;

  const onMove = ev => {
    const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
    const delta = y - dragStartY;
    const newH = Math.max(60, Math.min(window.innerHeight * 0.75, dragStartHeight + delta));
    list.style.maxHeight = newH + 'px';
    if (routeMap) routeMap.invalidateSize();
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchend', onUp);
    if (routeMap) routeMap.invalidateSize();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchend', onUp);
}

window.addEventListener('resize', () => {
  initMobileLayout();
  if (document.getElementById('page-routes').classList.contains('active')) {
    initRoutesPageMobile();
    if (routeMap) setTimeout(() => routeMap.invalidateSize(), 100);
  }
});

// ── HIIT Timer ────────────────────────────────────────
const hiitState = {
  rounds: 8, work: 40, rest: 20,
  currentRound: 0, phase: 'idle', remaining: 0,
  interval: null, running: false
};

function hiitStep(field, delta) {
  const mins = { rounds: 1, work: 5, rest: 5 };
  const maxs = { rounds: 30, work: 300, rest: 300 };
  hiitState[field] = Math.max(mins[field], Math.min(maxs[field], hiitState[field] + delta));
  document.getElementById('hiit-' + field).textContent = hiitState[field];
  hiitUpdateTotals();
}

function hiitUpdateTotals() {
  const { rounds, work, rest } = hiitState;
  const total = rounds * work + (rounds - 1) * rest;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  document.getElementById('hiit-total-time').textContent =
    mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  document.getElementById('hiit-total-breakdown').textContent =
    `${rounds} × ${work}s work + ${rest}s rest`;
  hiitRenderDots();
}

function hiitRenderDots() {
  const { rounds, currentRound, phase, running } = hiitState;
  const dots = document.getElementById('hiit-dots');
  if (!dots) return;
  dots.innerHTML = Array.from({ length: rounds }, (_, i) => {
    let bg = 'var(--surface3)';
    if (i < currentRound) bg = 'var(--accent)';
    else if (i === currentRound && running) bg = phase === 'work' ? 'var(--accent)' : 'var(--blue)';
    return `<div style="width:10px;height:10px;border-radius:50%;background:${bg};transition:background 0.3s;"></div>`;
  }).join('');
}

function hiitSpeak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 1.1;
  utt.pitch = 1;
  utt.volume = 1;
  window.speechSynthesis.speak(utt);
}

function hiitBeep(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = type === 'work' ? 880 : type === 'rest' ? 440 : 660;
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch(e) {}
}

function hiitSetPhaseUI(phase, remaining, total, round, rounds) {
  const countdown = document.getElementById('hiit-countdown');
  const phaseEl = document.getElementById('hiit-phase');
  const progress = document.getElementById('hiit-progress');
  const roundLabel = document.getElementById('hiit-round-label');

  countdown.textContent = remaining;

  if (phase === 'work') {
    phaseEl.textContent = 'Work';
    countdown.style.color = 'var(--accent)';
    progress.style.background = 'var(--accent)';
    roundLabel.textContent = `Round ${round} of ${rounds}`;
  } else if (phase === 'rest') {
    phaseEl.textContent = 'Rest';
    countdown.style.color = 'var(--blue)';
    progress.style.background = 'var(--blue)';
    roundLabel.textContent = `Round ${round} of ${rounds} · Next: work`;
  } else if (phase === 'done') {
    phaseEl.textContent = 'Done!';
    countdown.textContent = '✓';
    countdown.style.color = 'var(--accent)';
    progress.style.background = 'var(--accent)';
    progress.style.width = '100%';
    roundLabel.textContent = `${rounds} rounds complete`;
    return;
  }

  progress.style.width = (((total - remaining) / total) * 100) + '%';
  hiitRenderDots();
}

function hiitStart() {
  hiitState.running = true;
  hiitState.currentRound = 1;
  hiitState.phase = 'work';
  hiitState.remaining = hiitState.work;

  document.getElementById('hiit-btn-start').style.display = 'none';
  document.getElementById('hiit-btn-pause').style.display = '';
  document.getElementById('hiit-btn-reset').style.display = '';

  hiitSpeak('Go');
  hiitBeep('work');
  hiitSetPhaseUI('work', hiitState.remaining, hiitState.work, 1, hiitState.rounds);
  hiitTick();
}

function hiitTick() {
  hiitState.interval = setInterval(() => {
    hiitState.remaining--;

    // Voice countdown at 3, 2, 1
    if (hiitState.remaining <= 3 && hiitState.remaining > 0) {
      hiitSpeak(String(hiitState.remaining));
    }

    if (hiitState.remaining <= 0) {
      clearInterval(hiitState.interval);
      hiitNextPhase();
      return;
    }

    hiitSetPhaseUI(
      hiitState.phase,
      hiitState.remaining,
      hiitState.phase === 'work' ? hiitState.work : hiitState.rest,
      hiitState.currentRound,
      hiitState.rounds
    );
  }, 1000);
}

function hiitNextPhase() {
  const { rounds, work, rest } = hiitState;

  if (hiitState.phase === 'work') {
    if (hiitState.currentRound >= rounds) {
      hiitState.phase = 'done';
      hiitState.running = false;
      clearInterval(hiitState.interval);
      hiitSpeak('Workout complete. Great job.');
      hiitBeep('done');
      hiitSetPhaseUI('done', 0, 0, rounds, rounds);
      document.getElementById('hiit-btn-pause').style.display = 'none';
      document.getElementById('hiit-btn-resume').style.display = 'none';
    } else {
      hiitState.phase = 'rest';
      hiitState.remaining = rest;
      hiitSpeak('Rest');
      hiitBeep('rest');
      hiitSetPhaseUI('rest', rest, rest, hiitState.currentRound, rounds);
      hiitTick();
    }

  } else if (hiitState.phase === 'rest') {
    hiitState.phase = 'work';
    hiitState.currentRound++;
    hiitState.remaining = work;
    hiitSpeak('Go');
    hiitBeep('work');
    hiitSetPhaseUI('work', work, work, hiitState.currentRound, rounds);
    hiitTick();
  }
}

function hiitPause() {
  clearInterval(hiitState.interval);
  hiitState.running = false;
  window.speechSynthesis?.cancel();
  document.getElementById('hiit-btn-pause').style.display = 'none';
  document.getElementById('hiit-btn-resume').style.display = '';
}

function hiitResume() {
  hiitState.running = true;
  document.getElementById('hiit-btn-resume').style.display = 'none';
  document.getElementById('hiit-btn-pause').style.display = '';
  hiitTick();
}

function hiitReset() {
  clearInterval(hiitState.interval);
  window.speechSynthesis?.cancel();
  hiitState.running = false;
  hiitState.phase = 'idle';
  hiitState.currentRound = 0;
  hiitState.remaining = 0;

  document.getElementById('hiit-btn-start').style.display = '';
  document.getElementById('hiit-btn-pause').style.display = 'none';
  document.getElementById('hiit-btn-resume').style.display = 'none';
  document.getElementById('hiit-btn-reset').style.display = 'none';
  document.getElementById('hiit-countdown').textContent = '—';
  document.getElementById('hiit-countdown').style.color = 'var(--text)';
  document.getElementById('hiit-phase').textContent = 'Ready';
  document.getElementById('hiit-round-label').textContent = '';
  document.getElementById('hiit-progress').style.width = '0%';
  hiitRenderDots();
}

function initHiitPage() {
  hiitReset();
  hiitUpdateTotals();
}

// ── Data page ─────────────────────────────────────────
function getImportMeta() { return cacheGet('import_meta') || {}; }
function setImportMeta(key, extra) {
  const meta = getImportMeta();
  meta[key] = { ts: Date.now(), ...extra };
  cacheSet('import_meta', meta);
}

function fmtImportDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) + ' at ' + d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
}

function renderDataPage() {
  const meta = getImportMeta();
  const workouts = getWorkouts();
  const runs = getRuns();
  const routes = getRoutes();
  const meals = getMeals();

  // Hevy
  const hevyWorkouts = workouts.filter(w => w.notes && w.notes.includes('Wk'));
  const hevyMeta = meta.hevy;
  if (hevyWorkouts.length) {
    document.getElementById('hevy-badge').style.display = '';
    document.getElementById('hevy-meta').textContent = hevyWorkouts.length + ' workouts' + (hevyMeta ? ' · Last import ' + fmtImportDate(hevyMeta.ts) : '');
  } else {
    document.getElementById('hevy-badge').style.display = 'none';
    document.getElementById('hevy-meta').textContent = 'No Hevy data imported yet';
  }

  // Nike
  const nikeRuns = runs.filter(r => r.nike);
  const nikeMeta = meta.nike;
  const nikeRoutes = Object.keys(routes).filter(k => k.startsWith('nike_')).length;
  if (nikeRuns.length) {
    document.getElementById('nike-badge').style.display = '';
    document.getElementById('nike-meta').textContent =
      nikeRuns.length + ' runs · ' + nikeRoutes + ' GPS routes' +
      (nikeMeta ? ' · Last import ' + fmtImportDate(nikeMeta.ts) : '');
  } else {
    document.getElementById('nike-badge').style.display = 'none';
    document.getElementById('nike-meta').textContent = 'No Nike data imported yet';
  }

  // Strava
  const stravaRuns = runs.filter(r => r.strava_id);
  const athlete = cacheGet('strava_athlete');
  const stravaDataBadge = document.getElementById('strava-badge-data');
  const stravaBtnData = document.getElementById('strava-btn-data');
  const stravaSyncBtnData = document.getElementById('strava-sync-btn-data');
  const stravaMetaData = document.getElementById('strava-meta-data');
  if (athlete) {
    stravaDataBadge.style.display = '';
    stravaBtnData.style.display = 'none';
    stravaSyncBtnData.style.display = '';
    stravaMetaData.textContent = athlete + ' · ' + stravaRuns.length + ' runs synced' + (meta.strava ? ' · ' + fmtImportDate(meta.strava.ts) : '');
  } else {
    stravaDataBadge.style.display = 'none';
    stravaBtnData.style.display = '';
    stravaSyncBtnData.style.display = 'none';
    stravaMetaData.textContent = 'Not connected';
  }

  // Backup meta
  const backupMeta = meta.backup_export;
  document.getElementById('backup-meta').textContent = backupMeta ? 'Last export ' + fmtImportDate(backupMeta.ts) : 'No exports yet';

  // Summary counts
  document.getElementById('ds-workouts').textContent = workouts.length;
  document.getElementById('ds-runs').textContent = runs.length;
  document.getElementById('ds-routes').textContent = Object.keys(routes).length;
  document.getElementById('ds-meals').textContent = meals.length;
}

// ── Programs page ─────────────────────────────────────
function renderProgramsPage() {
  const state = getProgramState();
  const prog = getActiveProgram();
  const week = getProgramWeek();
  const pct = Math.round((week / prog.weeks) * 100);

  // Start/end dates
  const start = new Date(state.startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + prog.weeks * 7);
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  document.getElementById('prog-status').textContent = `Week ${week} of ${prog.weeks} · ${prog.goal}`;
  document.getElementById('prog-active-name').textContent = prog.name;
  document.getElementById('prog-active-sub').textContent = prog.subtitle;
  document.getElementById('prog-week-num').textContent = week;
  document.getElementById('prog-week-of').textContent = `of ${prog.weeks} weeks`;
  document.getElementById('prog-progress-fill').style.width = pct + '%';
  document.getElementById('prog-start-label').textContent = fmt(start);
  document.getElementById('prog-end-label').textContent = fmt(end);

  // Color progress bar by program
  document.getElementById('prog-progress-fill').style.background = prog.color;

  // Travel toggle button
  const travel = isTravelMode();
  const btn = document.getElementById('travel-toggle-btn');
  btn.textContent = travel ? '✈ On' : 'Off';
  btn.style.background = travel ? 'rgba(184,240,122,0.15)' : 'transparent';
  btn.style.borderColor = travel ? 'var(--accent)' : 'var(--border2)';
  btn.style.color = travel ? 'var(--accent)' : 'var(--text2)';

  // Program list
  document.getElementById('prog-list').innerHTML = Object.values(PROGRAMS).map(p => {
    const isActive = p.id === state.programId;
    const endD = new Date(start);
    endD.setDate(endD.getDate() + p.weeks * 7);
    return `<div onclick="${isActive ? '' : `switchProgram('${p.id}')`}"
      style="background:var(--surface2);border:1px solid ${isActive ? p.color : 'var(--border)'};border-radius:var(--radius);padding:16px;cursor:${isActive ? 'default' : 'pointer'};transition:all 0.15s;position:relative;overflow:hidden;"
      ${!isActive ? `onmouseover="this.style.borderColor='${p.color}'" onmouseout="this.style.borderColor='var(--border)'"` : ''}
    >
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div style="width:8px;height:8px;border-radius:50%;background:${p.color};flex-shrink:0;"></div>
        ${isActive ? `<span style="font-size:10px;font-family:'DM Mono',monospace;color:${p.color};background:${p.color}22;padding:2px 8px;border-radius:10px;">Active · Wk ${week}</span>` : `<span style="font-size:10px;font-family:'DM Mono',monospace;color:var(--text3);">${p.weeks} wks</span>`}
      </div>
      <div style="font-family:'WTGaramono',serif;font-size:18px;margin:6px 0 2px;">${p.name}</div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:4px;">${p.subtitle}</div>
      <div style="font-size:11px;color:var(--text2);">${p.goal}</div>
      ${!isActive ? `<div style="font-size:10px;color:var(--text3);margin-top:8px;font-family:'DM Mono',monospace;">Click to switch →</div>` : ''}
    </div>`;
  }).join('');
}

function toggleTravelMode() {
  const state = getProgramState();
  state.travelMode = !state.travelMode;
  saveProgramState(state);
  PLAN = buildPLAN();
  renderProgramsPage();
  toast(state.travelMode ? '✈ Travel mode on' : 'Travel mode off');
}

function switchProgram(id) {
  if (!PROGRAMS[id]) return;
  const state = getProgramState();
  if (state.programId === id) return;
  state.programId = id;
  state.startDate = today();
  state.travelMode = false;
  saveProgramState(state);
  PLAN = buildPLAN();
  renderProgramsPage();
  refreshDashboard();
  toast(`Switched to ${PROGRAMS[id].name} program — Week 1 starts today`);
}

// ── Plan reference page ───────────────────────────────
function renderPlanPage() {
  const prog = getActiveProgram();
  const travel = isTravelMode();
  const source = travel ? prog.travel : prog.workouts;
  const dayLabels = { push:'Push', pull:'Pull', legs:'Legs', upper_a:'Upper A', upper_b:'Upper B', lower_a:'Lower A', lower_b:'Lower B' };

  // Update plan page title
  const titleEl = document.getElementById('plan-prog-title');
  if (titleEl) titleEl.textContent = prog.name + (travel ? ' — Travel mode' : '');

  // Update tabs
  const tabsEl = document.getElementById('plan-tabs');
  if (tabsEl) {
    tabsEl.innerHTML = Object.keys(source).map((day, i) =>
      `<button class="btn btn-ghost btn-sm" onclick="showPlanTab('${day}',this)" ${i===0?`style="border-color:var(--accent);color:var(--accent);"`:''}>
        ${dayLabels[day]||day}
      </button>`
    ).join('');
  }

  // Render each day tab
  const tabsContainer = document.getElementById('plan-tabs-container');
  if (tabsContainer) {
    tabsContainer.innerHTML = Object.entries(source).map(([day, exs], i) =>
      `<div class="plan-tab" id="plantab-${day}" style="${i===0?'':'display:none'}">
        <table style="width:100%">
          <thead><tr><th style="width:28px"></th><th>Exercise</th><th>Sets</th><th>Reps</th><th>Notes</th></tr></thead>
          <tbody>
            ${exs.map((ex, j) => `<tr>
              <td class="num" style="color:var(--text3)">${j+1}</td>
              <td style="font-weight:500;color:var(--text)">${ex.name}</td>
              <td class="num">${ex.sets}</td>
              <td class="num">${ex.reps}</td>
              <td style="font-size:12px;color:var(--text3)">${ex.note}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`
    ).join('');
  }
}

function showPlanTab(tab, el) {
  document.querySelectorAll('.plan-tab').forEach(t => t.style.display = 'none');
  document.getElementById('plantab-' + tab).style.display = 'block';
  document.querySelectorAll('#plan-tabs .btn').forEach(b => { b.style.borderColor = ''; b.style.color = ''; });
  el.style.borderColor = 'var(--accent)'; el.style.color = 'var(--accent)';
}

// ── Strava integration ────────────────────────────────
const STRAVA_CLIENT_ID = '218912';
const STRAVA_REDIRECT  = 'https://fittttt.netlify.app/strava-callback';
const STRAVA_SCOPE     = 'activity:read_all';

function stravaConnect() {
  const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(STRAVA_REDIRECT)}&response_type=code&scope=${STRAVA_SCOPE}`;
  window.location.href = url;
}

function stravaSetConnected(athleteName) {
  const btnData = document.getElementById('strava-btn-data');
  const syncBtnData = document.getElementById('strava-sync-btn-data');
  const badgeData = document.getElementById('strava-badge-data');
  if (btnData) btnData.style.display = 'none';
  status.style.display = 'block';
  status.style.color = '#fc4c02';
  status.textContent = '⚡ ' + (athleteName || 'Connected');
  if (syncBtnData) syncBtnData.style.display = '';
}

async function stravaRefreshToken() {
  const refreshToken = cacheGet('strava_refresh_token');
  const expiresAt    = cacheGet('strava_expires_at');
  if (!refreshToken) return null;
  // Token still valid
  if (expiresAt && Date.now() / 1000 < expiresAt - 60) {
    return cacheGet('strava_access_token');
  }
  // Refresh it via our Netlify function
  try {
    const res = await fetch('/.netlify/functions/strava-refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    const data = await res.json();
    if (data.access_token) {
      cacheSet('strava_access_token', data.access_token);
      cacheSet('strava_expires_at', data.expires_at);
      await sbWrite('strava_access_token', data.access_token);
      await sbWrite('strava_expires_at', data.expires_at);
      return data.access_token;
    }
  } catch(e) {}
  return cacheGet('strava_access_token');
}

async function stravaSyncRuns() {
  const btn = document.getElementById('strava-sync-btn-data');
  if (btn) { btn.textContent = 'Syncing...'; btn.disabled = true; }

  const token = await stravaRefreshToken();
  if (!token) { toast('Strava not connected'); if (btn) { btn.textContent = '↓ Sync runs'; btn.disabled = false; } return; }

  try {
    const res = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=50&page=1', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const activities = await res.json();
    if (!Array.isArray(activities)) {
      const msg = activities?.message || activities?.errors?.[0]?.message || 'unknown error';
      toast('Strava sync failed: ' + msg);
      if (btn) { btn.textContent = '↓ Sync runs'; btn.disabled = false; }
      return;
    }

    const runs = activities.filter(a => {
      const t = (a.sport_type || a.type || '').toLowerCase();
      return ['run','walk','hike','trailrun','virtualrun','workout'].includes(t);
    });
    const existing = getRuns();
    const existingStravaIds = new Set(existing.filter(r => r.strava_id).map(r => String(r.strava_id)));

    let added = 0;
    runs.forEach(r => {
      if (existingStravaIds.has(String(r.id))) return;
      const distMiles = (r.distance / 1609.344).toFixed(2);
      const durMin    = Math.round(r.moving_time / 60);
      const paceSec   = r.distance > 0 ? r.moving_time / (r.distance / 1609.344) : 0;
      const paceMin   = Math.floor(paceSec / 60);
      const paceSecs  = Math.round(paceSec % 60);
      const paceStr   = paceSec > 0 ? `${paceMin}:${String(paceSecs).padStart(2,'0')}` : '—';
      const date      = r.start_date_local.split('T')[0];
      const sportType = (r.sport_type || r.type || 'Run').toLowerCase();
      const typeMap = { run: 'run', virtualrun: 'run', trailrun: 'run', walk: 'walk', hike: 'walk' };
      const type = typeMap[sportType] || 'run';
      existing.push({
        id: Date.now() + Math.random(),
        strava_id: r.id,
        date,
        type,
        distance: distMiles,
        duration: durMin,
        pace: paceStr,
        notes: r.name || '',
      });
      added++;
    });

    if (added > 0) {
      saveRuns(existing);
      refreshDashboard();
      renderHistory('all');
      setImportMeta('strava', { count: added });
      toast(`Synced ${added} run${added !== 1 ? 's' : ''} from Strava ✓`);
    } else {
      const types = [...new Set(activities.map(a => a.sport_type || a.type))].join(', ');
      toast(`Up to date — ${activities.length} activities fetched, ${runs.length} runs found (${types})`);
    }
  } catch(e) {
    toast('Strava sync error — try again');
  }
  if (btn) { btn.textContent = '↓ Sync runs'; btn.disabled = false; }
}

// Handle OAuth callback params on page load
function stravaHandleCallback() {
  const params = new URLSearchParams(window.location.search);
  const token   = params.get('strava_access_token');
  const refresh = params.get('strava_refresh_token');
  const expires = params.get('strava_expires_at');
  const athlete = params.get('strava_athlete');
  const error   = params.get('strava_error');

  if (error) { toast('Strava connection failed: ' + error); return; }
  if (!token) return;

  // Store tokens
  cacheSet('strava_access_token', token);
  cacheSet('strava_refresh_token', refresh);
  cacheSet('strava_expires_at', parseInt(expires));
  sbWrite('strava_access_token', token);
  sbWrite('strava_refresh_token', refresh);
  sbWrite('strava_expires_at', parseInt(expires));

  let athleteName = 'Connected';
  try { athleteName = JSON.parse(athlete)?.name || 'Connected'; } catch {}
  cacheSet('strava_athlete', athleteName);
  sbWrite('strava_athlete', athleteName);

  stravaSetConnected(athleteName);
  toast('Strava connected ✓');

  // Clean URL
  window.history.replaceState({}, document.title, '/');
}

// Check if already connected on load
async function stravaInit() {
  // Pull tokens from Supabase if not in cache
  const keys = ['strava_access_token','strava_refresh_token','strava_expires_at','strava_athlete'];
  await Promise.all(keys.map(k => sbRead(k)));
  const token = cacheGet('strava_access_token');
  if (token) {
    const name = cacheGet('strava_athlete') || 'Connected';
    stravaSetConnected(name);
  }
}

// ── AI meal estimator ─────────────────────────────────
async function aiEstimateMeal() {
  const input = document.getElementById('ai-meal-input').value.trim();
  if (!input) { toast('Describe your meal first'); return; }

  const btn = document.getElementById('ai-estimate-btn');
  const status = document.getElementById('ai-meal-status');
  btn.textContent = 'Estimating...';
  btn.disabled = true;
  status.style.display = 'block';
  status.textContent = 'Asking Claude...';

  try {
    const response = await fetch('/.netlify/functions/ai-meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: input })
    });

    const data = await response.json();
    const text = data.result || '';

    let parsed;
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      throw new Error('Could not parse response');
    }

    if (!parsed.items?.length) throw new Error('No items returned');

    // Populate meal name
    if (parsed.meal_name) {
      document.getElementById('food-meal-name').value = parsed.meal_name;
    }

    // Clear existing items and populate with AI estimates
    document.getElementById('food-item-rows').innerHTML = '';
    foodItemCount = 0;
    parsed.items.forEach(item => {
      foodItemCount++;
      const id = 'fi-' + foodItemCount;
      const div = document.createElement('div');
      div.id = id;
      div.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr auto;gap:6px;margin-bottom:6px;align-items:center;';
      div.innerHTML = `
        <input type="text" value="${item.name}" style="font-size:13px;">
        <input type="number" value="${Math.round(item.cal)}" min="0" style="font-size:13px;" class="fi-cal">
        <input type="number" value="${item.protein.toFixed(1)}" min="0" step="0.1" style="font-size:13px;" class="fi-pro">
        <input type="number" value="${item.carbs.toFixed(1)}" min="0" step="0.1" style="font-size:13px;" class="fi-carb">
        <input type="number" value="${item.fat.toFixed(1)}" min="0" step="0.1" style="font-size:13px;" class="fi-fat">
        <button class="btn-icon" onclick="document.getElementById('${id}').remove()" title="Remove">×</button>
      `;
      document.getElementById('food-item-rows').appendChild(div);
    });

    const total = parsed.items.reduce((s, i) => s + i.cal, 0);
    status.textContent = `Estimated ${parsed.items.length} items · ~${Math.round(total)} cal total. Review and adjust if needed.`;
    status.style.color = 'var(--accent2)';
    document.getElementById('ai-meal-input').value = '';
    toast('Meal estimated — review and save');

  } catch(e) {
    status.textContent = 'Estimation failed — try rephrasing or add items manually';
    status.style.color = 'var(--red)';
    toast('AI estimation failed');
  }

  btn.textContent = 'Estimate';
  btn.disabled = false;
}

// ── Export / Import ───────────────────────────────────
function exportData() {
  const data = {
    version: 1,
    exported: new Date().toISOString(),
    workouts: getWorkouts(),
    runs: getRuns(),
    bodystats: getStats(),
    meals: getMeals(),
    routes: getRoutes(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().split('T')[0];
  a.href = url;
  a.download = 'progress-tracker-' + dateStr + '.json';
  a.click();
  URL.revokeObjectURL(url);
  setImportMeta('backup_export', {});
  toast('Data exported ✓');
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    let data;
    // Parse
    try { data = JSON.parse(e.target.result); }
    catch(err) { toast('Could not parse file — not valid JSON'); event.target.value = ''; return; }

    // Count what we found
    const w = Array.isArray(data.workouts)  ? data.workouts.length  : 0;
    const r = Array.isArray(data.runs)      ? data.runs.length      : 0;
    const b = Array.isArray(data.bodystats) ? data.bodystats.length : 0;
    const m = Array.isArray(data.meals)     ? data.meals.length     : 0;
    const total = w + r + b + m;

    if (total === 0) {
      toast('File opened but no data found inside — wrong file?');
      event.target.value = '';
      return;
    }

    // Write to localStorage + Supabase
    if (w) saveWorkouts(data.workouts);
    if (r) saveRuns(data.runs);
    if (b) saveBodyStats(data.bodystats);
    if (m) saveMeals(data.meals);
    if (data.routes) saveRoutes(data.routes);

    // Re-render all pages
    refreshDashboard();
    const statsDateEl = document.getElementById('stats-date');
    if (statsDateEl && !statsDateEl.value) statsDateEl.value = today();
    const foodDateEl = document.getElementById('food-date');
    if (foodDateEl && !foodDateEl.value) foodDateEl.value = today();
    renderStatsTable();
    renderHistory('all');
    try { renderFoodPage(); } catch(ex) {}

    const summary = [
      w && `${w} workout${w!==1?'s':''}`,
      r && `${r} run${r!==1?'s':''}`,
      b && `${b} body stat${b!==1?'s':''}`,
      m && `${m} meal${m!==1?'s':''}`,
    ].filter(Boolean).join(' · ');
    toast(`Loaded: ${summary}`);
    event.target.value = '';
  };
  reader.onerror = () => { toast('Could not read file'); event.target.value = ''; };
  reader.readAsText(file);
}

// ── Theme toggle ──────────────────────────────────────
function toggleTheme() {
  const isLight = document.body.classList.toggle('light');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  document.getElementById('theme-toggle').textContent = isLight ? '◑' : '☀';
  if (document.getElementById('page-charts').classList.contains('active')) renderCharts();
  updateMapTheme();
}

function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'light') {
    document.body.classList.add('light');
    document.getElementById('theme-toggle').textContent = '◑';
  }
}

// ── Hevy CSV import ───────────────────────────────────
function importHevyCSV(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const lines = e.target.result.split('\n').filter(l => l.trim());
      if (lines.length < 2) { toast('CSV appears empty'); return; }

      // Parse CSV respecting quoted fields
      function parseCSVLine(line) {
        const fields = [];
        let cur = '', inQuote = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') { inQuote = !inQuote; }
          else if (ch === ',' && !inQuote) { fields.push(cur.trim()); cur = ''; }
          else { cur += ch; }
        }
        fields.push(cur.trim());
        return fields;
      }

      const headers = parseCSVLine(lines[0]);
      const idx = {};
      headers.forEach((h, i) => idx[h.replace(/"/g,'')] = i);

      // Group rows by workout (title + start_time)
      const workoutMap = new Map();
      for (let i = 1; i < lines.length; i++) {
        const f = parseCSVLine(lines[i]);
        if (f.length < 5) continue;
        const title     = f[idx['title']] || '';
        const startRaw  = f[idx['start_time']] || '';
        const endRaw    = f[idx['end_time']] || '';
        const exName    = f[idx['exercise_title']] || '';
        const setIndex  = parseInt(f[idx['set_index']]) || 0;
        const setType   = f[idx['set_type']] || 'normal';
        const weightLbs = f[idx['weight_lbs']] || '';
        const reps      = f[idx['reps']] || '';
        const durSecs   = f[idx['duration_seconds']] || '';

        if (!title || !startRaw || !exName) continue;
        const key = title + '||' + startRaw;

        if (!workoutMap.has(key)) {
          // Parse date from "20 Mar 2026, 19:01"
          const datePart = startRaw.split(',')[0].trim();
          const [day, mon, year] = datePart.split(' ');
          const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
          const date = `${year}-${months[mon] || '01'}-${day.padStart(2,'0')}`;

          // Parse duration from start/end times
          let durationMin = null;
          try {
            const parseTime = s => { const [d,t] = s.split(', '); const [h,m] = t.trim().split(':'); const [dd,mm,yyyy] = d.trim().split(' '); const mo = months[mm]||'01'; return new Date(`${yyyy}-${mo}-${dd.padStart(2,'0')}T${h.padStart(2,'0')}:${m}:00`); };
            const start = parseTime(startRaw);
            const end = parseTime(endRaw);
            durationMin = Math.round((end - start) / 60000);
          } catch {}

          // Guess type from title
          const titleLower = title.toLowerCase();
          let type = 'custom';
          if (titleLower.includes('push') || titleLower.includes('chest') || titleLower.includes('upper')) type = 'push';
          else if (titleLower.includes('pull') || titleLower.includes('back') || titleLower.includes('bis')) type = 'pull';
          else if (titleLower.includes('leg') || titleLower.includes('lower')) type = 'legs';

          workoutMap.set(key, { id: Date.now() + Math.random(), date, type, notes: title + (durationMin ? ` · ${durationMin} min` : ''), exercises: new Map() });
        }

        const workout = workoutMap.get(key);
        if (!workout.exercises.has(exName)) workout.exercises.set(exName, []);

        const set = { logged: true };
        if (weightLbs) set.weight = weightLbs;
        if (reps) set.reps = reps;
        else if (durSecs) set.reps = durSecs + 's';
        if (setType === 'warmup') set.type = 'warmup';
        workout.exercises.get(exName).push(set);
      }

      // Convert Map to array format
      const existing = getWorkouts();
      const existingKeys = new Set(existing.map(w => w.date + '||' + w.notes?.split(' ·')[0]));
      let added = 0;

      workoutMap.forEach(workout => {
        const key = workout.date + '||' + workout.notes?.split(' ·')[0];
        if (existingKeys.has(key)) return; // skip duplicates
        const exercises = [];
        workout.exercises.forEach((sets, name) => exercises.push({ name, sets }));
        existing.push({ id: workout.id, date: workout.date, type: workout.type, notes: workout.notes, exercises });
        added++;
      });

      if (added === 0) { toast('All workouts already imported'); return; }
      saveWorkouts(existing);
      refreshDashboard();
      renderHistory('all');
      setImportMeta('hevy', { count: added });
      toast(`Imported ${added} workout${added !== 1 ? 's' : ''} from Hevy ✓`);
    } catch(err) {
      console.error(err);
      toast('Import failed — check file format');
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

// ── Nike TCX import ───────────────────────────────────
async function importNikeTCX(event) {
  const file = event.target.files[0];
  if (!file) return;
  toast('Reading Nike data...');

  try {
    let tcxFiles = [];

    if (file.name.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(file);
      const promises = [];
      zip.forEach((path, entry) => {
        if (path.endsWith('.tcx') && !path.includes('__MACOSX')) {
          promises.push(entry.async('text').then(text => ({ name: path, text })));
        }
      });
      tcxFiles = await Promise.all(promises);
    } else {
      const text = await file.text();
      tcxFiles = [{ name: file.name, text }];
    }

    if (!tcxFiles.length) { toast('No TCX files found in ZIP'); return; }

    const parser = new DOMParser();
    const parsed = [];

    tcxFiles.forEach(({ name, text }) => {
      try {
        const doc = parser.parseFromString(text, 'application/xml');
        const activity = doc.querySelector('Activity');
        if (!activity) return;

        const sport = activity.getAttribute('Sport') || 'Running';
        const idEl = activity.querySelector('Id');
        if (!idEl) return;
        const dateStr = idEl.textContent.trim().slice(0, 10);

        const lap = activity.querySelector('Lap');
        if (!lap) return;

        const secsEl = lap.querySelector('TotalTimeSeconds');
        const distEl = lap.querySelector('DistanceMeters');
        if (!secsEl || !distEl) return;

        const secs = parseFloat(secsEl.textContent.trim());
        const distM = parseFloat(distEl.textContent.trim());
        if (!secs || isNaN(secs)) return;

        const distMi = distM / 1609.344;
        const durMin = Math.round(secs / 60 * 10) / 10;

        let paceStr = '—';
        if (distMi > 0.1) {
          const paceSec = secs / distMi;
          paceStr = `${Math.floor(paceSec / 60)}:${String(Math.round(paceSec % 60)).padStart(2, '0')}`;
        }

        // Map sport type
        const sportLower = sport.toLowerCase();
        const type = sportLower.includes('run') ? 'run' :
                     sportLower.includes('walk') ? 'walk' : 'easy';

        // Extract GPS track — every 5th trackpoint with a position
        const trackpoints = doc.querySelectorAll('Trackpoint');
        const coords = [];
        let i = 0;
        trackpoints.forEach(tp => {
          i++;
          if (i % 5 !== 0) return;
          const lat = tp.querySelector('LatitudeDegrees');
          const lon = tp.querySelector('LongitudeDegrees');
          if (lat && lon) {
            const la = parseFloat(lat.textContent);
            const lo = parseFloat(lon.textContent);
            if (!isNaN(la) && !isNaN(lo)) coords.push([la, lo]);
          }
        });

        parsed.push({
          id: Date.now() + Math.random(),
          date: dateStr,
          type,
          distance: distMi > 0.01 ? distMi.toFixed(2) : '0',
          duration: durMin,
          pace: paceStr,
          notes: `Nike Run Club · ${sport}`,
          nike: true,
          _coords: coords // temp, stored separately
        });
      } catch(e) {}
    });

    if (!parsed.length) { toast('No valid activities found'); return; }

    // Always extract GPS routes — even for runs already imported
    const routes = getRoutes();
    let routesAdded = 0;
    parsed.forEach(r => {
      if (r._coords && r._coords.length > 2) {
        const key = `nike_${r.date}_${r.duration}`;
        if (!routes[key] || routes[key].length < r._coords.length) {
          routes[key] = r._coords;
          routesAdded++;
        }
      }
      delete r._coords;
    });
    if (routesAdded > 0) saveRoutes(routes);

    // Deduplicate runs
    const existing = getRuns();
    const existingKeys = new Set(existing.map(r => `${r.date}|${r.duration}`));
    const toAdd = parsed.filter(r => !existingKeys.has(`${r.date}|${r.duration}`));

    if (toAdd.length > 0) {
      saveRuns([...existing, ...toAdd]);
    }

    refreshDashboard();
    refreshHome();
    renderHistory('all');
    if (document.getElementById('page-routes').classList.contains('active')) renderRoutesList();
    setImportMeta('nike', { runs: toAdd.length, routes: routesAdded });

    const msg = toAdd.length > 0
      ? `Imported ${toAdd.length} run${toAdd.length !== 1 ? 's' : ''} + ${routesAdded} GPS routes from Nike ✓`
      : `Updated ${routesAdded} GPS route${routesAdded !== 1 ? 's' : ''} from Nike ✓`;
    toast(msg);
  } catch(err) {
    console.error(err);
    toast('Import failed — try uploading the tcx.zip directly');
  }
  event.target.value = '';
}

// ── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initMobileLayout();
  setupBeforeUnload();
  stravaHandleCallback();
  // Restore any in-progress workout from before reload
  const restored = restoreSessionIfExists();
  if (!restored) refreshHome();
  document.getElementById('stats-date').value = today();
  document.getElementById('workout-date').value = today();
  document.getElementById('run-date').value = today();
  initWorkoutForm();
  syncFromSupabase();
  stravaInit();
});