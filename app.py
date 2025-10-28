from flask import Flask, render_template, request, jsonify
from datetime import datetime, date, timedelta
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///habits_journal.db'  # SQLite database file
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Define Habit model
class Habit(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    score = db.Column(db.Float, default=0.0)
    completed_days = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.now)  # Use system local time
    completed = db.Column(db.Boolean, default=False)
    streak = db.Column(db.Integer, default=0)
    best_streak = db.Column(db.Integer, default=0)
    color = db.Column(db.String(7), default='#000000')  # Default color is black
    last_completed = db.Column(db.DateTime, nullable=True)
    # Ideal self target: how many completions per week (1..7)
    target_per_week = db.Column(db.Integer, default=7)


class HabitLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    habit_id = db.Column(db.Integer, db.ForeignKey('habit.id'), nullable=False)
    # Store only the date (no time) for daily completion tracking
    day = db.Column(db.Date, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.now)

    __table_args__ = (
        db.UniqueConstraint('habit_id', 'day', name='uq_habit_day'),
    )

# Define JournalEntry model
class JournalEntry(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.now)  # Use system local time


class IdealSelf(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    vision = db.Column(db.Text, nullable=True)
    focus_areas = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.now)

def ensure_schema():
    # Lightweight migration to add columns when DB already exists
    with app.app_context():
        conn = db.engine.connect()
        try:
            cols = conn.execute(db.text("PRAGMA table_info(habit)")).fetchall()
            col_names = {c[1] for c in cols}
            if 'target_per_week' not in col_names:
                conn.execute(db.text("ALTER TABLE habit ADD COLUMN target_per_week INTEGER DEFAULT 7"))
        finally:
            conn.close()

        # Create any missing tables (e.g., HabitLog)
        db.create_all()


def _recompute_habit_stats(habit: 'Habit'):
    """Recompute streaks, last_completed, score, completed_days, completed flag from logs."""
    logs = HabitLog.query.filter_by(habit_id=habit.id).order_by(HabitLog.day.asc()).all()
    # completed_days
    habit.completed_days = len(logs)
    # last_completed
    if logs:
        last_day = logs[-1].day
        habit.last_completed = datetime.combine(last_day, datetime.min.time())
    else:
        habit.last_completed = None

    # today completion
    today = date.today()
    habit.completed = any(l.day == today for l in logs)

    # streak and best_streak
    # Compute consecutive day streaks
    best = 0
    current = 0
    prev_day = None
    for l in logs:
        if prev_day is None or (l.day - prev_day).days == 1:
            current += 1
        else:
            best = max(best, current)
            current = 1
        prev_day = l.day
    best = max(best, current)

    # If there's no log today, current streak should be 0 from today perspective if gap exists
    # Adjust current streak to count up to today: if last log is today, keep; if yesterday, keep; else reset to 0
    if logs:
        if (today - logs[-1].day).days > 1:
            current = 0
    habit.streak = current
    habit.best_streak = max(habit.best_streak, best)

    # score: % of days completed since creation
    total_days = (datetime.now() - habit.created_at).days or 1
    habit.score = (habit.completed_days / total_days) * 100

    db.session.add(habit)


# Initialize DB and ensure schema
with app.app_context():
    ensure_schema()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/habits', methods=['GET', 'POST'])
def handle_habits():
    if request.method == 'POST':
        habit_data = request.json
        habit = Habit(
            name=habit_data['name'],
            color=habit_data.get('color', '#000000'),
            target_per_week=int(habit_data.get('target_per_week', 7))
        )
        db.session.add(habit)
        db.session.commit()
        return jsonify({
            'id': habit.id,
            'name': habit.name,
            'color': habit.color,
            'target_per_week': habit.target_per_week
        }), 201
    else:
        habits = Habit.query.order_by(Habit.created_at.desc()).all()
        today = date.today()
        # build a set for today logs for quick lookup
        today_logs = {
            hl.habit_id
            for hl in HabitLog.query.filter(HabitLog.day == today).all()
        }
        result = []
        for h in habits:
            result.append({
                'id': h.id,
                'name': h.name,
                'score': h.score,
                'completed_days': h.completed_days,
                'created_at': h.created_at.isoformat(),
                'completed': h.id in today_logs,
                'streak': h.streak,
                'best_streak': h.best_streak,
                'color': h.color,
                'target_per_week': getattr(h, 'target_per_week', 7),
                'last_completed': h.last_completed.isoformat() if h.last_completed else None
            })
        return jsonify(result)


@app.route('/api/timeline', methods=['GET'])
def get_timeline():
    habits = Habit.query.all()
    journal_entries = JournalEntry.query.all()
    
    # Create a simple text timeline
    timeline_text = []
    
    # Add habits with their info
    for h in habits:
        habit_info = f"HABIT: {h.name} | Score: {h.score:.1f}% | Streak: {h.streak} | Days: {h.completed_days} | Created: {h.created_at.strftime('%Y-%m-%d %H:%M')}"
        if h.last_completed:
            habit_info += f" | Last done: {h.last_completed.strftime('%Y-%m-%d %H:%M')}"
        timeline_text.append((h.created_at, habit_info))
    
    # Add journal entries
    for e in journal_entries:
        journal_info = f"JOURNAL [{e.timestamp.strftime('%Y-%m-%d %H:%M')}]: {e.content}"
        timeline_text.append((e.timestamp, journal_info))
    
    # Sort by timestamp (most recent first)
    timeline_text.sort(key=lambda x: x[0], reverse=True)
    
    # Just return the raw text, one item per line
    raw_timeline = "\n\n".join([item[1] for item in timeline_text])
    
    # Return as plain text, NOT JSON
    from flask import Response
    return Response(raw_timeline, mimetype='text/plain')


@app.route('/api/habits/<int:habit_id>', methods=['PUT'])
def handle_habit(habit_id):
    habit = Habit.query.get_or_404(habit_id)
    data = request.json or {}
    completed = data.get('completed')
    today = date.today()

    # Optional updates
    if 'color' in data:
        habit.color = data['color']
    if 'target_per_week' in data:
        try:
            habit.target_per_week = int(data['target_per_week'])
        except Exception:
            pass

    if completed is not None:
        # Toggle today's completion using HabitLog
        log = HabitLog.query.filter_by(habit_id=habit.id, day=today).first()
        if completed and log is None:
            db.session.add(HabitLog(habit_id=habit.id, day=today))
        elif not completed and log is not None:
            db.session.delete(log)

    # Recompute stats from logs
    _recompute_habit_stats(habit)
    db.session.commit()

    return jsonify({
        'id': habit.id,
        'name': habit.name,
        'score': habit.score,
        'completed_days': habit.completed_days,
        'created_at': habit.created_at.isoformat(),
        'completed': habit.completed,
        'streak': habit.streak,
        'best_streak': habit.best_streak,
        'color': habit.color,
        'target_per_week': getattr(habit, 'target_per_week', 7),
        'last_completed': habit.last_completed.isoformat() if habit.last_completed else None
    })


@app.route('/api/habits/<int:habit_id>/progress', methods=['GET'])
def habit_progress(habit_id):
    habit = Habit.query.get_or_404(habit_id)
    try:
        days = int(request.args.get('days', 30))
    except Exception:
        days = 30

    today = date.today()
    range_start = today - timedelta(days=days - 1)
    # start graph at the later of created_at.date or requested range_start
    created_day = habit.created_at.date()
    start_day = max(range_start, created_day)

    # Collect all logs up to today
    logs = HabitLog.query.filter_by(habit_id=habit.id).all()
    log_days = sorted([l.day for l in logs])
    log_set = set(log_days)

    dates = []
    actual_cum = []
    ideal_cum = []

    # For cumulative counts since creation
    # Precompute cumulative actual counts per day
    cumulative_actual_map = {}
    count = 0
    cursor = created_day
    end_day = today
    while cursor <= end_day:
        if cursor in log_set:
            count += 1
        cumulative_actual_map[cursor] = count
        cursor += timedelta(days=1)

    ideal_step = (habit.target_per_week or 7) / 7.0
    # Generate series for requested range (start_day..today)
    d = start_day
    while d <= today:
        dates.append(d.isoformat())
        # actual cumulative since creation up to day d
        actual_cum.append(cumulative_actual_map.get(d, 0))
        # ideal cumulative since creation: days since created_day inclusive * step
        delta_days = (d - created_day).days + 1
        ideal_cum.append(round(delta_days * ideal_step, 2))
        d += timedelta(days=1)

    return jsonify({
        'habit': {
            'id': habit.id,
            'name': habit.name,
            'target_per_week': getattr(habit, 'target_per_week', 7),
            'color': habit.color,
        },
        'dates': dates,
        'ideal': ideal_cum,
        'actual': actual_cum,
    })


@app.route('/api/idealself', methods=['GET', 'POST'])
def ideal_self_profile():
    profile = IdealSelf.query.order_by(IdealSelf.created_at.desc()).first()
    if request.method == 'POST':
        payload = request.json or {}
        vision = (payload.get('vision') or '').strip()
        focus_areas = payload.get('focus_areas') or []
        if isinstance(focus_areas, str):
            focus_areas = [focus_areas]
        focus_clean = ','.join([item.strip() for item in focus_areas if item and item.strip()])

        if profile is None:
            profile = IdealSelf(vision=vision, focus_areas=focus_clean)
            db.session.add(profile)
        else:
            profile.vision = vision
            profile.focus_areas = focus_clean
            profile.created_at = datetime.now()
            db.session.add(profile)
        db.session.commit()

    if profile is None:
        return jsonify({
            'vision': '',
            'focus_areas': []
        })

    focus_list = [item.strip() for item in (profile.focus_areas or '').split(',') if item.strip()]
    return jsonify({
        'vision': profile.vision or '',
        'focus_areas': focus_list
    })

@app.route('/api/journal', methods=['GET', 'POST'])
def handle_journal():
    if request.method == 'POST':
        entry_data = request.json
        entry = JournalEntry(content=entry_data['content'])
        db.session.add(entry)
        db.session.commit()
        return jsonify({
            'id': entry.id,
            'content': entry.content,
            'timestamp': entry.timestamp.isoformat()  # No conversion needed
        }), 201
    else:
        entries = JournalEntry.query.all()
        return jsonify([{
            'id': e.id,
            'content': e.content,
            'timestamp': e.timestamp.isoformat()  # No conversion needed
        } for e in entries])

if __name__ == '__main__':
    app.run(debug=False, port=8010, host='0.0.0.0')







