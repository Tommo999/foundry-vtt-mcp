@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-windows.ps1" %*
set "setupExit=%ERRORLEVEL%"
if not "%setupExit%"=="0" (
  echo.
  echo Setup failed with exit code %setupExit%.
  echo Press any key to close this window.
) else (
  echo.
  echo Setup finished. Press any key to close this window.
)
pause >nul
exit /b %setupExit%
