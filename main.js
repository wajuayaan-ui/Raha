const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ── FIREBASE SETUP ──
let db = null;
function initFirebase() {
    try {
        const admin = require('firebase-admin');

        const configCandidates = [
            path.join(process.resourcesPath || '', 'firebase-config.json'),
            path.join(__dirname, 'firebase-config.json')
        ];
        const configPath = configCandidates.find(p => fs.existsSync(p));

        if (!configPath) {
            console.warn('Firebase: firebase-config.json not found — manual mode.');
            return;
        }

        const serviceAccount = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: serviceAccount.databaseURL
            });
        }

        db = admin.database();
        console.log('Firebase connected OK');
    } catch (err) {
        console.error('Firebase init error:', err.message);
    }
}

// ── AUTO-UPDATE SETUP ──
function initAutoUpdater() {
    if (!app.isPackaged) {
        console.log('Auto-updater: skipped in dev mode.');
        return;
    }
    try {
        const { autoUpdater } = require('electron-updater');
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;

        autoUpdater.on('checking-for-update', () => console.log('Updater: checking...'));
        autoUpdater.on('update-not-available', () => console.log('Updater: up to date.'));
        autoUpdater.on('error', (err) => console.error('Updater error:', err.message));

        autoUpdater.on('update-available', (info) => {
            if (mainWindow) mainWindow.webContents.send('update-status', { state: 'downloading', version: info.version });
        });

        autoUpdater.on('download-progress', (progress) => {
            const pct = Math.round(progress.percent);
            if (mainWindow) mainWindow.webContents.send('update-status', { state: 'downloading', percent: pct });
        });

        autoUpdater.on('update-downloaded', (info) => {
            if (mainWindow) mainWindow.webContents.send('update-status', { state: 'ready', version: info.version });
        });

        ipcMain.on('install-update-now', () => autoUpdater.quitAndInstall(false, true));
        setTimeout(() => autoUpdater.checkForUpdates(), 10000);

    } catch (err) {
        console.error('Auto-updater init error:', err.message);
    }
}

let mainWindow;
let contractWindow = null;
let quotationWindow = null;
let purchaseWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        title: 'Raha Co. — Quotation System',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false
        }
    });
    mainWindow.loadFile('index.html');
    mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
    initFirebase();
    createWindow();
    initAutoUpdater();
});

app.on('window-all-closed', () => app.quit());

// ════════════════════════════════════════════
// ── QUOTATION IPC HANDLERS ──
// ════════════════════════════════════════════

// Get current ATT number from Firebase
ipcMain.handle('get-next-att', async () => {
    if (!db) return { success: false, reason: 'no-firebase' };
    try {
        const snap = await db.ref('quotation_counter').once('value');
        return { success: true, value: snap.val() || 300 };
    } catch (err) {
        return { success: false, reason: err.message };
    }
});

// Increment ATT counter after successful PDF save
ipcMain.handle('increment-att', async () => {
    if (!db) return { success: false, reason: 'no-firebase' };
    try {
        const result = await db.ref('quotation_counter').transaction(n => (n || 300) + 1);
        return { success: true, newValue: result.snapshot.val() };
    } catch (err) {
        return { success: false, reason: err.message };
    }
});

// Save quotation record to Firebase
ipcMain.handle('save-quotation-record', async (event, record) => {
    if (!db) return { success: false, reason: 'no-firebase' };
    try {
        const key = record.attNo.replace(/[.#$[\]]/g, '_');
        await db.ref('quotations/' + key).set(record);
        console.log('Quotation saved to Firebase:', key);
        return { success: true };
    } catch (err) {
        return { success: false, reason: err.message };
    }
});

// Save Quotation PDF
ipcMain.handle('save-pdf', async (event, baseName) => {
    const defaultName = baseName ? `${baseName}.pdf` : 'Quotation.pdf';
    const { filePath, canceled } = await dialog.showSaveDialog(quotationWindow || mainWindow, {
        title: 'Save Quotation As',
        defaultPath: defaultName,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { success: false };
    try {
        const targetWindow = quotationWindow || mainWindow;
        const pdfBuffer = await targetWindow.webContents.printToPDF({
            printBackground: true, pageSize: 'A4', landscape: false,
            margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 }
        });
        fs.writeFileSync(filePath, pdfBuffer);
        shell.openPath(filePath);
        return { success: true };
    } catch (err) {
        console.error('PDF Error:', err);
        return { success: false, error: err.message };
    }
});

// ════════════════════════════════════════════
// ── DELIVERY NOTE IPC HANDLERS ──
// ════════════════════════════════════════════

// Get current delivery note counter from Firebase
ipcMain.handle('get-next-dn', async () => {
    if (!db) return { success: false, reason: 'no-firebase' };
    try {
        const snap = await db.ref('delivery_counter').once('value');
        return { success: true, value: snap.val() || 1 };
    } catch (err) {
        return { success: false, reason: err.message };
    }
});

// Increment delivery note counter after successful PDF save
ipcMain.handle('increment-dn', async () => {
    if (!db) return { success: false, reason: 'no-firebase' };
    try {
        const result = await db.ref('delivery_counter').transaction(n => (n || 1) + 1);
        return { success: true, newValue: result.snapshot.val() };
    } catch (err) {
        return { success: false, reason: err.message };
    }
});

// Save delivery note record to Firebase
ipcMain.handle('save-dn-record', async (event, record) => {
    if (!db) return { success: false, reason: 'no-firebase' };
    try {
        const key = record.dnNo.replace(/[.#$[\]]/g, '_');
        await db.ref('delivery_notes/' + key).set(record);
        console.log('Delivery note saved to Firebase:', key);
        return { success: true };
    } catch (err) {
        return { success: false, reason: err.message };
    }
});

// ════════════════════════════════════════════
// ── CONTRACT IPC HANDLERS ──
// ════════════════════════════════════════════

// Open Contract Window
ipcMain.handle('open-contract', async () => {
    if (contractWindow) { contractWindow.focus(); return; }
    contractWindow = new BrowserWindow({
        width: 1300,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        title: 'Raha Co. — عقد تصنيع',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false
        }
    });
    contractWindow.loadFile('contract.html');
    contractWindow.setMenuBarVisibility(false);
    contractWindow.on('closed', () => { contractWindow = null; });
});

// ── Open Quotation Window ──
ipcMain.handle('open-quotation', async (event, mode) => {
    // mode = 'quotation' or 'delivery'
    if (quotationWindow) {
        quotationWindow.focus();
        // Tell the already-open window to switch mode
        quotationWindow.webContents.send('set-mode', mode || 'quotation');
        return;
    }
    quotationWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        title: 'Raha Co. — Quotation System',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false
        }
    });
    quotationWindow.loadFile('quotation.html', { query: { mode: mode || 'quotation' } });
    quotationWindow.setMenuBarVisibility(false);
    quotationWindow.on('closed', () => { quotationWindow = null; });
});

// Get current contract S/N from Firebase
ipcMain.handle('get-next-sn', async () => {
    if (!db) return { success: false, reason: 'no-firebase' };
    try {
        const snap = await db.ref('contract_counter').once('value');
        return { success: true, value: snap.val() || 1 };
    } catch (err) {
        return { success: false, reason: err.message };
    }
});

// Increment contract S/N counter after successful PDF save
ipcMain.handle('increment-sn', async () => {
    if (!db) return { success: false, reason: 'no-firebase' };
    try {
        const result = await db.ref('contract_counter').transaction(n => (n || 1) + 1);
        return { success: true, newValue: result.snapshot.val() };
    } catch (err) {
        return { success: false, reason: err.message };
    }
});

// Save contract record to Firebase
ipcMain.handle('save-contract-record', async (event, record) => {
    if (!db) return { success: false, reason: 'no-firebase' };
    try {
        const key = record.sn.replace(/[.#$[\]]/g, '_');
        await db.ref('contracts/' + key).set(record);
        console.log('Contract saved to Firebase:', key);
        return { success: true };
    } catch (err) {
        return { success: false, reason: err.message };
    }
});

// Save Contract PDF
ipcMain.handle('save-contract-pdf', async (event, baseName) => {
    if (!contractWindow) return { success: false };
    const defaultName = baseName ? `${baseName}.pdf` : 'عقد_تصنيع.pdf';
    const { filePath, canceled } = await dialog.showSaveDialog(contractWindow, {
        title: 'حفظ العقد',
        defaultPath: defaultName,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { success: false };
    try {
        const pdfBuffer = await contractWindow.webContents.printToPDF({
            printBackground: true, pageSize: 'A4', landscape: false,
            margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 }
        });
        fs.writeFileSync(filePath, pdfBuffer);
        shell.openPath(filePath);
        return { success: true };
    } catch (err) {
        console.error('Contract PDF Error:', err);
        return { success: false, error: err.message };
    }
});

// ════════════════════════════════════════════
// ── PURCHASE ORDER IPC HANDLERS ──
// ════════════════════════════════════════════

// Open Purchase Order Window
ipcMain.handle('open-purchase', async () => {
    if (purchaseWindow) { purchaseWindow.focus(); return; }
    purchaseWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        title: 'Raha Co. — Purchase Order',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false
        }
    });
    purchaseWindow.loadFile('purchaseorder.html');
    purchaseWindow.setMenuBarVisibility(false);
    purchaseWindow.on('closed', () => { purchaseWindow = null; });
});

// Get current PO counter from Firebase
ipcMain.handle('get-next-po', async () => {
    if (!db) return { success: false, reason: 'no-firebase' };
    try {
        const snap = await db.ref('purchaseorder_counter').once('value');
        return { success: true, value: snap.val() || 1 };
    } catch (err) {
        return { success: false, reason: err.message };
    }
});

// Increment PO counter after successful PDF save
ipcMain.handle('increment-po', async () => {
    if (!db) return { success: false, reason: 'no-firebase' };
    try {
        const result = await db.ref('purchaseorder_counter').transaction(n => (n || 1) + 1);
        return { success: true, newValue: result.snapshot.val() };
    } catch (err) {
        return { success: false, reason: err.message };
    }
});

// Save Purchase Order PDF (from purchaseWindow, not mainWindow)
ipcMain.handle('save-po-pdf', async (event, baseName) => {
    if (!purchaseWindow) return { success: false };
    const defaultName = baseName ? `${baseName}.pdf` : 'PurchaseOrder.pdf';
    const { filePath, canceled } = await dialog.showSaveDialog(purchaseWindow, {
        title: 'Save Purchase Order As',
        defaultPath: defaultName,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { success: false };
    try {
        const pdfBuffer = await purchaseWindow.webContents.printToPDF({
            printBackground: true, pageSize: 'A4', landscape: false,
            margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 }
        });
        fs.writeFileSync(filePath, pdfBuffer);
        shell.openPath(filePath);
        return { success: true };
    } catch (err) {
        console.error('PO PDF Error:', err);
        return { success: false, error: err.message };
    }
});