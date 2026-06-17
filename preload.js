'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eeg', {
  sendTrigger: (code) => ipcRenderer.invoke('send-trigger', code),
  saveRow: (taskName, sessionId, headers, values) =>
    ipcRenderer.invoke('save-row', taskName, sessionId, headers, values),
  getStatus: () => ipcRenderer.invoke('eeg-status'),
  getConfig: () => ipcRenderer.invoke('get-config'),
});
