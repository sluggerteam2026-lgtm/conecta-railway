@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Conecta
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo O Node.js nao esta instalado neste computador.
  echo Instale o Node.js LTS em https://nodejs.org e execute este arquivo novamente.
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias do Conecta pela primeira vez...
  call npm install
  if errorlevel 1 (
    echo Falha ao instalar as dependencias.
    pause
    exit /b 1
  )
)
echo.
echo Iniciando Conecta...
echo Abra http://localhost:3000 no navegador se ele nao abrir sozinho.
start "" http://localhost:3000
call npm start
pause
