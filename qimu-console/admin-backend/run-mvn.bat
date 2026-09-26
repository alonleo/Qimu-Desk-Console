@echo off
setlocal
set JAVA_HOME=D:\jvms\store\21.0.4
set PATH=D:\jvms\store\21.0.4\bin;D:\Maven\apache-maven-3.8.5\bin;%PATH%
cd /d F:\WorkSapce\workbench\admin-platform\admin-backend
call mvn -DskipTests -B compile > mvn-compile.log 2>&1
echo EXIT_CODE=%ERRORLEVEL%
type mvn-compile.log | findstr /R /C:"BUILD SUCCESS" /C:"BUILD FAILURE" /C:"ERROR" /C:"ERROR:"
