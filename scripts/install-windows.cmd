@echo off
rem Double-click this file, or run it from a terminal with options, e.g.:
rem   scripts\install-windows.cmd -Run      (install, then start the app)
rem   scripts\install-windows.cmd -Build    (install, then build the installer)
rem   scripts\install-windows.cmd -Check    (install, then run the tests)
rem It runs install-windows.ps1 without changing your PowerShell execution policy.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1" %*
set EXITCODE=%ERRORLEVEL%
echo.
if "%~1"=="" pause
exit /b %EXITCODE%
