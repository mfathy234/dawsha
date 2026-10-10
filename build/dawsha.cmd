@echo off
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0Dawsha.exe" "%~dp0resources\dawsha-cli.cjs" %*
endlocal & exit /b %ERRORLEVEL%
