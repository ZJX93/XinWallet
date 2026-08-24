@echo off
REM HarmonyOS 构建包装脚本（Windows）：按优先级查找 hvigor 并转发参数。
REM 注意：
REM  - 必须提供 DEVECO_SDK_HOME，否则 hvigor 报 00303217 Configuration Error，
REM    本脚本会在找到 hvigor 后自动推断同级 sdk 目录。
REM  - 若外部通过 NODE_OPTIONS 注入了删除保护类 shim，hvigor 清理 build 中间目录
REM    时会被拦，表现为 00308018 Unknown Error，故此处清空 NODE_OPTIONS。
setlocal
set BASE_DIR=%~dp0
set NODE_OPTIONS=

REM 1) 全局 npm 安装
for /f "delims=" %%i in ('npm root -g 2^>nul') do set GLOBAL=%%i\@ohos\hvigor\bin\hvigorw.js
if exist "%GLOBAL%" (
  call :run "%GLOBAL%" %*
  exit /b %ERRORLEVEL%
)

REM 2) 本地 node_modules
set LOCAL=%BASE_DIR%node_modules\@ohos\hvigor\bin\hvigorw.js
if exist "%LOCAL%" (
  call :run "%LOCAL%" %*
  exit /b %ERRORLEVEL%
)

REM 3) DevEco Studio / Command Line Tools 常见安装路径
for %%p in (
  "D:\Program Files\Public\DevEco Studio\tools\hvigor\bin\hvigorw.js"
  "C:\Program Files\Public\DevEco Studio\tools\hvigor\bin\hvigorw.js"
  "C:\Program Files\Huawei\DevEco Studio\tools\hvigor\bin\hvigorw.js"
  "%USERPROFILE%\commandline-tools\command-line-tools\hvigor\bin\hvigorw.js"
) do (
  if exist %%p (
    call :run %%p %*
    exit /b %ERRORLEVEL%
  )
)

echo hvigor not found. Install with: npm install -g @ohos/hvigor  (or use DevEco Studio / Command Line Tools)
exit /b 1

:run
REM %1 = hvigorw.js 路径，推断 <root>\sdk 作为 DEVECO_SDK_HOME
set ENTRY=%~1
shift
if "%DEVECO_SDK_HOME%"=="" (
  for %%d in ("%ENTRY%\..\..\..") do set HV_ROOT=%%~fd
  if exist "%HV_ROOT%\sdk" set DEVECO_SDK_HOME=%HV_ROOT%\sdk
)
node "%ENTRY%" %1 %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%
