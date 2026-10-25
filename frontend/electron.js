const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
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
    title: "Swarna Sethu Billing",
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

// ─── Invoice PDF: save the current page (print layout) as an A4 PDF ───────────
ipcMain.handle("invoice:save-pdf", async (event, fileName) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const safeName = String(fileName || "Invoice").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 100);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "Save invoice as PDF",
    defaultPath: path.join(app.getPath("documents"), `${safeName}.pdf`),
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
  if (canceled || !filePath) return { canceled: true };
  const pdf = await event.sender.printToPDF({
    pageSize: "A4",
    printBackground: true,
    margins: { marginType: "custom", top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
  });
  fs.writeFileSync(filePath, pdf);
  shell.showItemInFolder(filePath);
  return { filePath };
});

// ─── Barcode labels: list printers, print to one (no dialog), or save as PDF ───
ipcMain.handle("labels:printers", async (event) => {
  const printers = await event.sender.getPrintersAsync();
  return printers.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }));
});

/** Loads the label HTML in a hidden window; resolves with that window once it has rendered */
async function loadLabelWindow(html) {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return win;
}

ipcMain.handle("labels:print", async (event, { html, widthMm, heightMm, deviceName }) => {
  const win = await loadLabelWindow(String(html));
  try {
    await new Promise((resolve, reject) => {
      win.webContents.print({
        silent: true,
        printBackground: true,
        deviceName: deviceName || "",            // empty = the system default printer
        margins: { marginType: "none" },
        pageSize: { width: Math.round(widthMm * 1000), height: Math.round(heightMm * 1000) } // microns
      }, (success, reason) => (success ? resolve() : reject(new Error(reason || "Printing failed"))));
    });
    return { printed: true };
  } finally {
    win.destroy();
  }
});

ipcMain.handle("labels:pdf", async (event, { html, widthMm, heightMm }) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    title: "Save barcode labels as PDF",
    defaultPath: path.join(app.getPath("documents"), "Barcode labels.pdf"),
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
  if (canceled || !filePath) return { canceled: true };
  const win = await loadLabelWindow(String(html));
  try {
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: { width: widthMm / 25.4, height: heightMm / 25.4 }, // inches
      margins: { marginType: "none" }
    });
    fs.writeFileSync(filePath, pdf);
  } finally {
    win.destroy();
  }
  shell.showItemInFolder(filePath);
  return { filePath };
});

// ─── App Lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  closePort();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
