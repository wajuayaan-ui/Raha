const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ── PRODUCT ASSISTANT — XLSX DATABASE ──
let productRows = [];
const PA_DB_CANDIDATES = [
    path.join(process.resourcesPath || '', 'data', 'products.xlsx'),
    path.join(__dirname, 'data', 'products.xlsx'),
    path.join(process.resourcesPath || '', 'data', 'products.csv'),
    path.join(__dirname, 'data', 'products.csv'),
];
const PA_IMG_DIR_CANDIDATES = [
    path.join(process.resourcesPath || '', 'ProductImages'),
    path.join(__dirname, 'ProductImages'),
];

function loadProductDB() {
    try {
        const XLSX = require('xlsx');
        const dbPath = PA_DB_CANDIDATES.find(p => fs.existsSync(p));
        if (!dbPath) { console.warn('Product DB: products.xlsx/csv not found in data/ folder.'); return 0; }
        const wb = XLSX.readFile(dbPath);
        const ws = wb.Sheets[wb.SheetNames[0]];
        productRows = XLSX.utils.sheet_to_json(ws);
        console.log(`Product DB loaded: ${productRows.length} rows from ${dbPath}`);
        return productRows.length;
    } catch (err) {
        console.error('Product DB load error:', err.message);
        return 0;
    }
}

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

        // M-3 FIX: databaseURL is NOT part of the standard Firebase service account JSON.
        // It must be a separate top-level field in firebase-config.json.
        // We read it explicitly and fall back to serviceAccount.databaseURL only for
        // backward compatibility with older config files that had it embedded.
        const databaseURL = serviceAccount.databaseURL_override
            || serviceAccount.databaseURL
            || null;

        if (!databaseURL) {
            console.error('Firebase: databaseURL not found in firebase-config.json — add a "databaseURL" field.');
            return;
        }

        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: databaseURL
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
    try {
        const { autoUpdater } = require('electron-updater');

        // FIX 1: Do NOT auto-download — let the user decide via "Download Now" button
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = true;

        function send(payload) {
            if (mainWindow) mainWindow.webContents.send('update-status', payload);
        }

        autoUpdater.on('checking-for-update', () => {
            console.log('Updater: checking...');
            // UI is already showing "checking" state — no need to send
        });

        // FIX 2: Notify UI that update is available (not downloading yet)
        autoUpdater.on('update-available', (info) => {
            console.log('Updater: update available —', info.version);
            send({
                state  : 'available',
                version: info.version,
                releaseNotes: typeof info.releaseNotes === 'string'
                    ? info.releaseNotes.replace(/<[^>]+>/g, '').trim()   // strip HTML tags
                    : 'Bug fixes and performance improvements.'
            });
        });

        // FIX 3: Notify UI when already on latest version
        autoUpdater.on('update-not-available', (info) => {
            console.log('Updater: up to date.');
            send({ state: 'not-available', version: info.version });
        });

        // FIX 4: Forward full progress data — percent, speed, transferred, total
        autoUpdater.on('download-progress', (progress) => {
            send({
                state          : 'downloading',
                percent        : Math.round(progress.percent),
                bytesPerSecond : progress.bytesPerSecond,
                transferred    : progress.transferred,
                total          : progress.total
            });
        });

        autoUpdater.on('update-downloaded', (info) => {
            console.log('Updater: download complete —', info.version);
            send({ state: 'ready', version: info.version });
        });

        autoUpdater.on('error', (err) => {
            console.error('Updater error:', err.message);
            send({ state: 'error', message: err.message });
        });

        // FIX 5: Handle renderer invoking 'check-for-updates' (triggered by clicking the menu row)
        ipcMain.handle('check-for-updates', async () => {
            try {
                if (!app.isPackaged) {
                    // In dev mode simulate a response after short delay
                    setTimeout(() => send({ state: 'not-available', version: '1.0.7' }), 1500);
                    return { success: true };
                }
                await autoUpdater.checkForUpdates();
                return { success: true };
            } catch (err) {
                send({ state: 'error', message: err.message });
                return { success: false, reason: err.message };
            }
        });

        // FIX 6: Handle renderer invoking 'start-download' (triggered by "Download Now" button)
        ipcMain.handle('start-download', async () => {
            try {
                await autoUpdater.downloadUpdate();
                return { success: true };
            } catch (err) {
                console.error('Download error:', err.message);
                return { success: false, reason: err.message };
            }
        });

        ipcMain.on('install-update-now', () => autoUpdater.quitAndInstall(false, true));

        // Silent background check 10s after launch (only in production)
        if (app.isPackaged) {
            setTimeout(() => autoUpdater.checkForUpdates(), 10000);
        }

    } catch (err) {
        console.error('Auto-updater init error:', err.message);
    }
}

let mainWindow;
let contractWindow = null;
let quotationWindow = null;
let deliveryWindow = null;
let purchaseWindow = null;
let productAssistantWindow = null;

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
    loadProductDB();
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
        if (mainWindow) mainWindow.webContents.send('record-saved');
        return { success: true };
    } catch (err) {
        return { success: false, reason: err.message };
    }
});

// Ping Firebase — used by all renderer windows to check connectivity (never touches counters)
ipcMain.handle('ping-firebase', async () => {
    if (!db) return { success: false, reason: 'no-firebase' };
    try {
        await db.ref('.info/connected').once('value');
        return { success: true };
    } catch (err) {
        return { success: false, reason: err.message };
    }
});

// Save Quotation PDF
// Uses event.sender to identify the exact calling window — never guesses from global vars.
// This means it works correctly even if both quotationWindow and deliveryWindow are open.
ipcMain.handle('save-pdf', async (event, baseName) => {
    const callerWindow = BrowserWindow.fromWebContents(event.sender);
    if (!callerWindow) return { success: false, error: 'caller-window-not-found' };
    const defaultName = baseName ? `${baseName}.pdf` : 'Quotation.pdf';
    const { filePath, canceled } = await dialog.showSaveDialog(callerWindow, {
        title: 'Save Quotation As',
        defaultPath: defaultName,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { success: false };
    try {
        const pdfBuffer = await callerWindow.webContents.printToPDF({
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
        if (mainWindow) mainWindow.webContents.send('record-saved');
        return { success: true };
    } catch (err) {
        return { success: false, reason: err.message };
    }
});

// Save Delivery Note PDF
// M-2 FIX: use event.sender to resolve the calling window — same pattern as save-pdf.
// Global deliveryWindow can be null if the window was destroyed unexpectedly.
ipcMain.handle('save-dn-pdf', async (event, baseName) => {
    const callerWindow = BrowserWindow.fromWebContents(event.sender);
    if (!callerWindow) return { success: false, error: 'caller-window-not-found' };
    const defaultName = baseName ? `${baseName}.pdf` : 'DeliveryNote.pdf';
    const { filePath, canceled } = await dialog.showSaveDialog(callerWindow, {
        title: 'Save Delivery Note As',
        defaultPath: defaultName,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { success: false };
    try {
        const pdfBuffer = await callerWindow.webContents.printToPDF({
            printBackground: true, pageSize: 'A4', landscape: false,
            margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 }
        });
        fs.writeFileSync(filePath, pdfBuffer);
        shell.openPath(filePath);
        return { success: true };
    } catch (err) {
        console.error('DN PDF Error:', err);
        return { success: false, error: err.message };
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
    // BUG #1 FIX: intercept close, ask renderer if it's safe, wait for confirm-close reply.
    contractWindow.on('close', (e) => {
        e.preventDefault();
        contractWindow.webContents.send('request-close');
    });
    ipcMain.once('confirm-close', (event, safe) => {
        if (safe) { contractWindow.destroy(); }
    });
    contractWindow.on('closed', () => { contractWindow = null; });
});


// ── Open Quotation Window ──
ipcMain.handle('open-quotation', async () => {
    if (quotationWindow) { quotationWindow.focus(); return; }
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
    quotationWindow.loadFile('quotation.html');
    quotationWindow.setMenuBarVisibility(false);
    // BUG #1 FIX: intercept close, ask renderer if it's safe, wait for confirm-close reply.
    quotationWindow.on('close', (e) => {
        e.preventDefault();
        quotationWindow.webContents.send('request-close');
    });
    ipcMain.once('confirm-close', (event, safe) => {
        if (safe) { quotationWindow.destroy(); }
    });
    quotationWindow.on('closed', () => { quotationWindow = null; });
});

// ── Open Delivery Note Window ──
ipcMain.handle('open-delivery', async () => {
    if (deliveryWindow) { deliveryWindow.focus(); return; }
    deliveryWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        title: 'Raha Co. — Delivery Note',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false
        }
    });
    deliveryWindow.loadFile('deliverynote.html');
    deliveryWindow.setMenuBarVisibility(false);
    // BUG #1 FIX: intercept close, ask renderer if it's safe, wait for confirm-close reply.
    deliveryWindow.on('close', (e) => {
        e.preventDefault();
        deliveryWindow.webContents.send('request-close');
    });
    ipcMain.once('confirm-close', (event, safe) => {
        if (safe) { deliveryWindow.destroy(); }
    });
    deliveryWindow.on('closed', () => { deliveryWindow = null; });
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
        const sn  = (record['sn_key'] || 'unknown').replace(/[.#$[\]]/g, '_');
        const safeRecord = {
            sn          : record['sn_key']      || '',
            customerName: record['customerName'] || '',
            date        : record['date']         || '',
            repName     : record['repName']      || '',
            phone       : record['phone']        || '',
            amountNumber: record['amountNumber'] || '',
            amountText  : record['amountText']   || '',
            savedAt     : record['savedAt']      || ''
        };
        await db.ref('contracts/' + sn).set(safeRecord);
        console.log('Contract saved to Firebase:', sn);
        if (mainWindow) mainWindow.webContents.send('record-saved');
        return { success: true };
    } catch (err) {
        return { success: false, reason: err.message };
    }
});

// Save Contract PDF
// M-2 FIX: use event.sender to resolve the calling window.
ipcMain.handle('save-contract-pdf', async (event, baseName) => {
    const callerWindow = BrowserWindow.fromWebContents(event.sender);
    if (!callerWindow) return { success: false, error: 'caller-window-not-found' };
    const defaultName = baseName ? `${baseName}.pdf` : 'عقد_تصنيع.pdf';
    const { filePath, canceled } = await dialog.showSaveDialog(callerWindow, {
        title: 'حفظ العقد',
        defaultPath: defaultName,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { success: false };
    try {
        const pdfBuffer = await callerWindow.webContents.printToPDF({
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
    // BUG #1 FIX: intercept close, ask renderer if it's safe, wait for confirm-close reply.
    purchaseWindow.on('close', (e) => {
        e.preventDefault();
        purchaseWindow.webContents.send('request-close');
    });
    ipcMain.once('confirm-close', (event, safe) => {
        if (safe) { purchaseWindow.destroy(); }
    });
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

// Save Purchase Order record to Firebase
ipcMain.handle('save-po-record', async (event, record) => {
    if (!db) return { success: false, reason: 'no-firebase' };
    try {
        const key = record.poNo.replace(/[.#$[\]]/g, '_');
        await db.ref('purchase_orders/' + key).set(record);
        console.log('Purchase Order saved to Firebase:', key);
        if (mainWindow) mainWindow.webContents.send('record-saved');
        return { success: true };
    } catch (err) {
        return { success: false, reason: err.message };
    }
});

// Save Purchase Order PDF
// M-2 FIX: use event.sender to resolve the calling window.
ipcMain.handle('save-po-pdf', async (event, baseName) => {
    const callerWindow = BrowserWindow.fromWebContents(event.sender);
    if (!callerWindow) return { success: false, error: 'caller-window-not-found' };
    const defaultName = baseName ? `${baseName}.pdf` : 'PurchaseOrder.pdf';
    const { filePath, canceled } = await dialog.showSaveDialog(callerWindow, {
        title: 'Save Purchase Order As',
        defaultPath: defaultName,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { success: false };
    try {
        const pdfBuffer = await callerWindow.webContents.printToPDF({
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
// ════════════════════════════════════════════
// ── HISTORY IPC HANDLER ──
// ════════════════════════════════════════════

// Fetch history records from Firebase for any module type
ipcMain.handle('get-history', async (event, type) => {
    if (!db) return { success: false, reason: 'no-firebase' };
    try {
        const refMap = {
            quotation : 'quotations',
            delivery  : 'delivery_notes',
            contract  : 'contracts',
            purchase  : 'purchase_orders'
        };
        const refPath = refMap[type];
        if (!refPath) return { success: false, reason: 'unknown-type' };

        const snap = await db.ref(refPath).orderByChild('savedAt').limitToLast(200).once('value');
        const val  = snap.val();
        if (!val) return { success: true, rows: [] };

        // Convert object to array, sort newest first
        const rows = Object.values(val).sort((a, b) => {
            const ta = a.savedAt || '';
            const tb = b.savedAt || '';
            return tb.localeCompare(ta);
        });
        return { success: true, rows };
    } catch (err) {
        return { success: false, reason: err.message };
    }
});

// ── PRODUCT ASSISTANT IPC HANDLERS ──
// ════════════════════════════════════════════

// Open Product Assistant Window
ipcMain.handle('open-product-assistant', async () => {
    if (productAssistantWindow) { productAssistantWindow.focus(); return; }
    productAssistantWindow = new BrowserWindow({
        width: 1300,
        height: 860,
        minWidth: 1000,
        minHeight: 700,
        title: 'Raha Co. — Product Assistant',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false
        }
    });
    productAssistantWindow.loadFile('product-assistant.html');
    productAssistantWindow.setMenuBarVisibility(false);
    productAssistantWindow.on('closed', () => { productAssistantWindow = null; });
});

// Search products from local XLSX database
ipcMain.handle('pa-search', async (event, { field, query }) => {
    try {
        const q = (query || '').trim().toLowerCase();
        if (!q || productRows.length === 0) return [];
        const fieldMap = {
            code:   r => String(r['Code'] || ''),
            name:   r => String(r['Item Name'] || ''),
            arabic: r => String(r['Item Name Arabic'] || ''),
            brand:  r => String(r['Brand'] || ''),
            series: r => String(r['Series'] || ''),
            all:    r => Object.values(r).join(' ')
        };
        const getter = fieldMap[field] || fieldMap['all'];
        return productRows.filter(r => getter(r).toLowerCase().includes(q)).slice(0, 50);
    } catch (err) {
        console.error('pa-search error:', err.message);
        return [];
    }
});

// Get local product image path by product code
ipcMain.handle('pa-get-image', async (event, code) => {
    try {
        const imgDir = PA_IMG_DIR_CANDIDATES.find(p => fs.existsSync(p));
        if (!imgDir) return null;
        const exts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        for (const ext of exts) {
            const p = path.join(imgDir, code + ext);
            if (fs.existsSync(p)) return 'file://' + p;
        }
        return null;
    } catch (err) {
        return null;
    }
});

// Reload product database (hot reload without restarting app)
ipcMain.handle('pa-reload-db', async () => {
    const count = loadProductDB();
    return count;
});