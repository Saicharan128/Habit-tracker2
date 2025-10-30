// Front-end logic aligned with app.py API (dark-mode, responsive, demo-aware)
'use strict';

let habitChart = null;
let currentHabitId = null;
let currentRange = 30;
const chartRanges = [7, 14, 30, 90];
const DEFAULT_CHART_MESSAGE = 'Add a habit to see its ideal vs actual progress.';

async function ensureDemoSeed() {
  try {
    const r = await fetch('/api/habits');
    if (!r.ok) return false;
    const list = await r.json();
    if (Array.isArray(list) && list.length > 0) return true;
    await fetch('/api/demo/reset', { method: 'POST' }).catch(()=>{});
    return true;
  } catch { return false; }
}

function updateChartVisibility(state, message = '') {
  const canvas = document.getElementById('habitChart');
  const placeholder = document.getElementById('chartEmptyState');
  if (!canvas || !placeholder) return;
  if (message) placeholder.textContent = message;
  placeholder.dataset.state = state;
  placeholder.setAttribute('aria-hidden', state === 'ready' ? 'true' : 'false');
  if (state === 'ready') {
    placeholder.classList.add('hidden');
    canvas.style.display = 'block';
    canvas.removeAttribute('aria-hidden');
  } else {
    placeholder.classList.remove('hidden');
    canvas.style.display = 'none';
    canvas.setAttribute('aria-hidden', 'true');
    if ((state === 'empty' || state === 'error') && habitChart) { habitChart.destroy(); habitChart = null; }
  }
}

function showToast(message, tone = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  if (tone !== 'info') toast.classList.add(tone);
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 250); }, 3200);
}

// Ideal self
async function loadIdealSelf() {
  try {
    const res = await fetch('/api/idealself');
    if (!res.ok) throw new Error('Failed to load ideal self');
    const data = await res.json();
    renderIdealSelfSummary(data.vision || '', data.focus_areas || []);
    const visionField = document.getElementById('idealVision');
    const focusField = document.getElementById('idealFocusAreas');
    if (visionField && data.vision) visionField.value = data.vision;
    if (focusField && data.focus_areas) focusField.value = data.focus_areas.join(', ');
  } catch (err) { console.error(err); }
}

function renderIdealSelfSummary(vision, focusAreas) {
  const summary = document.getElementById('idealSelfSummary');
  const visionCopy = document.getElementById('idealVisionCopy');
  const focusCopy = document.getElementById('idealFocusCopy');
  if (!summary) return;
  const hasAny = (vision && vision.trim().length) || (focusAreas && focusAreas.length);
  summary.style.display = hasAny ? 'block' : 'none';
  if (visionCopy) visionCopy.textContent = vision || '';
  if (focusCopy) focusCopy.textContent = focusAreas && focusAreas.length ? `Focus areas: ${focusAreas.join(' • ')}` : '';
}

async function saveIdealSelf(event) {
  event.preventDefault();
  const vision = (document.getElementById('idealVision')?.value || '').trim();
  const raw = document.getElementById('idealFocusAreas')?.value || '';
  const focus_areas = raw.split(',').map(s => s.trim()).filter(Boolean);
  try {
    const res = await fetch('/api/idealself', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vision, focus_areas }) });
    if (!res.ok) throw new Error('Save failed');
    renderIdealSelfSummary(vision, focus_areas);
    showToast('Ideal self updated', 'success');
  } catch (err) { console.error(err); showToast('Could not save ideal self', 'error'); }
}

// Journal
async function addJournalEntry(event) {
  event.preventDefault();
  const textarea = document.getElementById('journalInput');
  const content = (textarea?.value || '').trim();
  if (!content) return;
  try {
    const res = await fetch('/api/journal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
    if (!res.ok) throw new Error('Failed to save entry');
    if (textarea) textarea.value = '';
    showToast('Journal entry saved', 'success');
    await loadJournalEntries();
  } catch (err) { console.error(err); showToast('Could not save entry', 'error'); }
}

async function loadJournalEntries() {
  try {
    const res = await fetch('/api/journal');
    if (!res.ok) throw new Error('Failed to fetch journal');
    const entries = await res.json();
    entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const list = document.getElementById('journalEntries');
    if (!list) return;
    list.innerHTML = '';
    if (!entries.length) {
      const empty = document.createElement('li'); empty.className = 'empty-state';
      empty.textContent = 'No journal entries yet. Capture a reflection to start building insights.';
      list.appendChild(empty); return;
    }
    entries.forEach(entry => {
      const li = document.createElement('li'); li.className = 'journal-entry';
      const time = document.createElement('time'); time.textContent = new Date(entry.timestamp).toLocaleString();
      const content = document.createElement('p'); content.textContent = entry.content;
      li.appendChild(time); li.appendChild(content); list.appendChild(li);
    });
  } catch (err) { console.error(err); showToast('Could not load journal entries', 'error'); }
}

// Habits
async function addHabit(event) {
  event.preventDefault();
  const name = (document.getElementById('habitName')?.value || '').trim();
  if (!name) return;
  const color = document.getElementById('habitColor')?.value || '#2f7cff';
  const target_per_week = parseInt(document.getElementById('targetPerWeek')?.value || '7', 10);
  try {
    const res = await fetch('/api/habits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color, target_per_week }) });
    if (!res.ok) throw new Error('Failed to add habit');
    const created = await res.json();
    currentHabitId = created?.id || currentHabitId;
    document.getElementById('habitForm')?.reset();
    const colorInput = document.getElementById('habitColor'); if (colorInput) colorInput.value = '#2f7cff';
    showToast('Habit added', 'success');
    await loadHabits(); if (currentHabitId) await loadHabitProgress();
  } catch (err) { console.error(err); showToast('Could not add habit', 'error'); }
}

async function toggleHabitCompletion(habit) {
  try {
    const res = await fetch(`/api/habits/${habit.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: !habit.completed }) });
    if (!res.ok) throw new Error('Failed to update habit');
    await loadHabits(); if (currentHabitId === habit.id) await loadHabitProgress();
  } catch (err) { console.error(err); showToast('Could not update habit', 'error'); }
}

function renderHabits(habits) {
  const list = document.getElementById('habitList'); if (!list) return; list.innerHTML = '';
  if (!habits.length) {
    const li = document.createElement('li'); li.className = 'empty-state';
    li.innerHTML = '<strong>No habits yet.</strong><p style="margin-top:8px;">Translate the ideal self into a measurable commitment to track.</p>';
    list.appendChild(li); updateChartVisibility('empty', DEFAULT_CHART_MESSAGE); return;
  }
  habits.forEach(habit => {
    const li = document.createElement('li'); li.className = 'habit-item';
    li.style.borderLeft = `4px solid ${habit.color || '#2f7cff'}`;
    const header = document.createElement('div'); header.className = 'habit-header';
    const title = document.createElement('h3'); title.textContent = habit.name; header.appendChild(title);
    const status = document.createElement('span'); status.className = `badge ${habit.completed ? 'success' : 'warning'}`;
    status.textContent = habit.completed ? 'Completed today' : 'Pending today'; header.appendChild(status);
    li.appendChild(header);
    const meta = document.createElement('div'); meta.className = 'habit-meta';
    const safeTarget = Number.isFinite(habit.target_per_week) && habit.target_per_week > 0 ? habit.target_per_week : 7;
    const safeStreak = Number.isFinite(habit.streak) && habit.streak >= 0 ? habit.streak : 0;
    const safeBest = Number.isFinite(habit.best_streak) && habit.best_streak >= 0 ? habit.best_streak : 0;
    const safeScore = Number.isFinite(habit.score) ? habit.score : 0;
    meta.textContent = `Target: ${safeTarget}/week • Streak: ${safeStreak} (best ${safeBest}) • Lifetime score: ${safeScore.toFixed(1)}%`;
    li.appendChild(meta);
    const progress = document.createElement('div'); progress.className = 'habit-progress';
    const idealBar = document.createElement('div'); idealBar.className = 'ideal';
    const idealRatio = Math.min(1, Math.max(0, safeTarget / 7)); idealBar.style.width = `${Math.round(idealRatio * 100)}%`;
    const actualBar = document.createElement('div'); actualBar.className = 'actual';
    const actualWidth = Math.min(100, Math.max(0, Math.round(safeScore))); actualBar.style.width = `${actualWidth}%`;
    actualBar.style.background = `linear-gradient(90deg, ${habit.color || '#54e0a6'}, rgba(84, 224, 166, 0.35))`;
    progress.appendChild(idealBar); progress.appendChild(actualBar); li.appendChild(progress);
    const actions = document.createElement('div'); actions.className = 'habit-actions';
    const completeBtn = document.createElement('button'); completeBtn.className = 'secondary';
    completeBtn.textContent = habit.completed ? 'Undo today' : 'Mark complete today';
    completeBtn.addEventListener('click', () => toggleHabitCompletion(habit));
    const chartBtn = document.createElement('button'); chartBtn.className = 'ghost'; chartBtn.textContent = 'View progress';
    chartBtn.addEventListener('click', () => { currentHabitId = habit.id; updateHabitSelectOptions(habits); loadHabitProgress(); });
    actions.appendChild(completeBtn); actions.appendChild(chartBtn); li.appendChild(actions);
    list.appendChild(li);
  });
}

function updateHabitSelectOptions(habits) {
  const select = document.getElementById('habitSelect'); if (!select) return;
  const previous = currentHabitId; select.innerHTML = '';
  habits.forEach(habit => {
    const option = document.createElement('option'); option.value = habit.id; option.textContent = habit.name;
    if ((previous && previous === habit.id) || (!previous && !currentHabitId)) { option.selected = true; currentHabitId = habit.id; }
    select.appendChild(option);
  });
  if (habits.length) {
    const found = habits.some(h => h.id === currentHabitId);
    if (!found) { currentHabitId = habits[0].id; select.value = String(currentHabitId); }
  } else {
    const option = document.createElement('option'); option.textContent = 'No habits yet'; option.disabled = true; option.selected = true; select.appendChild(option); currentHabitId = null;
  }
  select.disabled = habits.length === 0;
}

async function loadHabits() {
  try {
    const seeded = await ensureDemoSeed();
    const res = await fetch('/api/habits'); if (!res.ok) throw new Error('Failed to fetch habits');
    const habits = await res.json();
    renderHabits(habits); updateHabitSelectOptions(habits); setupRangeButtons();
    if (currentHabitId) await loadHabitProgress(); else updateChartVisibility('empty', DEFAULT_CHART_MESSAGE);
  } catch (err) { console.error(err); showToast('Could not load habits', 'error'); updateChartVisibility('error', 'Could not load habits.'); }
}

async function loadHabitProgress() {
  if (!currentHabitId) return; updateChartVisibility('loading', 'Loading progress...');
  try {
    const res = await fetch(`/api/habits/${currentHabitId}/progress?days=${currentRange}`); if (!res.ok) throw new Error('Failed to fetch progress');
    const data = await res.json(); const canvas = document.getElementById('habitChart');
    if (!canvas || typeof Chart === 'undefined') { updateChartVisibility('error', 'Chart unavailable.'); showToast('Progress chart unavailable right now', 'error'); return; }
    const ctx = canvas.getContext('2d'); if (habitChart) habitChart.destroy();
    const labels = data.dates.map(d => d.slice(5));
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    const rootStyles = getComputedStyle(document.documentElement);
    const tickColor = rootStyles.getPropertyValue('--text-secondary').trim() || (theme === 'light' ? '#374151' : '#8fa0c7');
    const gridColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
    const hexToRGBA = (hex, alpha) => { const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex); if (!m) return `rgba(84,224,166,${alpha})`; const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16); return `rgba(${r},${g},${b},${alpha})`; };
    const actualFill = (context) => { const chart = context.chart; const { ctx: g, chartArea } = chart || {}; if (!chartArea) return 'rgba(84,224,166,0.18)'; const color = (context?.dataset?.borderColor) || '#54e0a6'; const gradient = g.createLinearGradient(0, chartArea.top, 0, chartArea.bottom); gradient.addColorStop(0, hexToRGBA(color, 0.28)); gradient.addColorStop(1, hexToRGBA(color, 0.06)); return gradient; };
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f59e0b';
    habitChart = new Chart(ctx, { type: 'line', data: { labels, datasets: [
      { label: 'Ideal pace', data: data.ideal, borderColor: accent, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, borderDash: [6,6], tension: 0.2, order: 1, fill: false },
      { label: 'Actual progress', data: data.actual, borderColor: data.habit.color || '#54e0a6', backgroundColor: actualFill, borderWidth: 3, pointRadius: 2, pointHoverRadius: 6, tension: 0.35, cubicInterpolationMode: 'monotone', fill: 'origin', order: 2 }
    ]}, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 800, easing: 'easeOutQuart' }, interaction: { mode: 'index', intersect: false }, plugins: {
      legend: { position: 'bottom', labels: { color: tickColor, usePointStyle: true, boxWidth: 10 } }, title: { display: true, text: `${data.habit.name} (${data.habit.target_per_week}/week ideal)`, color: rootStyles.getPropertyValue('--text-primary').trim() || '#111111', font: { size: 16, weight: '600' } }
    }, scales: { x: { ticks: { color: tickColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, grid: { color: gridColor } }, y: { beginAtZero: true, ticks: { color: tickColor }, grid: { color: gridColor } } } } });
    updateChartVisibility('ready');
  } catch (err) { console.error(err); updateChartVisibility('error', 'Could not load progress right now.'); showToast('Could not load progress', 'error'); }
}

function setupRangeButtons() {
  const container = document.getElementById('rangeButtons'); if (!container) return; container.innerHTML = '';
  chartRanges.forEach(range => { const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = `${range} days`; if (range === currentRange) btn.classList.add('active'); btn.disabled = !currentHabitId; btn.addEventListener('click', () => { currentRange = range; setupRangeButtons(); loadHabitProgress(); }); container.appendChild(btn); });
}

function setupNavigation() {
  const navButtons = document.querySelectorAll('nav.primary-nav button');
  navButtons.forEach(btn => { btn.addEventListener('click', () => { const target = document.getElementById(btn.dataset.target); if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); navButtons.forEach(b => b.classList.remove('active')); btn.classList.add('active'); } }); });
  if (navButtons.length) navButtons[0].classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation(); setupRangeButtons(); updateChartVisibility('empty', DEFAULT_CHART_MESSAGE);
  loadIdealSelf(); loadHabits(); loadJournalEntries();
  document.getElementById('idealSelfForm')?.addEventListener('submit', saveIdealSelf);
  document.getElementById('journalForm')?.addEventListener('submit', addJournalEntry);
  document.getElementById('habitForm')?.addEventListener('submit', addHabit);
  document.getElementById('habitSelect')?.addEventListener('change', (event) => { const nextId = parseInt(event.target.value, 10); if (!Number.isNaN(nextId)) { currentHabitId = nextId; loadHabitProgress(); } });
  document.getElementById('resetZoomBtn')?.addEventListener('click', () => { try { if (habitChart && habitChart.resetZoom) habitChart.resetZoom(); } catch (e) { console.error(e); } });
  document.getElementById('demoSeedBtn')?.addEventListener('click', async () => {
    try { await fetch('/api/demo/reset', { method: 'POST' }); showToast('Demo data loaded', 'success'); await loadHabits(); await loadJournalEntries(); } catch (e) { console.error(e); showToast('Could not load demo data', 'error'); }
  });
  // Theme
  const applyTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = theme === 'light' ? 'Dark Mode' : 'Light Mode';
  };
  applyTheme(localStorage.getItem('theme') || 'dark');
  document.getElementById('themeToggle')?.addEventListener('click', () => {
    const next = (document.documentElement.getAttribute('data-theme') === 'light') ? 'dark' : 'light';
    applyTheme(next);
  });
});
