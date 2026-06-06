const { contextBridge, ipcRenderer } = require("electron");

/**
 * 🔌 PRELOAD BRIDGE - Secure channel between Electron main and React renderer
 * Exposes only what React needs — no direct Node.js access from the browser.
 */
contextBridge.exposeInMainWorld("esp32", {
  // Listen for credential autofill event from ESP32
  onCredentials: (callback) => {
    ipcRenderer.on("esp32:credentials", (event, data) => callback(data));
  },

  // Listen for device connection status changes
  onStatus: (callback) => {
    ipcRenderer.on("esp32:status", (event, data) => callback(data));
  },

  // Remove listeners on component unmount
  removeListeners: () => {
    ipcRenderer.removeAllListeners("esp32:credentials");
    ipcRenderer.removeAllListeners("esp32:status");
  }
});
