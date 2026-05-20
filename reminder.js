"use strict";

let currentFavorite = null;
let scheduledAt = null;

async function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("FavoritesDB", 3);
        request.onerror = () => reject(request.error || new Error("Lỗi mở IndexedDB"));
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("favorites")) {
                const store = db.createObjectStore("favorites", { keyPath: "id" });
                store.createIndex("reminderTime", "reminderTime", { unique: false });
                store.createIndex("category", "category", { unique: false });
            }
        };
    });
}

async function getFavoriteById(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("favorites", "readonly");
        const store = tx.objectStore("favorites");
        const request = store.get(id);
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

function formatScheduledTime(value) {
    if (!value) return "Không xác định";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Không xác định";

    return new Intl.DateTimeFormat("vi-VN", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}

function closeReminderWindow() {
    window.close();
}

function openFavoriteUrl() {
    if (!currentFavorite?.url) return;

    chrome.tabs.create({ url: currentFavorite.url }, () => {
        closeReminderWindow();
    });
}

async function snoozeReminder() {
    if (!currentFavorite) return;

    const nextTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    currentFavorite.reminderTime = nextTime;
    await updateFavorite(currentFavorite);
    chrome.runtime.sendMessage({ action: "reminderUpdated", favorite: currentFavorite });
    closeReminderWindow();
}

async function init() {
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    scheduledAt = params.get("scheduledAt");
    if (!id) {
        document.getElementById("title").textContent = "Không tìm thấy lời nhắc";
        return;
    }

    currentFavorite = await getFavoriteById(id);
    if (!currentFavorite) {
        document.getElementById("title").textContent = "Lời nhắc không còn tồn tại";
        return;
    }

    document.getElementById("title").textContent = currentFavorite.title || currentFavorite.url || "Không có tiêu đề";
    document.getElementById("scheduledTime").textContent = formatScheduledTime(scheduledAt || currentFavorite.reminderTime);
    const rawUrl = currentFavorite.url || "";
    let displayUrl = rawUrl;
    if (rawUrl.length > 60) {
        const half = 28; // (60 - 3) / 2 rounded
        displayUrl = rawUrl.substring(0, half) + "..." + rawUrl.substring(rawUrl.length - half);
    }
    document.getElementById("url").textContent = displayUrl;
    document.getElementById("url").title = rawUrl; // Thêm tooltip để xem full URL
    const note = currentFavorite.note || "";
    document.getElementById("note").textContent = note;
    document.getElementById("noteBlock").classList.toggle("is-empty", !note.trim());
}

document.getElementById("openBtn").addEventListener("click", openFavoriteUrl);
document.getElementById("snoozeBtn").addEventListener("click", () => {
    snoozeReminder().catch((err) => {
        console.error("Snooze reminder error:", err);
    });
});
document.getElementById("dismissBtn").addEventListener("click", closeReminderWindow);
document.addEventListener("DOMContentLoaded", () => {
    init().catch((err) => {
        console.error("Reminder window error:", err);
        document.getElementById("title").textContent = "Không thể tải lời nhắc";
    });
});
