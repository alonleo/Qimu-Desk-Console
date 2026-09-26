@echo off
setlocal
set JAVA_HOME=D:/jvms/store/21.0.4
set PATH=D:/jvms/store/21.0.4/bin;D:\Maven\apache-maven-3.8.5\bin;%PATH%
cd /d F:\WorkSapce\workbench\admin-platform\admin-backend
echo === mvn compile ===
call mvn -DskipTests -B -e compile
echo === exit %ERRORLEVEL% ===
endlocal
