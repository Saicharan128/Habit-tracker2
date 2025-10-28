import json
import sqlite3
from datetime import datetime, date, timedelta
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from functools import partial
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / 'templates'
DB_PATH = BASE_DIR / 'habits_journal.db'
DEFAULT_COLOR = '#000000'


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def _ensure_schema():
    conn = _connect()
    try:
        conn.execute(
            'CREATE TABLE IF NOT EXISTS habit ('
            'id INTEGER PRIMARY KEY AUTOINCREMENT,'
            'name TEXT NOT NULL,'
            'score REAL NOT NULL DEFAULT 0.0,'
            'completed_days INTEGER NOT NULL DEFAULT 0,'
            'created_at TEXT NOT NULL,'
            'completed INTEGER NOT NULL DEFAULT 0,'
            'streak INTEGER NOT NULL DEFAULT 0,'
            'best_streak INTEGER NOT NULL DEFAULT 0,'
            'color TEXT NOT NULL DEFAULT "#000000",'
            'last_completed TEXT,'
            'target_per_week INTEGER NOT NULL DEFAULT 7'
            ')'
        )
        conn.execute(
            'CREATE TABLE IF NOT EXISTS habit_log ('
            'id INTEGER PRIMARY KEY AUTOINCREMENT,'
            'habit_id INTEGER NOT NULL,'
            'day TEXT NOT NULL,'
            'created_at TEXT NOT NULL,'
            'UNIQUE(habit_id, day),'
            'FOREIGN KEY(habit_id) REFERENCES habit(id) ON DELETE CASCADE'
            ')'
        )
        conn.execute(
            'CREATE TABLE IF NOT EXISTS journal_entry ('
            'id INTEGER PRIMARY KEY AUTOINCREMENT,'
            'content TEXT NOT NULL,'
            'timestamp TEXT NOT NULL'
            ')'
        )
        conn.execute(
            'CREATE TABLE IF NOT EXISTS ideal_self ('
            'id INTEGER PRIMARY KEY AUTOINCREMENT,'
            'vision TEXT,'
            'focus_areas TEXT,'
            'created_at TEXT NOT NULL'
            ')'
        )

        # Lightweight migrations for legacy databases.
        existing = {row['name'] for row in conn.execute('PRAGMA table_info(habit)')}
        if 'target_per_week' not in existing:
            conn.execute('ALTER TABLE habit ADD COLUMN target_per_week INTEGER NOT NULL DEFAULT 7')
        if 'color' not in existing:
            conn.execute('ALTER TABLE habit ADD COLUMN color TEXT NOT NULL DEFAULT "#000000"')
        if 'last_completed' not in existing:
            conn.execute('ALTER TABLE habit ADD COLUMN last_completed TEXT')
        if 'best_streak' not in existing:
            conn.execute('ALTER TABLE habit ADD COLUMN best_streak INTEGER NOT NULL DEFAULT 0')
        if 'streak' not in existing:
            conn.execute('ALTER TABLE habit ADD COLUMN streak INTEGER NOT NULL DEFAULT 0')
        if 'completed' not in existing:
            conn.execute('ALTER TABLE habit ADD COLUMN completed INTEGER NOT NULL DEFAULT 0')
        if 'completed_days' not in existing:
            conn.execute('ALTER TABLE habit ADD COLUMN completed_days INTEGER NOT NULL DEFAULT 0')
        if 'score' not in existing:
            conn.execute('ALTER TABLE habit ADD COLUMN score REAL NOT NULL DEFAULT 0.0')

        conn.commit()
    finally:
        conn.close()


def _parse_datetime(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return datetime.strptime(value, '%Y-%m-%d %H:%M:%S')


def _compute_habit_payload(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    habit_id = row['id']
    log_rows = conn.execute(
        'SELECT day FROM habit_log WHERE habit_id = ? ORDER BY day ASC',
        (habit_id,)
    ).fetchall()
    log_days = [date.fromisoformat(r['day']) for r in log_rows]
    log_set = set(log_days)
    completed_days = len(log_days)
    last_completed = log_days[-1] if log_days else None

    today = date.today()
    created_at = _parse_datetime(row['created_at'])
    created_day = created_at.date()

    # streaks
    current = 0
    best = 0
    prev_day = None
    for log_day in log_days:
        if prev_day is not None and (log_day - prev_day).days == 1:
            current += 1
        else:
            current = 1
        best = max(best, current)
        prev_day = log_day
    if log_days and (today - log_days[-1]).days > 1:
        current = 0
    if not log_days:
        current = 0

    total_days = max(1, (today - created_day).days + 1)
    score = round((completed_days / total_days) * 100.0, 1)

    payload = {
        'id': habit_id,
        'name': row['name'],
        'score': score,
        'completed_days': completed_days,
        'created_at': created_at.isoformat(),
        'completed': 1 if today in log_set else 0,
        'streak': current,
        'best_streak': max(best, row['best_streak'] or 0),
        'color': row['color'] or DEFAULT_COLOR,
        'target_per_week': row['target_per_week'] or 7,
        'last_completed': last_completed.isoformat() if last_completed else None
    }

    conn.execute(
        'UPDATE habit SET score = ?, completed_days = ?, completed = ?, streak = ?, '
        'best_streak = ?, last_completed = ? WHERE id = ?',
        (
            payload['score'],
            payload['completed_days'],
            payload['completed'],
            payload['streak'],
            payload['best_streak'],
            payload['last_completed'],
            habit_id,
        ),
    )
    conn.commit()
    payload['completed'] = bool(payload['completed'])
    return payload



class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=directory or str(BASE_DIR), **kwargs)

    # Silence the default logging noise while still allowing debug via print if needed.
    def log_message(self, format, *args):
        return

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/':
            self._serve_index()
        elif parsed.path == '/api/habits':
            self._get_habits()
        elif parsed.path == '/api/timeline':
            self._get_timeline()
        elif parsed.path.startswith('/api/habits/') and parsed.path.endswith('/progress'):
            self._get_habit_progress(parsed)
        elif parsed.path == '/api/journal':
            self._get_journal()
        elif parsed.path == '/api/idealself':
            self._get_ideal_self()
        else:
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/habits':
            self._create_habit()
        elif parsed.path == '/api/journal':
            self._create_journal_entry()
        elif parsed.path == '/api/idealself':
            self._save_ideal_self()
        else:
            self.send_error(HTTPStatus.NOT_FOUND)

    def do_PUT(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api/habits/'):
            self._update_habit(parsed)
        else:
            self.send_error(HTTPStatus.NOT_FOUND)

    def _serve_index(self):
        index_path = TEMPLATES_DIR / 'index.html'
        if not index_path.exists():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content = index_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _read_json(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length else b''
        if not body:
            return {}
        try:
            return json.loads(body.decode('utf-8'))
        except json.JSONDecodeError:
            self.send_error(HTTPStatus.BAD_REQUEST, 'Invalid JSON payload')
            raise

    def _respond_json(self, payload, status=HTTPStatus.OK):
        data = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _get_habits(self):
        conn = _connect()
        try:
            rows = conn.execute('SELECT * FROM habit ORDER BY datetime(created_at) DESC').fetchall()
            habits = [_compute_habit_payload(conn, row) for row in rows]
            self._respond_json(habits)
        finally:
            conn.close()

    def _create_habit(self):
        try:
            payload = self._read_json()
        except json.JSONDecodeError:
            return
        name = (payload.get('name') or '').strip()
        if not name:
            self.send_error(HTTPStatus.BAD_REQUEST, 'Habit name is required')
            return
        color = payload.get('color') or DEFAULT_COLOR
        try:
            target = int(payload.get('target_per_week', 7))
        except (TypeError, ValueError):
            target = 7
        created_at = datetime.now().isoformat()
        conn = _connect()
        try:
            cursor = conn.execute(
                'INSERT INTO habit (name, color, target_per_week, created_at) VALUES (?, ?, ?, ?)',
                (name, color, target, created_at)
            )
            conn.commit()
            habit_id = cursor.lastrowid
            row = conn.execute('SELECT * FROM habit WHERE id = ?', (habit_id,)).fetchone()
            habit_payload = _compute_habit_payload(conn, row)
            self._respond_json({
                'id': habit_payload['id'],
                'name': habit_payload['name'],
                'color': habit_payload['color'],
                'target_per_week': habit_payload['target_per_week']
            }, status=HTTPStatus.CREATED)
        finally:
            conn.close()

    def _update_habit(self, parsed):
        parts = parsed.path.strip('/').split('/')
        if len(parts) < 3:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            habit_id = int(parts[1])
        except ValueError:
            self.send_error(HTTPStatus.BAD_REQUEST, 'Invalid habit id')
            return
        try:
            payload = self._read_json()
        except json.JSONDecodeError:
            return

        conn = _connect()
        try:
            row = conn.execute('SELECT * FROM habit WHERE id = ?', (habit_id,)).fetchone()
            if row is None:
                self.send_error(HTTPStatus.NOT_FOUND)
                return

            updates = []
            params = []
            if 'color' in payload:
                updates.append('color = ?')
                params.append(payload['color'] or DEFAULT_COLOR)
            if 'target_per_week' in payload:
                try:
                    params.append(int(payload['target_per_week']))
                except (TypeError, ValueError):
                    params.append(row['target_per_week'])
                updates.append('target_per_week = ?')

            if updates:
                params.append(habit_id)
                conn.execute(f'UPDATE habit SET {", ".join(updates)} WHERE id = ?', params)

            if 'completed' in payload:
                today_str = date.today().isoformat()
                existing = conn.execute(
                    'SELECT id FROM habit_log WHERE habit_id = ? AND day = ?',
                    (habit_id, today_str)
                ).fetchone()
                if payload['completed'] and existing is None:
                    conn.execute(
                        'INSERT INTO habit_log (habit_id, day, created_at) VALUES (?, ?, ?)',
                        (habit_id, today_str, datetime.now().isoformat())
                    )
                elif not payload['completed'] and existing is not None:
                    conn.execute('DELETE FROM habit_log WHERE id = ?', (existing['id'],))

            conn.commit()
            updated_row = conn.execute('SELECT * FROM habit WHERE id = ?', (habit_id,)).fetchone()
            habit_payload = _compute_habit_payload(conn, updated_row)
            self._respond_json(habit_payload)
        finally:
            conn.close()

    def _get_habit_progress(self, parsed):
        parts = parsed.path.strip('/').split('/')
        if len(parts) < 3:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            habit_id = int(parts[1])
        except ValueError:
            self.send_error(HTTPStatus.BAD_REQUEST, 'Invalid habit id')
            return

        query = parse_qs(parsed.query)
        try:
            days = int(query.get('days', ['30'])[0])
        except (TypeError, ValueError):
            days = 30

        conn = _connect()
        try:
            row = conn.execute('SELECT * FROM habit WHERE id = ?', (habit_id,)).fetchone()
            if row is None:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            created_at = _parse_datetime(row['created_at'])
            created_day = created_at.date()
            today = date.today()
            range_start = today - timedelta(days=days - 1)
            start_day = max(range_start, created_day)

            log_rows = conn.execute(
                'SELECT day FROM habit_log WHERE habit_id = ? ORDER BY day ASC',
                (habit_id,)
            ).fetchall()
            log_days = [date.fromisoformat(r['day']) for r in log_rows]
            log_set = set(log_days)

            cumulative_actual = {}
            count = 0
            cursor = created_day
            while cursor <= today:
                if cursor in log_set:
                    count += 1
                cumulative_actual[cursor] = count
                cursor += timedelta(days=1)

            dates = []
            actual_series = []
            ideal_series = []
            ideal_step = (row['target_per_week'] or 7) / 7.0
            current_day = start_day
            while current_day <= today:
                dates.append(current_day.isoformat())
                actual_series.append(cumulative_actual.get(current_day, 0))
                delta_days = (current_day - created_day).days + 1
                ideal_series.append(round(max(0, delta_days) * ideal_step, 2))
                current_day += timedelta(days=1)

            self._respond_json({
                'habit': {
                    'id': row['id'],
                    'name': row['name'],
                    'target_per_week': row['target_per_week'],
                    'color': row['color'] or DEFAULT_COLOR,
                },
                'dates': dates,
                'ideal': ideal_series,
                'actual': actual_series,
            })
        finally:
            conn.close()

    def _get_timeline(self):
        conn = _connect()
        try:
            items = []
            for row in conn.execute('SELECT * FROM habit'):
                created_at = _parse_datetime(row['created_at'])
                payload = _compute_habit_payload(conn, row)
                entry = (
                    created_at,
                    f"HABIT: {payload['name']} | Score: {payload['score']:.1f}% | "
                    f"Streak: {payload['streak']} | Days: {payload['completed_days']} | "
                    f"Created: {created_at.strftime('%Y-%m-%d %H:%M')}"
                )
                if payload['last_completed']:
                    entry = (
                        entry[0],
                        entry[1] + f" | Last done: {datetime.fromisoformat(payload['last_completed']).strftime('%Y-%m-%d %H:%M')}"
                    )
                items.append(entry)
            for row in conn.execute('SELECT * FROM journal_entry'):
                timestamp = _parse_datetime(row['timestamp'])
                items.append((timestamp, f"JOURNAL [{timestamp.strftime('%Y-%m-%d %H:%M')}]: {row['content']}"))

            items.sort(key=lambda item: item[0], reverse=True)
            timeline = '\n\n'.join(item[1] for item in items)
            data = timeline.encode('utf-8')
            self.send_response(HTTPStatus.OK)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        finally:
            conn.close()

    def _get_journal(self):
        conn = _connect()
        try:
            rows = conn.execute('SELECT * FROM journal_entry ORDER BY datetime(timestamp) DESC').fetchall()
            entries = [
                {
                    'id': row['id'],
                    'content': row['content'],
                    'timestamp': _parse_datetime(row['timestamp']).isoformat()
                }
                for row in rows
            ]
            self._respond_json(entries)
        finally:
            conn.close()

    def _create_journal_entry(self):
        try:
            payload = self._read_json()
        except json.JSONDecodeError:
            return
        content = (payload.get('content') or '').strip()
        if not content:
            self.send_error(HTTPStatus.BAD_REQUEST, 'Journal content is required')
            return
        timestamp = datetime.now().isoformat()
        conn = _connect()
        try:
            cursor = conn.execute(
                'INSERT INTO journal_entry (content, timestamp) VALUES (?, ?)',
                (content, timestamp)
            )
            conn.commit()
            entry_id = cursor.lastrowid
            self._respond_json({
                'id': entry_id,
                'content': content,
                'timestamp': timestamp,
            }, status=HTTPStatus.CREATED)
        finally:
            conn.close()

    def _get_ideal_self(self):
        conn = _connect()
        try:
            row = conn.execute(
                'SELECT vision, focus_areas FROM ideal_self ORDER BY datetime(created_at) DESC LIMIT 1'
            ).fetchone()
            if row is None:
                self._respond_json({'vision': '', 'focus_areas': []})
                return
            focus = [item.strip() for item in (row['focus_areas'] or '').split(',') if item.strip()]
            self._respond_json({'vision': row['vision'] or '', 'focus_areas': focus})
        finally:
            conn.close()

    def _save_ideal_self(self):
        try:
            payload = self._read_json()
        except json.JSONDecodeError:
            return
        vision = (payload.get('vision') or '').strip()
        focus_areas = payload.get('focus_areas') or []
        if isinstance(focus_areas, str):
            focus_areas = [focus_areas]
        focus_clean = ','.join(item.strip() for item in focus_areas if item and item.strip())
        conn = _connect()
        try:
            conn.execute(
                'INSERT INTO ideal_self (vision, focus_areas, created_at) VALUES (?, ?, ?)',
                (vision, focus_clean, datetime.now().isoformat())
            )
            conn.commit()
            self._respond_json({'vision': vision, 'focus_areas': focus_clean.split(',') if focus_clean else []})
        finally:
            conn.close()


def run(port=8010):
    _ensure_schema()
    handler = partial(AppHandler, directory=str(BASE_DIR))
    with ThreadingHTTPServer(('0.0.0.0', port), handler) as httpd:
        print(f"Serving on http://0.0.0.0:{port}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nShutting down server...')


if __name__ == '__main__':
    run()
