@echo off
rem Prepara o projeto (Git) e inicia o conversor. Pode ser usado sempre que quiser subir o servidor.
cd /d "%~dp0"
set "PASTA=%CD:\=/%"

echo === 1/4 Verificando Git ===
where git >nul 2>&1
if errorlevel 1 goto semgit
git --version

rem A pasta foi criada pelo usuario de sandbox do Codex; marca como confiavel para o Git.
git config --global --get-all safe.directory 2>nul | findstr /i /c:"%PASTA%" >nul
if errorlevel 1 git config --global --add safe.directory "%PASTA%"

for /f "delims=" %%n in ('git config --global user.name') do set "GITNAME=%%n"
if defined GITNAME goto emailcheck
set /p GITNAME=Digite seu nome para o Git:
git config --global user.name "%GITNAME%"

:emailcheck
for /f "delims=" %%e in ('git config --global user.email') do set "GITEMAIL=%%e"
if defined GITEMAIL goto commit
set /p GITEMAIL=Digite seu e-mail para o Git (o mesmo que usara no GitHub):
git config --global user.email "%GITEMAIL%"

:commit
echo.
echo === 2/4 Criando ponto de retorno no Git ===
if not exist ".git" git init
git add .
git diff --cached --quiet
if errorlevel 1 goto docommit
echo Nenhuma mudanca nova desde o ultimo ponto de retorno.
goto historico

:docommit
set "MSG="
set /p MSG=Descreva em poucas palavras o que mudou (Enter para usar uma descricao padrao):
if not defined MSG set "MSG=Atualizacao de %DATE% %TIME:~0,5%"
git commit -m "%MSG%"
if errorlevel 1 goto commitfalhou
echo Ponto de retorno criado com sucesso.

:historico
echo Historico:
git log --oneline -n 3

rem Se o projeto ja estiver ligado ao GitHub, envia os commits.
git remote get-url origin >nul 2>&1
if errorlevel 1 goto verificar
echo Enviando para o GitHub...
git push -u origin main
if errorlevel 1 echo Nao foi possivel enviar para o GitHub agora. O commit local esta salvo; tente de novo depois.

:verificar

echo.
echo === 3/4 Verificando Node e LibreOffice ===
where node >nul 2>&1
if errorlevel 1 goto semnode
node --version
where soffice >nul 2>&1
if errorlevel 1 goto semsoffice
echo LibreOffice encontrado no PATH.

echo.
echo === 4/4 Iniciando o servidor ===
set "PID3000="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:":3000 " ^| findstr /c:"LISTENING"') do set "PID3000=%%p"
if not defined PID3000 goto subir
echo A porta 3000 ja estava em uso por um servidor antigo (processo %PID3000%). Encerrando...
taskkill /PID %PID3000% /F >nul 2>&1
timeout /t 2 /nobreak >nul

:subir
start "Conversor DOCX para PDF - feche esta janela para parar" cmd /k npm.cmd start
timeout /t 5 /nobreak >nul
start "" http://localhost:3000
echo.
echo Pronto! O site abriu no navegador em http://localhost:3000
echo Teste arrastando um arquivo .docx e clicando em "Converter para PDF".
echo Para parar o servidor, feche a janela "Conversor DOCX para PDF".
echo.
pause
exit /b 0

:commitfalhou
echo.
echo Nao foi possivel criar o ponto de retorno. Copie a mensagem acima e envie para o Claude.
pause
exit /b 1

:semgit
echo Git nao encontrado. Instale com o comando:  winget install Git.Git
echo Depois feche esta janela e abra o iniciar.cmd novamente.
pause
exit /b 1

:semnode
echo Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e rode este arquivo de novo.
pause
exit /b 1

:semsoffice
echo O comando soffice (LibreOffice) nao foi encontrado no PATH.
echo Reinicie o computador e tente de novo. Se continuar, avise o Claude.
pause
exit /b 1
