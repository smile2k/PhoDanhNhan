import hashlib
import os
import secrets
import sqlite3

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "app.db")


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    conn = get_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS spots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            street_name TEXT NOT NULL,
            person_id TEXT,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            category TEXT NOT NULL DEFAULT 'tip',
            title TEXT NOT NULL,
            content TEXT,
            image_url TEXT,
            thumb_url TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS spot_likes (
            spot_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (spot_id, user_id),
            FOREIGN KEY (spot_id) REFERENCES spots(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    conn.commit()

    row = conn.execute("SELECT id FROM users WHERE role = 'superadmin'").fetchone()
    if not row:
        salt = secrets.token_hex(16)
        pw_hash = hash_password("admin123", salt)
        conn.execute(
            "INSERT INTO users (username, password_hash, salt, role) VALUES (?, ?, ?, ?)",
            ("admin", pw_hash, salt, "superadmin"),
        )
        conn.commit()
        print("[DB] Tài khoản superadmin đã tạo: admin / admin123")
        print("[DB] *** HÃY ĐỔI MẬT KHẨU NGAY SAU KHI ĐĂNG NHẬP ***")
    conn.close()


def hash_password(password: str, salt: str) -> str:
    return hashlib.sha256((salt + password).encode("utf-8")).hexdigest()


def create_user(username: str, password: str, role: str = "user") -> dict | None:
    conn = get_connection()
    salt = secrets.token_hex(16)
    pw_hash = hash_password(password, salt)
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, salt, role) VALUES (?, ?, ?, ?)",
            (username, pw_hash, salt, role),
        )
        conn.commit()
        user = conn.execute(
            "SELECT id, username, role, created_at FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        conn.close()
        return dict(user)
    except sqlite3.IntegrityError:
        conn.close()
        return None


def authenticate(username: str, password: str) -> dict | None:
    conn = get_connection()
    row = conn.execute(
        "SELECT id, username, password_hash, salt, role FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    conn.close()
    if not row:
        return None
    if hash_password(password, row["salt"]) != row["password_hash"]:
        return None
    return {"id": row["id"], "username": row["username"], "role": row["role"]}


def get_user_by_id(user_id: int) -> dict | None:
    conn = get_connection()
    row = conn.execute(
        "SELECT id, username, role, created_at FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def list_users() -> list[dict]:
    conn = get_connection()
    rows = conn.execute("SELECT id, username, role, created_at FROM users ORDER BY id").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def set_user_role(user_id: int, role: str) -> bool:
    if role not in ("user", "admin"):
        return False
    conn = get_connection()
    row = conn.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row or row["role"] == "superadmin":
        conn.close()
        return False
    conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
    conn.commit()
    conn.close()
    return True


def change_password(user_id: int, new_password: str) -> bool:
    conn = get_connection()
    salt = secrets.token_hex(16)
    pw_hash = hash_password(new_password, salt)
    conn.execute(
        "UPDATE users SET password_hash = ?, salt = ? WHERE id = ?",
        (pw_hash, salt, user_id),
    )
    conn.commit()
    conn.close()
    return True


def create_session(session_id: str, user_id: int, username: str, role: str) -> None:
    conn = get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO sessions (session_id, user_id, username, role) VALUES (?, ?, ?, ?)",
        (session_id, user_id, username, role),
    )
    conn.commit()
    conn.close()


def get_session(session_id: str) -> dict | None:
    conn = get_connection()
    row = conn.execute(
        "SELECT session_id, user_id, username, role FROM sessions WHERE session_id = ?",
        (session_id,),
    ).fetchone()
    conn.close()
    if not row:
        return None
    return {"id": row["user_id"], "username": row["username"], "role": row["role"]}


def delete_session(session_id: str) -> None:
    conn = get_connection()
    conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
    conn.commit()
    conn.close()


def refresh_session_role(username: str) -> None:
    conn = get_connection()
    user = conn.execute("SELECT role FROM users WHERE username = ?", (username,)).fetchone()
    if user:
        conn.execute("UPDATE sessions SET role = ? WHERE username = ?", (user["role"], username))
        conn.commit()
    conn.close()


def delete_user(user_id: int) -> bool:
    conn = get_connection()
    row = conn.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row or row["role"] == "superadmin":
        conn.close()
        return False
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    return True


def create_spot(user_id: int, username: str, street_name: str, person_id: str | None,
                lat: float, lng: float, category: str, title: str,
                content: str | None, image_url: str | None, thumb_url: str | None) -> dict:
    conn = get_connection()
    cur = conn.execute(
        """INSERT INTO spots (user_id, username, street_name, person_id, lat, lng, category, title, content, image_url, thumb_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (user_id, username, street_name, person_id, lat, lng, category, title, content, image_url, thumb_url),
    )
    conn.commit()
    spot = conn.execute("SELECT * FROM spots WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(spot)


def list_spots(street_name: str | None = None, person_id: str | None = None,
               lat: float | None = None, lng: float | None = None, radius_m: float = 500) -> list[dict]:
    conn = get_connection()
    if street_name:
        rows = conn.execute(
            "SELECT * FROM spots WHERE street_name = ? ORDER BY created_at DESC",
            (street_name,),
        ).fetchall()
    elif person_id:
        rows = conn.execute(
            "SELECT * FROM spots WHERE person_id = ? ORDER BY created_at DESC",
            (person_id,),
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM spots ORDER BY created_at DESC LIMIT 100").fetchall()
    result = [dict(r) for r in rows]
    for s in result:
        like_count = conn.execute("SELECT COUNT(*) FROM spot_likes WHERE spot_id = ?", (s["id"],)).fetchone()[0]
        s["likes"] = like_count
    conn.close()
    return result


def delete_spot(spot_id: int, user_id: int, role: str) -> bool:
    conn = get_connection()
    row = conn.execute("SELECT user_id FROM spots WHERE id = ?", (spot_id,)).fetchone()
    if not row:
        conn.close()
        return False
    if row["user_id"] != user_id and role not in ("admin", "superadmin"):
        conn.close()
        return False
    conn.execute("DELETE FROM spots WHERE id = ?", (spot_id,))
    conn.commit()
    conn.close()
    return True


def toggle_like(spot_id: int, user_id: int) -> dict:
    conn = get_connection()
    existing = conn.execute(
        "SELECT 1 FROM spot_likes WHERE spot_id = ? AND user_id = ?",
        (spot_id, user_id),
    ).fetchone()
    if existing:
        conn.execute("DELETE FROM spot_likes WHERE spot_id = ? AND user_id = ?", (spot_id, user_id))
        liked = False
    else:
        conn.execute("INSERT INTO spot_likes (spot_id, user_id) VALUES (?, ?)", (spot_id, user_id))
        liked = True
    conn.commit()
    count = conn.execute("SELECT COUNT(*) FROM spot_likes WHERE spot_id = ?", (spot_id,)).fetchone()[0]
    conn.close()
    return {"liked": liked, "likes": count}
