importScripts('gdrive.js');

const CHECK_REMINDERS_ALARM = 'checkReminders';
const REMINDER_ALARM_PREFIX = 'reminder:';

function getReminderAlarmName(id) {
    return `${REMINDER_ALARM_PREFIX}${id}`;
}

async function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("FavoritesDB", 3);
        request.onerror = () => reject("Lỗi mở IndexedDB");
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("favorites")) {
                const store = db.createObjectStore("favorites", { keyPath: "id" });
                store.createIndex("reminderTime", "reminderTime", { unique: false });
            }
        }
    });
}

async function getAllFavorites() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("favorites", "readonly");
        const store = tx.objectStore("favorites");
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function updateFavorite(fav) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("favorites", "readwrite");
        const store = tx.objectStore("favorites");
        const request = store.put(fav);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function clearAlarm(name) {
    return new Promise((resolve) => {
        chrome.alarms.clear(name, () => resolve());
    });
}

function createAlarm(name, alarmInfo) {
    chrome.alarms.create(name, alarmInfo);
}

function logReminderError(err) {
    console.error('Reminder scheduling error:', err);
}

async function getNotificationPermissionLevel() {
    return new Promise((resolve, reject) => {
        chrome.notifications.getPermissionLevel((level) => {
            const err = chrome.runtime.lastError;
            if (err) {
                reject(new Error(err.message));
            } else {
                resolve(level);
            }
        });
    });
}

async function createNotification(id, options) {
    return new Promise((resolve, reject) => {
        chrome.notifications.create(id, options, (createdId) => {
            const err = chrome.runtime.lastError;
            if (err) {
                reject(new Error(err.message));
            } else {
                resolve(createdId);
            }
        });
    });
}

async function openReminderWindow(fav) {
    return new Promise((resolve, reject) => {
        const params = new URLSearchParams({
            id: fav.id,
            scheduledAt: fav.reminderTime || ''
        });
        const url = chrome.runtime.getURL(`reminder.html?${params.toString()}`);
        chrome.windows.create({
            url,
            type: 'popup',
            width: 480,
            height: 360,
            focused: true
        }, (window) => {
            const err = chrome.runtime.lastError;
            if (err) {
                reject(new Error(err.message));
            } else {
                resolve(window);
            }
        });
    });
}

async function scheduleReminderAlarm(fav) {
    const alarmName = getReminderAlarmName(fav.id);
    await clearAlarm(alarmName);

    if (!fav.reminderTime) return;

    const reminderAt = new Date(fav.reminderTime).getTime();
    if (Number.isNaN(reminderAt)) return;

    createAlarm(alarmName, { when: Math.max(Date.now() + 1000, reminderAt) });
}

async function rescheduleAllReminderAlarms() {
    const favorites = await getAllFavorites();
    await Promise.all(favorites.map(scheduleReminderAlarm));
}

function getNextReminderTime(reminderTime, repeatType) {
    if (!repeatType || repeatType === 'none') return null;

    const next = new Date(reminderTime);
    const now = Date.now();

    do {
        if (repeatType === 'hourly') {
            next.setHours(next.getHours() + 1);
        } else if (repeatType === 'daily') {
            next.setDate(next.getDate() + 1);
        } else if (repeatType === 'weekly') {
            next.setDate(next.getDate() + 7);
        } else if (repeatType === 'monthly') {
            next.setMonth(next.getMonth() + 1);
        } else {
            return null;
        }
    } while (next.getTime() <= now);

    return next.toISOString();
}

async function notifyFavorite(fav) {
    const title = fav.title || fav.url || 'Không có tiêu đề';
    const shortTitle = title.length > 60 ? title.slice(0, 57) + "..." : title;
    const notificationPromise = getNotificationPermissionLevel()
        .then((permissionLevel) => {
            if (permissionLevel !== 'granted') {
                throw new Error(`Notifications permission is ${permissionLevel}`);
            }

            return createNotification(fav.id, {
                type: 'basic',
                iconUrl: 'icon48.png',
                title: shortTitle,
                message: "Đến giờ xem lại URL này",
                contextMessage: fav.url || '',
                priority: 2,
                isClickable: true,
                requireInteraction: true
            });
        });
    const results = await Promise.allSettled([
        notificationPromise,
        openReminderWindow(fav)
    ]);

    if (results.every(result => result.status === 'rejected')) {
        throw new Error(results.map(result => result.reason.message).join('; '));
    }

    results
        .filter(result => result.status === 'rejected')
        .forEach(result => logReminderError(result.reason));

    fav.reminderTime = getNextReminderTime(fav.reminderTime, fav.repeatType);
    if (!fav.reminderTime) {
        fav.repeatType = 'none';
    }

    await updateFavorite(fav);
    await scheduleReminderAlarm(fav);
}

async function checkReminderById(id) {
    const favorites = await getAllFavorites();
    const fav = favorites.find(item => item.id === id);
    if (!fav || !fav.reminderTime) return;

    const reminderTime = new Date(fav.reminderTime);
    if (Number.isNaN(reminderTime.getTime())) return;

    if (reminderTime.getTime() <= Date.now()) {
        await notifyFavorite(fav);
    } else {
        await scheduleReminderAlarm(fav);
    }
}

async function checkReminders() {
    try {
        const favorites = await getAllFavorites();
        for (const fav of favorites) {
            try {
                if (!fav.reminderTime) continue;
                const reminderTime = new Date(fav.reminderTime);
                if (Number.isNaN(reminderTime.getTime())) continue;

                if (reminderTime.getTime() <= Date.now()) {
                    await notifyFavorite(fav);
                } else {
                    await scheduleReminderAlarm(fav);
                }
            } catch (err) {
                logReminderError(err);
            }
        }
    } catch (err) {
        console.error('Error checking reminders:', err);
    }
}

async function performAutoBackup() {
    try {
        const { autoBackup } = await chrome.storage.local.get('autoBackup');
        if (!autoBackup) return;

        console.log('Data changed, starting auto backup...');

        const token = await gDrive.getAuthToken(false).catch(() => null);
        if (!token) {
            console.log('Auto backup: Not logged in or token not available');
            return;
        }

        const favorites = await getAllFavorites();
        const storageData = await chrome.storage.local.get('customCategories');
        const customCategories = JSON.parse(storageData.customCategories || '[]');

        const dataToBackup = {
            favorites,
            customCategories,
            lastSynced: new Date().toISOString(),
            autoSynced: true
        };

        await gDrive.saveBackup(dataToBackup, token);
        console.log('Auto backup completed at:', new Date().toLocaleString());

        // Thông báo phản hồi nhanh khi dữ liệu thay đổi
        chrome.notifications.create('autoBackupSuccess', {
            type: 'basic',
            iconUrl: 'icon48.png',
            title: "🔄 Drive Auto-sync",
            message: "Đã cập nhật dữ liệu lên Google Drive",
            priority: 1
        });
    } catch (err) {
        console.error('Auto backup failed:', err);
    }
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CHECK_REMINDERS_ALARM) {
        checkReminders();
    } else if (alarm.name.startsWith(REMINDER_ALARM_PREFIX)) {
        checkReminderById(alarm.name.slice(REMINDER_ALARM_PREFIX.length)).catch(logReminderError);
    }
});

chrome.notifications.onClicked.addListener((notificationId) => {
    getAllFavorites()
        .then((favorites) => {
            const fav = favorites.find(item => item.id === notificationId);
            if (fav?.url) {
                chrome.tabs.create({ url: fav.url });
            }
            chrome.notifications.clear(notificationId);
        })
        .catch(logReminderError);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'triggerAutoBackup') {
        performAutoBackup();
    } else if (message.action === 'reminderUpdated') {
        if (message.favorite) {
            scheduleReminderAlarm(message.favorite)
                .then(() => checkReminderById(message.favorite.id))
                .catch(logReminderError);
        } else if (message.id) {
            clearAlarm(getReminderAlarmName(message.id)).catch(logReminderError);
        }
    } else if (message.action === 'rescheduleAll') {
        rescheduleAllReminderAlarms().catch(logReminderError);
    }
});

chrome.runtime.onInstalled.addListener(() => {
    createAlarm(CHECK_REMINDERS_ALARM, { periodInMinutes: 1 });
    rescheduleAllReminderAlarms().catch(logReminderError);
    checkReminders();
});

chrome.runtime.onStartup.addListener(() => {
    createAlarm(CHECK_REMINDERS_ALARM, { periodInMinutes: 1 });
    rescheduleAllReminderAlarms().catch(logReminderError);
});

createAlarm(CHECK_REMINDERS_ALARM, { periodInMinutes: 1 });
rescheduleAllReminderAlarms().catch(logReminderError);
