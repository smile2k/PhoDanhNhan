import asyncio
import hashlib
import os
import json
import secrets
import sys
import threading
from http import cookies
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

import db

VOICE = "vi-VN-HoaiMyNeural"
CACHE_DIR = os.path.join(os.path.dirname(__file__), "tts-cache")
DATA_FILE = os.path.join(os.path.dirname(__file__), "data", "danh-nhan.json")
PORT = 8080

os.makedirs(CACHE_DIR, exist_ok=True)

SESSION_MAX_AGE = 7 * 24 * 3600  # 7 days

data_lock = threading.Lock()


def tts_sync(text: str, voice: str) -> str:
    h = hashlib.md5((text + voice).encode("utf-8")).hexdigest()
    path = os.path.join(CACHE_DIR, f"{h}.mp3")
    if os.path.exists(path):
        return path

    import edge_tts

    async def _gen():
        comm = edge_tts.Communicate(text, voice)
        await comm.save(path)

    asyncio.run(_gen())
    return path


def load_danh_nhan() -> list[dict]:
    with data_lock:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)


def save_danh_nhan(data: list[dict]) -> None:
    with data_lock:
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)


class AppHandler(SimpleHTTPRequestHandler):

    def _send_json(self, obj: dict | list, status: int = 200, no_cache: bool = False) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if no_cache:
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict | None:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return None
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def _get_session_id(self) -> str | None:
        cookie_header = self.headers.get("Cookie", "")
        c = cookies.SimpleCookie()
        try:
            c.load(cookie_header)
        except cookies.CookieError:
            return None
        morsel = c.get("session_id")
        return morsel.value if morsel else None

    def _get_current_user(self) -> dict | None:
        sid = self._get_session_id()
        if not sid:
            return None
        return db.get_session(sid)

    def _set_session_cookie(self, session_id: str) -> None:
        self.send_header(
            "Set-Cookie",
            f"session_id={session_id}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_MAX_AGE}",
        )

    def _clear_session_cookie(self) -> None:
        self.send_header(
            "Set-Cookie",
            "session_id=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
        )

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/auth/me":
            user = self._get_current_user()
            if user:
                self._send_json({"success": True, "user": user}, no_cache=True)
            else:
                self._send_json({"success": False, "error": "Chưa đăng nhập"}, 401, no_cache=True)
            return

        if parsed.path == "/api/danh-nhan":
            data = load_danh_nhan()
            self._send_json(data)
            return

        if parsed.path == "/api/users":
            user = self._get_current_user()
            if not user or user.get("role") != "superadmin":
                self._send_json({"success": False, "error": "Không có quyền"}, 403)
                return
            users = db.list_users()
            self._send_json({"success": True, "users": users})
            return

        if parsed.path == "/api/tts":
            params = parse_qs(parsed.query)
            text = params.get("text", [""])[0]
            voice = params.get("voice", [VOICE])[0]
            if not text:
                self.send_error(400, "Missing text parameter")
                return
            if len(text) > 5000:
                self.send_error(400, "Text too long (max 5000 chars)")
                return
            try:
                mp3_path = tts_sync(text, voice)
                self.send_response(200)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "public, max-age=86400")
                with open(mp3_path, "rb") as f:
                    audio = f.read()
                self.send_header("Content-Length", str(len(audio)))
                self.end_headers()
                self.wfile.write(audio)
            except Exception as e:
                self.send_error(500, str(e))
            return

        if parsed.path == "/api/tts/voices":
            voices = [
                {"id": "vi-VN-HoaiMyNeural", "name": "HoaiMy (Nữ, Bắc)", "gender": "Female"},
                {"id": "vi-VN-NamMinhNeural", "name": "NamMinh (Nam, Bắc)", "gender": "Male"},
            ]
            self._send_json(voices)
            return

        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/auth/register":
            body = self._read_json_body()
            if not body or not body.get("username") or not body.get("password"):
                self._send_json({"success": False, "error": "Thiếu username hoặc password"}, 400)
                return
            username = body["username"].strip()
            password = body["password"]
            if len(username) < 3:
                self._send_json({"success": False, "error": "Username phải ít nhất 3 ký tự"}, 400)
                return
            if len(password) < 6:
                self._send_json({"success": False, "error": "Password phải ít nhất 6 ký tự"}, 400)
                return
            user = db.create_user(username, password)
            if not user:
                self._send_json({"success": False, "error": "Username đã tồn tại"}, 409)
                return
            self._send_json({"success": True, "user": {"id": user["id"], "username": user["username"], "role": user["role"]}})
            return

        if parsed.path == "/api/auth/login":
            body = self._read_json_body()
            if not body or not body.get("username") or not body.get("password"):
                self._send_json({"success": False, "error": "Thiếu username hoặc password"}, 400)
                return
            user = db.authenticate(body["username"].strip(), body["password"])
            if not user:
                self._send_json({"success": False, "error": "Sai tài khoản hoặc mật khẩu"}, 401)
                return
            sid = secrets.token_hex(32)
            db.create_session(sid, user["id"], user["username"], user["role"])
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self._set_session_cookie(sid)
            resp = json.dumps({"success": True, "user": user}, ensure_ascii=False).encode("utf-8")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        if parsed.path == "/api/auth/logout":
            sid = self._get_session_id()
            if sid:
                db.delete_session(sid)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self._clear_session_cookie()
            resp = json.dumps({"success": True}, ensure_ascii=False).encode("utf-8")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        if parsed.path == "/api/auth/change-password":
            user = self._get_current_user()
            if not user:
                self._send_json({"success": False, "error": "Chưa đăng nhập"}, 401)
                return
            body = self._read_json_body()
            if not body or not body.get("oldPassword") or not body.get("newPassword"):
                self._send_json({"success": False, "error": "Thiếu mật khẩu"}, 400)
                return
            check = db.authenticate(user["username"], body["oldPassword"])
            if not check:
                self._send_json({"success": False, "error": "Mật khẩu cũ không đúng"}, 401)
                return
            if len(body["newPassword"]) < 6:
                self._send_json({"success": False, "error": "Mật khẩu mới phải ít nhất 6 ký tự"}, 400)
                return
            db.change_password(user["id"], body["newPassword"])
            self._send_json({"success": True})
            return

        if parsed.path == "/api/users/create":
            user = self._get_current_user()
            if not user or user.get("role") != "superadmin":
                self._send_json({"success": False, "error": "Không có quyền"}, 403)
                return
            body = self._read_json_body()
            if not body or not body.get("username") or not body.get("password"):
                self._send_json({"success": False, "error": "Thiếu username hoặc password"}, 400)
                return
            username = body["username"].strip()
            password = body["password"]
            role = body.get("role", "user")
            if role not in ("user", "admin"):
                self._send_json({"success": False, "error": "Role không hợp lệ"}, 400)
                return
            if len(username) < 3:
                self._send_json({"success": False, "error": "Username phải ít nhất 3 ký tự"}, 400)
                return
            if len(password) < 6:
                self._send_json({"success": False, "error": "Password phải ít nhất 6 ký tự"}, 400)
                return
            new_user = db.create_user(username, password, role)
            if not new_user:
                self._send_json({"success": False, "error": "Username đã tồn tại"}, 409)
                return
            self._send_json({"success": True, "user": new_user})
            return

        if parsed.path == "/api/users/set-role":
            user = self._get_current_user()
            if not user or user.get("role") != "superadmin":
                self._send_json({"success": False, "error": "Không có quyền"}, 403)
                return
            body = self._read_json_body()
            if not body or not body.get("userId") or not body.get("role"):
                self._send_json({"success": False, "error": "Thiếu userId hoặc role"}, 400)
                return
            ok = db.set_user_role(body["userId"], body["role"])
            if not ok:
                self._send_json({"success": False, "error": "Không thể thay đổi role"}, 400)
                return
            target = db.get_user_by_id(body["userId"])
            if target:
                db.refresh_session_role(target["username"])
            self._send_json({"success": True})
            return

        if parsed.path == "/api/users/delete":
            user = self._get_current_user()
            if not user or user.get("role") != "superadmin":
                self._send_json({"success": False, "error": "Không có quyền"}, 403)
                return
            body = self._read_json_body()
            if not body or not body.get("userId"):
                self._send_json({"success": False, "error": "Thiếu userId"}, 400)
                return
            ok = db.delete_user(body["userId"])
            if not ok:
                self._send_json({"success": False, "error": "Không thể xóa tài khoản này"}, 400)
                return
            self._send_json({"success": True})
            return

        if parsed.path == "/api/danh-nhan":
            user = self._get_current_user()
            if not user or user.get("role") not in ("admin", "superadmin"):
                self._send_json({"success": False, "error": "Không có quyền"}, 403)
                return
            body = self._read_json_body()
            if not body or not body.get("id") or not body.get("name"):
                self._send_json({"success": False, "error": "Thiếu id hoặc name"}, 400)
                return
            data = load_danh_nhan()
            if any(p["id"] == body["id"] for p in data):
                self._send_json({"success": False, "error": f"ID '{body['id']}' đã tồn tại"}, 409)
                return
            entry = {
                "id": body["id"],
                "name": body["name"],
                "realName": body.get("realName", ""),
                "born": body.get("born", ""),
                "died": body.get("died", ""),
                "era": body.get("era", ""),
                "title": body.get("title", ""),
                "summary": body.get("summary", ""),
                "bio": body.get("bio", ""),
                "stories": body.get("stories", []),
                "streetNote": body.get("streetNote", ""),
                "wikiSlug": body.get("wikiSlug", ""),
                "aliases": body.get("aliases", []),
            }
            data.append(entry)
            save_danh_nhan(data)
            self._send_json({"success": True, "entry": entry})
            return

        self.send_error(404, "Not Found")

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path.startswith("/api/danh-nhan/"):
            user = self._get_current_user()
            if not user or user.get("role") not in ("admin", "superadmin"):
                self._send_json({"success": False, "error": "Không có quyền"}, 403)
                return
            target_id = parsed.path[len("/api/danh-nhan/"):]
            if not target_id:
                self._send_json({"success": False, "error": "Thiếu ID"}, 400)
                return
            body = self._read_json_body()
            if not body:
                self._send_json({"success": False, "error": "Thiếu dữ liệu"}, 400)
                return
            data = load_danh_nhan()
            idx = next((i for i, p in enumerate(data) if p["id"] == target_id), None)
            if idx is None:
                self._send_json({"success": False, "error": "Không tìm thấy danh nhân"}, 404)
                return
            updated = {**data[idx], **body, "id": target_id}
            data[idx] = updated
            save_danh_nhan(data)
            self._send_json({"success": True, "entry": updated})
            return

        self.send_error(404, "Not Found")

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path.startswith("/api/danh-nhan/"):
            user = self._get_current_user()
            if not user or user.get("role") not in ("admin", "superadmin"):
                self._send_json({"success": False, "error": "Không có quyền"}, 403)
                return
            target_id = parsed.path[len("/api/danh-nhan/"):]
            if not target_id:
                self._send_json({"success": False, "error": "Thiếu ID"}, 400)
                return
            data = load_danh_nhan()
            new_data = [p for p in data if p["id"] != target_id]
            if len(new_data) == len(data):
                self._send_json({"success": False, "error": "Không tìm thấy danh nhân"}, 404)
                return
            save_danh_nhan(new_data)
            self._send_json({"success": True})
            return

        self.send_error(404, "Not Found")

    def log_message(self, format, *args) -> None:
        msg = str(args[0]) if args else ""
        if "/api/tts" in msg:
            pass
        elif msg.startswith(("GET", "POST", "PUT", "DELETE", "OPTIONS")):
            super().log_message(format, *args)


def main() -> None:
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    db.init_db()

    print(f"Pho Danh Nhan Ha Noi - Server")
    print(f"http://127.0.0.1:{PORT}/")
    print(f"TTS voice: {VOICE}")
    print(f"Cache dir: {CACHE_DIR}")
    print()
    server = HTTPServer(("127.0.0.1", PORT), AppHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()


if __name__ == "__main__":
    main()
