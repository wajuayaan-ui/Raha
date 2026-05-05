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
            console.warn('Firebase: firebase-config.json not found — ATT field will be manual.');
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
    // Only run when packaged — skip in dev mode (npm start)
    if (!app.isPackaged) {
        console.log('Auto-updater: skipped in dev mode.');
        return;
    }

    try {
        const { autoUpdater } = require('electron-updater');

        autoUpdater.autoDownload    = true;   // download silently in background
        autoUpdater.autoInstallOnAppQuit = true; // install when user quits normally

        // ── Events ──
        autoUpdater.on('checking-for-update', () => {
            console.log('Updater: checking...');
        });

        autoUpdater.on('update-available', (info) => {
            console.log('Updater: new version found —', info.version);
            // Tell the renderer to show the "Downloading update..." banner
            if (mainWindow) mainWindow.webContents.send('update-status', {
                state: 'downloading',
                version: info.version
            });
        });

        autoUpdater.on('update-not-available', () => {
            console.log('Updater: already up to date.');
        });

        autoUpdater.on('download-progress', (progress) => {
            const pct = Math.round(progress.percent);
            if (mainWindow) mainWindow.webContents.send('update-status', {
                state: 'downloading',
                percent: pct
            });
        });

        autoUpdater.on('update-downloaded', (info) => {
            console.log('Updater: download complete —', info.version);
            // Tell the renderer to show the "Restart to update" banner
            if (mainWindow) mainWindow.webContents.send('update-status', {
                state: 'ready',
                version: info.version
            });
        });

        autoUpdater.on('error', (err) => {
            console.error('Updater error:', err.message);
        });

        // ── IPC: renderer can trigger install now ──
        ipcMain.on('install-update-now', () => {
            autoUpdater.quitAndInstall(false, true);
        });

        // Check for updates — 10 second delay so the window is fully ready first
        setTimeout(() => autoUpdater.checkForUpdates(), 10000);

    } catch (err) {
        console.error('Auto-updater init error:', err.message);
    }
}

let mainWindow;

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
    initAutoUpdater();   // runs after window is created
});

app.on('window-all-closed', () => {
    app.quit();
});

// ── IPC: Get current ATT number from Firebase ──
ipcMain.handle('get-next-att', async () => {
    if (!db) return { success: false, reason: 'no-firebase' };
    try {
        const ref = db.ref('quotation_counter');
        const snap = await ref.once('value');
        const current = snap.val() || 300;
        return { success: true, value: current };
    } catch (err) {
        console.error('get-next-att error:', err.message);
        return { success: false, reason: err.message };
    }
});

// ── IPC: Increment ATT counter after successful PDF save ──
ipcMain.handle('increment-att', async () => {
    if (!db) return { success: false, reason: 'no-firebase' };
    try {
        const ref = db.ref('quotation_counter');
        const result = await ref.transaction(current => (current || 300) + 1);
        return { success: true, newValue: result.snapshot.val() };
    } catch (err) {
        console.error('increment-att error:', err.message);
        return { success: false, reason: err.message };
    }
});

// ── IPC: Save quotation record to Firebase ──
ipcMain.handle('save-quotation-record', async (event, record) => {
    if (!db) return { success: false, reason: 'no-firebase' };
    try {
        // Use attNo as the key so each quotation is easy to find
        const key = record.attNo.replace(/[.#$/[\]]/g, '_');
        await db.ref('quotations/' + key).set(record);
        console.log('Quotation saved to Firebase:', key);
        return { success: true };
    } catch (err) {
        console.error('save-quotation-record error:', err.message);
        return { success: false, reason: err.message };
    }
});

// ── IPC: Handle PDF save from renderer ──
ipcMain.handle('save-pdf', async (event, customerName, attCode) => {
    const namePart = customerName ? customerName.trim() : 'Quotation';
    const attPart  = attCode ? `_${attCode.trim()}` : '';
    const defaultName = `${namePart}${attPart}.pdf`;

    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Quotation As',
        defaultPath: defaultName,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });

    if (canceled || !filePath) return { success: false };

    try {
        const pdfBuffer = await mainWindow.webContents.printToPDF({
            printBackground: true,
            pageSize: 'A4',
            landscape: false,
            margins: {
                marginType: 'custom',
                top: 0, bottom: 0, left: 0, right: 0
            }
        });

        fs.writeFileSync(filePath, pdfBuffer);
        shell.openPath(filePath);
        return { success: true };
    } catch (err) {
        console.error('PDF Error:', err);
        return { success: false, error: err.message };
    }
});