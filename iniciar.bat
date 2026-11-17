@echo off
cd /d "%~dp0"
where java >nul 2>nul
if errorlevel 1 (
  echo Se requiere Java 21 o superior. Instala un JDK o JRE 21 para continuar.
  pause
  exit /b 1
)
echo BikeStore Async v1.0
echo Abre http://localhost:8080 en tu navegador cuando aparezca la direccion.
echo Conserva esta ventana abierta. Para detener: Ctrl+C.
set "APP_JAR=target\bikestore-async-1.0.jar"
if exist "bikestore-async-1.0.jar" set "APP_JAR=bikestore-async-1.0.jar"
if exist "%APP_JAR%" goto iniciar
where mvn >nul 2>nul
if errorlevel 1 (
  echo Falta compilar el proyecto. Instala Maven y ejecuta mvn package -DskipTests.
  pause
  exit /b 1
)
echo Compilando el proyecto...
if exist ".m2" (
  call mvn "-Dmaven.repo.local=%~dp0.m2" -q package -DskipTests
) else (
  call mvn -q package -DskipTests
)
if errorlevel 1 (
  echo No se pudo compilar. Revisa Java 21 y el acceso a las dependencias de Maven.
  pause
  exit /b 1
)
:iniciar
java -Dorg.slf4j.simpleLogger.defaultLogLevel=error -jar "%APP_JAR%"
if errorlevel 1 pause
