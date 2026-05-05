@echo off
title Raha Quotation - Build EXE
color 0A
echo.
echo ==========================================
echo   Raha Co. Quotation - Building EXE...
echo ==========================================
echo.

:: Check Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Node.js is NOT installed!
    echo Please install Node.js from: https://nodejs.org
    echo.
    pause
    exit /b
)

:: Check firebase-config.json exists
if not exist "firebase-config.json" (
    color 0C
    echo [ERROR] firebase-config.json not found!
    echo Please place your firebase-config.json in this folder first.
    echo.
    pause
    exit /b
)

echo [1/3] Installing dependencies (firebase-admin + electron-updater)...
call npm install
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] npm install failed.
    pause
    exit /b
)

echo.
echo [2/3] Building installer EXE (this may take 2-3 minutes)...
call npm run build
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Build failed.
    pause
    exit /b
)

echo.
echo [3/3] Done!
echo.
echo ==========================================
echo   Installer is ready in the "dist" folder
echo   File: dist\Raha Quotation Setup 1.0.0.exe
echo.
echo   IMPORTANT: To release an update —
echo     1. Bump "version" in package.json
echo     2. Run BUILD.bat again
echo     3. Upload the new Setup EXE to GitHub Releases
echo        and tag it e.g. v1.0.1
echo ==========================================
echo.

explorer dist
pause
