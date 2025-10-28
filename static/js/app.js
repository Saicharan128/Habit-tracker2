let habitChart = null;
let currentHabitId = null;
let currentRange = 30;
const chartRanges = [7, 14, 30, 90];
const DEFAULT_CHART_MESSAGE = 'Add a habit to see its ideal vs actual progress.';

function updateChartVisibility(state, message = '') {
    const canvas = document.getElementById('habitChart');
    const placeholder = document.getElementById('chartEmptyState');
    if (!canvas || !placeholder) return;
    if (message) {
        placeholder.textContent = message;
    }
    placeholder.dataset.state = state;
    placeholder.setAttribute('aria-hidden', state === 'ready' ? 'true' : 'false');
    if (state === 'ready') {
        placeholder.classList.add('hidden');
        canvas.style.display = 'block';
        canvas.removeAttribute('aria-hidden');
        return;
    }

    placeholder.classList.remove('hidden');
    canvas.style.display = 'none';
    canvas.setAttribute('aria-hidden', 'true');
    if ((state === 'empty' || state === 'error') && habitChart) {
        habitChart.destroy();
        habitChart = null;
    }
}

function showToast(message, tone = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    if (tone !== 'info') {
        toast.classList.add(tone);
    }
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 250);
    }, 3200);
}

async function loadIdealSelf() {
    try {
        const response = await fetch('/api/idealself');
        if (!response.ok) throw new Error('Failed to load ideal self');
        const data = await response.json();
        const visionField = document.getElementById('idealVision');
        const focusField = document.getElementById('idealFocusAreas');
        if (data && data.vision) {
            visionField.value = data.vision;
            focusField.value = data.focus_areas.join(', ');
            renderIdealSelfSummary(data.vision, data.focus_areas);
        }
    } catch (err) {
        console.error(err);
    }
}

function renderIdealSelfSummary(vision, focusAreas) {
    const summary = document.getElementById('idealSelfSummary');
    const visionCopy = document.getElementById('idealVisionCopy');
    const focusCopy = document.getElementById('idealFocusCopy');
    if (!summary) return;
    if (!vision && (!focusAreas || !focusAreas.length)) {
        summary.style.display = 'none';
        return;
    }
    summary.style.display = 'block';
    visionCopy.textContent = vision || '';
    focusCopy.textContent = focusAreas && focusAreas.length
        ? `Focus areas: ${focusAreas.join(' · ')}`
        : '';
}

async function saveIdealSelf(event) {
    event.preventDefault();
    const vision = document.getElementById('idealVision').value.trim();
    const focusRaw = document.getElementById('idealFocusAreas').value || '';
    const focusAreas = focusRaw.split(',').map(v => v.trim()).filter(Boolean);
    try {
        const response = await fetch('/api/idealself', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vision, focus_areas: focusAreas })
        });
        if (!response.ok) throw new Error('Save failed');
        renderIdealSelfSummary(vision, focusAreas);
        showToast('Ideal self updated', 'success');
    } catch (err) {
        console.error(err);
        showToast('Could not save ideal self', 'error');
    }
}

async function addJournalEntry(event) {
    event.preventDefault();
    const textarea = document.getElementById('journalInput');
    const content = textarea.value.trim();
    if (!content) return;
    try {
        const res = await fetch('/api/journal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        if (!res.ok) throw new Error('Failed to save entry');
        textarea.value = '';
        showToast('Journal entry saved', 'success');
        await loadJournalEntries();
    } catch (err) {
        console.error(err);
        showToast('Could not save entry', 'error');
    }
}

async function loadJournalEntries() {
    try {
        const res = await fetch('/api/journal');
        if (!res.ok) throw new Error('Failed to fetch journal');
        const entries = await res.json();
        entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const list = document.getElementById('journalEntries');
        list.innerHTML = '';
        if (!entries.length) {
            const empty = document.createElement('li');
            empty.className = 'empty-state';
            empty.textContent = 'No journal entries yet. Capture a reflection to start building insights.';
            list.appendChild(empty);
            return;
        }
        entries.forEach(entry => {
            const li = document.createElement('li');
            li.className = 'journal-entry';
            const time = document.createElement('time');
            time.textContent = new Date(entry.timestamp).toLocaleString();
            const content = document.createElement('p');
            content.textContent = entry.content;
            li.appendChild(time);
            li.appendChild(content);
            list.appendChild(li);
        });
    } catch (err) {
        console.error(err);
        showToast('Could not load journal entries', 'error');
    }
}

async function addHabit(event) {
    event.preventDefault();
    const name = document.getElementById('habitName').value.trim();
    if (!name) return;
    const color = document.getElementById('habitColor').value;
    const targetPerWeek = parseInt(document.getElementById('targetPerWeek').value, 10);
    try {
        const res = await fetch('/api/habits', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color, target_per_week: targetPerWeek })
        });
        if (!res.ok) throw new Error('Failed to add habit');
        document.getElementById('habitForm').reset();
        document.getElementById('habitColor').value = '#2f7cff';
        showToast('Habit added', 'success');
        await loadHabits();
    } catch (err) {
        console.error(err);
        showToast('Could not add habit', 'error');
    }
}

async function toggleHabitCompletion(habit) {
    try {
        const res = await fetch(`/api/habits/${habit.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ completed: !habit.completed })
        });
        if (!res.ok) throw new Error('Failed to update habit');
        await loadHabits();
    } catch (err) {
        console.error(err);
        showToast('Could not update habit', 'error');
    }
}

function renderHabits(habits) {
    const list = document.getElementById('habitList');
    list.innerHTML = '';
    if (!habits.length) {
        const empty = document.createElement('li');
        empty.className = 'empty-state';
        empty.innerHTML = `<strong>No habits yet.</strong><p style="margin-top:8px;">Translate the ideal self into a measurable commitment to track.</p>`;
        list.appendChild(empty);
        return;
    }
    habits.forEach(habit => {
        const li = document.createElement('li');
        li.className = 'habit-item';
        li.style.borderLeft = `4px solid ${habit.color || '#2f7cff'}`;

        const header = document.createElement('div');
        header.className = 'habit-header';
        const title = document.createElement('h3');
        title.textContent = habit.name;
        header.appendChild(title);

        const status = document.createElement('span');
        status.className = `badge ${habit.completed ? 'success' : 'warning'}`;
        status.textContent = habit.completed ? 'Completed today' : 'Pending today';
        header.appendChild(status);
        li.appendChild(header);

        const meta = document.createElement('div');
        meta.className = 'habit-meta';
        const safeTarget = Number.isFinite(habit.target_per_week) && habit.target_per_week > 0
            ? habit.target_per_week
            : 7;
        const safeStreak = Number.isFinite(habit.streak) && habit.streak >= 0 ? habit.streak : 0;
        const safeBest = Number.isFinite(habit.best_streak) && habit.best_streak >= 0 ? habit.best_streak : 0;
        const safeScore = Number.isFinite(habit.score) ? habit.score : 0;
        meta.innerHTML = `
            Target: ${safeTarget}/week
            · Streak: ${safeStreak} (best ${safeBest})
            · Lifetime score: ${safeScore.toFixed(1)}%
        `;
        li.appendChild(meta);

        const progress = document.createElement('div');
        progress.className = 'habit-progress';
        const idealBar = document.createElement('div');
        idealBar.className = 'ideal';
        const idealRatio = Math.min(1, Math.max(0, safeTarget / 7));
        idealBar.style.width = `${Math.round(idealRatio * 100)}%`;
        const actualBar = document.createElement('div');
        actualBar.className = 'actual';
        const actualWidth = Math.min(100, Math.max(0, Math.round(safeScore)));
        actualBar.style.width = `${actualWidth}%`;
        actualBar.style.background = `linear-gradient(90deg, ${habit.color || '#54e0a6'}, rgba(84, 224, 166, 0.35))`;
        progress.appendChild(idealBar);
        progress.appendChild(actualBar);
        li.appendChild(progress);

        const actions = document.createElement('div');
        actions.className = 'habit-actions';
        const completeBtn = document.createElement('button');
        completeBtn.className = 'secondary';
        completeBtn.textContent = habit.completed ? 'Undo today' : 'Mark complete today';
        completeBtn.addEventListener('click', () => toggleHabitCompletion(habit));

        const chartBtn = document.createElement('button');
        chartBtn.className = 'ghost';
        chartBtn.textContent = 'View progress';
        chartBtn.addEventListener('click', () => {
            currentHabitId = habit.id;
            updateHabitSelectOptions(habits);
            loadHabitProgress();
        });

        actions.appendChild(completeBtn);
        actions.appendChild(chartBtn);
        li.appendChild(actions);

        list.appendChild(li);
    });
}

function updateHabitSelectOptions(habits) {
    const select = document.getElementById('habitSelect');
    const previous = currentHabitId;
    select.innerHTML = '';
    habits.forEach(habit => {
        const option = document.createElement('option');
        option.value = habit.id;
        option.textContent = habit.name;
        if ((previous && previous === habit.id) || (!previous && !currentHabitId)) {
            option.selected = true;
            currentHabitId = habit.id;
        }
        select.appendChild(option);
    });
    if (habits.length) {
        const found = habits.some(habit => habit.id === currentHabitId);
        if (!found) {
            currentHabitId = habits[0].id;
            select.value = String(currentHabitId);
        }
    }
    if (!habits.length) {
        const option = document.createElement('option');
        option.textContent = 'No habits yet';
        option.disabled = true;
        option.selected = true;
        select.appendChild(option);
        currentHabitId = null;
    }
    select.disabled = habits.length === 0;
}

async function loadHabits() {
    try {
        const res = await fetch('/api/habits');
        if (!res.ok) throw new Error('Failed to fetch habits');
        const habits = await res.json();
        renderHabits(habits);
        updateHabitSelectOptions(habits);
        setupRangeButtons();
        if (currentHabitId) {
            await loadHabitProgress();
        } else {
            updateChartVisibility('empty', DEFAULT_CHART_MESSAGE);
        }
    } catch (err) {
        console.error(err);
        showToast('Could not load habits', 'error');
    }
}

async function loadHabitProgress() {
    if (!currentHabitId) return;
    updateChartVisibility('loading', 'Loading progress…');
    try {
        const res = await fetch(`/api/habits/${currentHabitId}/progress?days=${currentRange}`);
        if (!res.ok) throw new Error('Failed to fetch progress');
        const data = await res.json();
        const ctx = document.getElementById('habitChart').getContext('2d');
        if (typeof Chart === 'undefined') {
            updateChartVisibility('error', 'Progress chart unavailable because Chart.js failed to load.');
            showToast('Progress chart unavailable right now', 'error');
            return;
        }
        if (habitChart) habitChart.destroy();
        habitChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.dates,
                datasets: [
                    {
                        label: 'Ideal pace',
                        data: data.ideal,
                        borderColor: '#5dd0ff',
                        backgroundColor: 'rgba(93, 208, 255, 0.18)',
                        borderWidth: 2,
                        tension: 0.25
                    },
                    {
                        label: 'Actual progress',
                        data: data.actual,
                        borderColor: data.habit.color || '#54e0a6',
                        backgroundColor: 'rgba(84, 224, 166, 0.22)',
                        borderWidth: 2,
                        tension: 0.25
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: '#d9e1ff' }
                    },
                    title: {
                        display: true,
                        text: `${data.habit.name} (${data.habit.target_per_week}/week ideal)`,
                        color: '#f5f8ff',
                        font: { size: 16, weight: '600' }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#8fa0c7' },
                        grid: { color: 'rgba(255, 255, 255, 0.06)' }
                    },
                    y: {
                        ticks: { color: '#8fa0c7' },
                        grid: { color: 'rgba(255, 255, 255, 0.06)' }
                    }
                }
            }
        });
        updateChartVisibility('ready');
    } catch (err) {
        console.error(err);
        updateChartVisibility('error', 'Could not load progress right now.');
        showToast('Could not load progress', 'error');
    }
}

function setupRangeButtons() {
    const container = document.getElementById('rangeButtons');
    container.innerHTML = '';
    chartRanges.forEach(range => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = `${range} days`;
        if (range === currentRange && currentHabitId) btn.classList.add('active');
        btn.disabled = !currentHabitId;
        btn.addEventListener('click', () => {
            currentRange = range;
            setupRangeButtons();
            loadHabitProgress();
        });
        container.appendChild(btn);
    });
}

function setupNavigation() {
    const navButtons = document.querySelectorAll('nav.primary-nav button');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = document.getElementById(btn.dataset.target);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                navButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
        });
    });
    if (navButtons.length) navButtons[0].classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupRangeButtons();
    updateChartVisibility('empty', DEFAULT_CHART_MESSAGE);
    loadIdealSelf();
    loadHabits();
    loadJournalEntries();

    document.getElementById('idealSelfForm').addEventListener('submit', saveIdealSelf);
    document.getElementById('journalForm').addEventListener('submit', addJournalEntry);
    document.getElementById('habitForm').addEventListener('submit', addHabit);
    document.getElementById('habitSelect').addEventListener('change', (event) => {
        const nextId = parseInt(event.target.value, 10);
        if (!Number.isNaN(nextId)) {
            currentHabitId = nextId;
            loadHabitProgress();
        }
    });
});
