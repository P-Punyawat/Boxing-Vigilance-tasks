@echo off
echo [EEG] Starting trigger server...
start "EEG Trigger Server" cmd /k "cd /d "%~dp0eeg-server" && python trigger_server.py"

echo [EEG] Waiting for trigger server to initialise...
timeout /t 3 /nobreak > nul

echo [EEG] Launching task...
cd /d "%~dp0"
npm start
