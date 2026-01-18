import { defineScreen, render, header, subfile, text } from '../dsl/index.js';
import { listBackups, createBackup, formatSize } from '../services/backup.js';
import { mainMenuScreen } from './mainMenu.js';
// ============================================
// Screen Definition (Logical)
// ============================================
const BACKUP_MGMT_SCREEN = defineScreen('BACKUP_MGMT', {
    elements: [
        header({ system: 'AS500 SYSTEM', title: 'BACKUP MANAGEMENT', showDateTime: true, showUser: true }),
        text(5, 8, 'Automatic backups: Enabled (every 60 minutes, keep last 10)'),
        text(6, 8, 'Backup location: server/backups/'),
        subfile('backups', 8, 10, [
            { header: 'Backup Date/Time', key: 'timestamp', width: 25 },
            { header: 'Size', key: 'size', width: 10, align: 'right' },
            { header: 'Filename', key: 'filename', width: 40 },
        ]),
    ],
    statusLine: 'F3=Exit  F5=Create backup now  F12=Cancel',
});
// ============================================
// Screen Builder (uses DSL renderer)
// ============================================
export function buildBackupMgmtScreen(session, message, messageType) {
    const backupList = listBackups();
    // Transform backups for display
    const backupsData = backupList.map((backup) => ({
        timestamp: backup.timestamp.toLocaleString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }),
        size: formatSize(backup.size),
        filename: backup.filename,
    }));
    const result = render(BACKUP_MGMT_SCREEN, { backups: backupsData }, {
        user: session.username || 'UNKNOWN',
        message,
        messageType,
    });
    return {
        screenId: result.screenId,
        cursor: result.cursor,
        rows: result.rows,
        fields: result.fields,
        message: result.message,
        messageType: result.messageType,
        statusLine: result.statusLine,
        bell: result.bell,
    };
}
// ============================================
// Screen Handler (Business Logic)
// ============================================
export async function handleBackupMgmt(session, request) {
    const base = { sessionId: session.id };
    // Handle F3 - Exit to main menu
    if (request.key === 'F3' || request.key === 'F12') {
        // Pop back to previous screen (should be MAIN_MENU)
        const previousScreen = session.screenStack.pop() || 'MAIN_MENU';
        session.currentScreen = previousScreen;
        return {
            ...mainMenuScreen(session),
            ...base,
        };
    }
    // Handle F5 - Create backup now
    if (request.key === 'F5') {
        try {
            await createBackup();
            return {
                ...buildBackupMgmtScreen(session, 'Backup created successfully', 'info'),
                ...base,
            };
        }
        catch (error) {
            return {
                ...buildBackupMgmtScreen(session, `Backup failed: ${error}`, 'error'),
                ...base,
                bell: true,
            };
        }
    }
    // Default - just show the screen
    return {
        ...buildBackupMgmtScreen(session),
        ...base,
    };
}
