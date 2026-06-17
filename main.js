'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const WebSocket = require('ws');

let ws = null;
let config = {};

function loadConfig() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'eeg-config.json'), 'utf8');
    config = JSON.parse(raw);
  } catch {
    config = {
      eegMode: false,
      serialPort: 'COM3',
      baudRate: 115200,
      lslStreamName: 'PsychoPy_LSL',
      wsPort: 8765,
    };
  }
}

function connectTriggerServer() {
  if (!config.eegMode) return;

  function attempt() {
    ws = new WebSocket(`ws://localhost:${config.wsPort}`);
    ws.on('open', () => console.log('[EEG] Connected to trigger server'));
    ws.on('error', () => {
      ws = null;
      setTimeout(attempt, 3000);   // retry every 3 s if server not ready yet
    });
    ws.on('close', () => {
      ws = null;
      setTimeout(attempt, 3000);
    });
  }
  attempt();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    fullscreen: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  loadConfig();
  connectTriggerServer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC: send trigger code to Python server ---
ipcMain.handle('send-trigger', (_, code) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(String(code));
  }
});

// --- IPC: check EEG connection status ---
ipcMain.handle('eeg-status', () => ({
  eegMode: config.eegMode,
  connected: ws !== null && ws.readyState === WebSocket.OPEN,
}));

// --- IPC: get full config ---
ipcMain.handle('get-config', () => config);

// --- IPC: append one CSV row to local file ---
ipcMain.handle('save-row', (_, taskName, sessionId, headers, values) => {
  try {
    const dir = path.join(os.homedir(), 'EEG-Task-Data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const file = path.join(dir, `${taskName}_${sessionId}.csv`);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, headers.join(',') + '\r\n', 'utf8');
    }
    fs.appendFileSync(file, values.join(',') + '\r\n', 'utf8');
  } catch (err) {
    console.error('[EEG] save-row failed:', err);
  }
});
