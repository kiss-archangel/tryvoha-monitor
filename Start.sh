#!/usr/bin/env bash
# Монітор тривог - запуск на Ubuntu/Linux (доступ з локальної мережі)
cd "$(dirname "$(readlink -f "$0")")" || exit 1

PORT="${1:-8000}"

echo "==================================================="
echo "  Запуск монітора тривог (доступ з локальної мережі)"
echo "==================================================="
echo

if command -v python3 >/dev/null 2>&1; then
    PY=python3
else
    echo "[X] python3 не знайдено. Встановіть: sudo apt install python3"
    exit 1
fi

# Брандмауер UFW: відкрити порт лише для локальної мережі, якщо UFW активний
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    echo "[!] Увімкнено UFW. Якщо з інших пристроїв не відкривається, виконайте один раз:"
    echo "    sudo ufw allow from 192.168.0.0/16 to any port $PORT proto tcp"
    echo
fi

exec "$PY" server.py "$PORT"
