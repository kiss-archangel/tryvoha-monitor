@echo off
title Монітор тривог - сервер локальної мережі
chcp 65001 >nul
cd /d "%~dp0"

set "PORT=8000"

echo ===================================================
echo   Запуск монітора тривог (доступ з локальної мережі)
echo ===================================================
echo.

rem --- Дозвіл у брандмауері Windows (спрацює, якщо запущено від адміністратора) ---
netsh advfirewall firewall show rule name="Tryvoha Monitor" >nul 2>&1
if errorlevel 1 (
    netsh advfirewall firewall add rule name="Tryvoha Monitor" dir=in action=allow protocol=TCP localport=%PORT% profile=private >nul 2>&1
    if errorlevel 1 (
        echo [!] Правило брандмауера не додано. Якщо з телефона не відкривається -
        echo     один раз запустіть цей файл від імені адміністратора.
        echo.
    )
)

rem --- Пошук Python ---
set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY (
    where python >nul 2>&1 && set "PY=python"
)
if not defined PY (
    echo [X] Python не знайдено. Встановіть його з python.org та поставте галочку "Add to PATH".
    echo.
    pause
    exit /b 1
)

%PY% server.py %PORT%
echo.
pause
