#!/usr/bin/env python3
"""Локальний сервер для монітора тривог (доступний у локальній мережі).

Запуск:  python server.py [порт]   або  Start.bat
Відкрийте http://localhost:8000 на цьому ПК або http://<IP-ПК>:8000 з інших пристроїв у мережі.

Робить дві речі:
  1) віддає сторінку та папку assets/;
  2) пересилає запити до API тривог через /proxy/..., щоб браузер не блокував їх (CORS).
Токен можна зберегти тут, на сервері: у файлі token.txt поруч (перший рядок) або в змінній
середовища TRYVOHA_TOKEN. Файли token.txt, server.py, *.bat та приховані файли НЕ віддаються по мережі.
"""
import http.server, socketserver, urllib.request, urllib.error, urllib.parse, time, os, sys, socket

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
HOST = os.environ.get("TRYVOHA_HOST", "0.0.0.0")  # 0.0.0.0 = доступ з локальної мережі; 127.0.0.1 = лише цей ПК
UPSTREAM = {"ukrainealarm": "https://api.ukrainealarm.com", "alerts": "https://api.alerts.in.ua"}
CACHE = {}  # (шлях, токен) -> (час, статус, тіло): не частіше ніж раз на 8 с до сервісу
os.chdir(os.path.dirname(os.path.abspath(__file__)))
import glob
HTML = "index.html" if os.path.exists("index.html") else next(iter(sorted(glob.glob("Тривога*монітор*.html"))), "Тривога — монітор.html")
BLOCKED_NAMES = {"token.txt", "server.py"}
BLOCKED_EXT = (".bat", ".cmd", ".ps1", ".sh", ".env")


def load_token():
    t = os.environ.get("TRYVOHA_TOKEN", "").strip()
    if not t and os.path.exists("token.txt"):
        with open("token.txt", encoding="utf-8") as f:
            t = f.readline().strip()
    return t


TOKEN = load_token()


def is_blocked(path):
    parts = [p for p in urllib.parse.unquote(path).replace("\\", "/").split("/") if p]
    for p in parts:
        low = p.lower()
        if p == ".." or low.startswith(".") or low in BLOCKED_NAMES or low.endswith(BLOCKED_EXT):
            return True
    return False


def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))  # пакети не надсилаються, лише визначається інтерфейс
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except Exception:
        pass
    return sorted(i for i in ips if not i.startswith("127."))


class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ("/", "/index.html"):
            self.path = "/" + urllib.parse.quote(HTML)
            return super().do_GET()
        if path.startswith("/proxy/"):
            return self.proxy(path)
        if is_blocked(path):
            return self.reply(404, b'{"error":"not found"}')
        return super().do_GET()

    def do_HEAD(self):
        if is_blocked(urllib.parse.urlparse(self.path).path):
            return self.reply(404, b"")
        return super().do_HEAD()

    def proxy(self, path):
        if path == "/proxy/status":
            return self.reply(200, b'{"hasToken":true}' if TOKEN else b'{"hasToken":false}')
        parts = path[len("/proxy/"):].split("/", 1)
        base = UPSTREAM.get(parts[0])
        if not base or len(parts) < 2:
            return self.reply(404, b'{"error":"unknown service"}')
        url = base + "/" + parts[1]
        auth = self.headers.get("Authorization", "")
        if not auth and TOKEN:
            auth = ("Bearer " + TOKEN) if parts[0] == "alerts" else TOKEN
        key = (url, auth)
        hit = CACHE.get(key)
        if hit and time.time() - hit[0] < 8:
            return self.reply(hit[1], hit[2])
        req = urllib.request.Request(url, headers={"Authorization": auth, "User-Agent": "tryvoha-monitor"})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                st, body = r.status, r.read()
        except urllib.error.HTTPError as e:
            st, body = e.code, e.read()
        except Exception as e:
            return self.reply(502, ('{"error":"%s"}' % e).encode())
        CACHE[key] = (time.time(), st, body)
        self.reply(st, body)

    def reply(self, st, body):
        self.send_response(st)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


socketserver.ThreadingTCPServer.allow_reuse_address = True
socketserver.ThreadingTCPServer.daemon_threads = True
with socketserver.ThreadingTCPServer((HOST, PORT), H) as srv:
    print("На цьому ПК:        http://localhost:%d" % PORT)
    if HOST == "0.0.0.0":
        for ip in lan_ips():
            print("З локальної мережі: http://%s:%d" % (ip, PORT))
    else:
        print("Режим лише для цього ПК (TRYVOHA_HOST=%s)" % HOST)
    print("(Ctrl+C — зупинити)")
    print("Папка: " + os.getcwd())
    print("Сторінка: " + HTML + ("  [знайдено]" if os.path.exists(HTML) else "  [НЕ ЗНАЙДЕНО в цій папці!]"))
    print("assets: " + ("є" if os.path.isdir("assets") else "немає"))
    print("Токен на сервері: " + ("так, автопідключення увімкнено" if TOKEN else "ні (створіть token.txt)"))
    srv.serve_forever()
