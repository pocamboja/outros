@echo off
cd /d "%~dp0"
where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8765
  echo BeatVox a correr em http://localhost:8765  -  fecha esta janela para parar.
  python -m http.server 8765
) else (
  echo Python nao encontrado - a abrir o ficheiro diretamente.
  start "" "%~dp0index.html"
)
