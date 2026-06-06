const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

const isDev = !app.isPackaged;

let mainWindow = null;
let activePort = null;
let reconnectTimer = null;

// ─── Create Main Window ────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js")
    },
    title: "Swarna Raseid Billing",
    icon: path.join(__dirname, "public", "favicon.ico")
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:3000");
  } else {
    mainWindow.loadFile(path.join(__dirname, "build", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
    closePort();
  });

  // Start scanning for ESP32 after window loads
  mainWindow.webContents.on("did-finish-load", () => {
    scanAndConnect();
  });
}

// ─── Serial Port: Scan & Connect ──────────────────────────────────────────────
async function scanAndConnect() {
  try {
    const ports = await SerialPort.list();

    // Find ESP32 — it typically shows up as CP210x, CH340, or FTDI
    const esp32Port = ports.find(p =>
      p.manufacturer?.toLowerCase().includes("silicon") ||   // CP2102
      p.manufacturer?.toLowerCase().includes("ch340") ||    // CH340
      p.manufacturer?.toLowerCase().includes("wch") ||      // WCH (CH340 variant)
      p.manufacturer?.toLowerCase().includes("ftdi") ||     // FTDI
      p.vendorId === "10C4" ||  // Silicon Labs CP210x
      p.vendorId === "1A86" ||  // WCH CH340
      p.vendorId === "0403"     // FTDI
    );

    if (esp32Port) {
      openSerialPort(esp32Port.path);
    } else {
      sendStatus("OFFLINE", null);
      scheduleReconnect();
    }
  } catch (err) {
    console.error("Port scan error:", err.message);
    sendStatus("OFFLINE", null);
    scheduleReconnect();
  }
}

// ─── Open Serial Connection ────────────────────────────────────────────────────
function openSerialPort(portPath) {
  if (activePort && activePort.isOpen) {
    activePort.close();
  }

  activePort = new SerialPort({
    path: portPath,
    baudRate: 115200,
    autoOpen: false
  });

  const parser = activePort.pipe(new ReadlineParser({ delimiter: "\n" }));

  activePort.open((err) => {
    if (err) {
      console.error(`Failed to open ${portPath}:`, err.message);
      sendStatus("OFFLINE", null);
      scheduleReconnect();
      return;
    }

    console.log(`✅ ESP32 connected on ${portPath}`);
    sendStatus("ONLINE", portPath);
    if (reconnectTimer) clearTimeout(reconnectTimer);
  });

  // 📨 DEBUG: Log ALL incoming serial data (no filtering)
  parser.on("data", (line) => {
    const raw = line.toString().trim();
    if (!raw) return;

    // Print everything so we can see what ESP32 sends
    console.log("=== RAW FROM ESP32 ===", JSON.stringify(raw));

    // Skip known boot garbage
    const BOOT_JUNK = ['rst:', 'ets ', 'waiting', 'boot:', 'load:', 'entry ', 'configsip'];
    const isBootMsg = BOOT_JUNK.some(prefix => raw.toLowerCase().startsWith(prefix.toLowerCase()));
    if (isBootMsg) {
      console.log("  → Skipped (boot msg)");
      return;
    }

    // Must contain a comma
    const parts = raw.split(",");
    if (parts.length < 2) {
      console.log("  → Skipped (no comma)");
      return;
    }

    const username = parts[0].trim();
    console.log("  → Sending as credentials:", username);
    sendCredentials(username, parts[1].trim());
  });


  // 🔌 Handle disconnect
  activePort.on("close", () => {
    console.log("ESP32 disconnected.");
    sendStatus("OFFLINE", null);
    activePort = null;
    scheduleReconnect();
  });

  activePort.on("error", (err) => {
    console.error("Serial error:", err.message);
    sendStatus("OFFLINE", null);
    scheduleReconnect();
  });
}

// ─── Close Active Port ─────────────────────────────────────────────────────────
function closePort() {
  if (activePort && activePort.isOpen) {
    activePort.close();
    activePort = null;
  }
  if (reconnectTimer) clearTimeout(reconnectTimer);
}

// ─── Retry Connection Every 3 Seconds ─────────────────────────────────────────
function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (!activePort || !activePort.isOpen) {
      scanAndConnect();
    }
  }, 3000);
}

// ─── IPC Senders ──────────────────────────────────────────────────────────────
function sendStatus(status, port) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("esp32:status", { status, port });
  }
}

function sendCredentials(username, password) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("esp32:credentials", { username, password });
  }
}

// ─── App Lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  closePort();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
