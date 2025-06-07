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

function checkReminders() {
    getAllFavorites().then(favorites => {
        const now = new Date();
        favorites.forEach(async fav => {
            if (!fav.reminderTime) return;
            const reminderTime = new Date(fav.reminderTime);
            const timeDiff = reminderTime - now;
            if (timeDiff <= 0 && timeDiff > -60 * 1000) { // Trong vòng 1 phút
                const shortTitle = fav.title.length > 30 ? fav.title.slice(0, 27) + "..." : fav.title;
                chrome.notifications.create(fav.id, {
                    type: 'basic',
                    iconUrl: 'icon48.png',
                    title: "⏰ Nhắc nhở URL",
                    message: shortTitle,
                    priority: 2
                });
                if (fav.repeatType === 'daily') {
                    reminderTime.setDate(reminderTime.getDate() + 1);
                } else if (fav.repeatType === 'weekly') {
                    reminderTime.setDate(reminderTime.getDate() + 7);
                } else {
                    fav.reminderTime = null;
                }
                fav.reminderTime = reminderTime.toISOString();
                await updateFavorite(fav);
            }
        });
    }).catch(err => console.error('Error checking reminders:', err));
}

setInterval(checkReminders, 60 * 1000);
checkReminders(); // Chạy ngay lần đầu