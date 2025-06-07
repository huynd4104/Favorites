// State variables
let currentTab = null;
let favorites = [];
let filteredFavorites = [];
let autoScrollInterval = null;
let scrollContainer = null;
let draggedElement = null;
let draggedIndex = -1;
let currentNoteItemId = null;
let deleteItemId = null;

// IndexedDB Operations
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
                store.createIndex("category", "category", { unique: false });
            }
        };
    });
}

async function getAllFavorites() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("favorites", "readonly");
        const store = tx.objectStore("favorites");
        const request = store.getAll();
        request.onsuccess = () => {
            const results = request.result;
            results.sort((a, b) => (a.order || 0) - (b.order || 0));
            resolve(results);
        };
        request.onerror = () => reject(request.error);
    });
}

async function addFavorite(fav) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("favorites", "readwrite");
        const store = tx.objectStore("favorites");
        const request = store.add(fav);
        request.onsuccess = () => resolve();
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

async function deleteFavoriteById(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("favorites", "readwrite");
        const store = tx.objectStore("favorites");
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// Tab and Favorite Management
async function getCurrentTab() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab;
    } catch (error) {
        console.error('Error getting current tab:', error);
        return null;
    }
}

async function saveFavorite(url, title) {
    if (favorites.some(f => f.url === url)) {
        showStatus("URL này đã có trong danh sách!", "error");
        return;
    }

    let screenshot = null;
    try {
        screenshot = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    } catch (err) {
        console.error('Error capturing screenshot:', err);
        showStatus("Không thể chụp ảnh màn hình!", "error");
    }

    const favorite = {
        id: Date.now().toString(),
        url,
        title: title || url,
        note: '',
        dateAdded: new Date().toISOString(),
        reminderTime: null,
        repeatType: 'none',
        order: 0,
        category: 'Uncategorized',
        screenshot: screenshot
    };

    try {
        for (let i = 0; i < favorites.length; i++) {
            favorites[i].order = i + 1;
            await updateFavorite(favorites[i]);
        }
        await addFavorite(favorite);
        favorites.unshift(favorite);
        renderFavorites();
        showStatus("Đã thêm vào favorites!");
        updateAddButtonState();
    } catch (err) {
        console.error('Add error:', err);
        showStatus("Lỗi khi lưu favorite!", "error");
    }
}

async function deleteFavorite(id) {
    try {
        await deleteFavoriteById(id);
        favorites = favorites.filter(f => f.id !== id);
        renderFavorites();
        showStatus("Đã xóa khỏi favorites!");
        updateAddButtonState();
    } catch (err) {
        console.error('Delete error:', err);
        showStatus("Lỗi khi xóa favorite!", "error");
    }
}

// UI Rendering
function showStatus(message, type = 'success') {
    const statusModal = document.getElementById('statusModal');
    const statusEl = document.getElementById('statusMessage');
    statusEl.textContent = message;
    statusModal.className = `status-modal ${type}`;
    statusModal.classList.add('show');
    setTimeout(() => {
        statusModal.classList.remove('show');
    }, 2000);
}

function updateAddButtonState() {
    const addBtn = document.getElementById('addBtn');
    if (!currentTab || !addBtn) return;
    const exists = favorites.some(fav => fav.url === currentTab.url);
    addBtn.textContent = exists ? '✓ Đã có trong favorites' : '⭐ Thêm vào Favorites';
    addBtn.disabled = exists;
}

function renderFavorites(favoritesToRender = null) {
    const listEl = document.getElementById('favoritesList');
    const dataToRender = favoritesToRender || favorites;

    if (dataToRender.length === 0) {
        if (favoritesToRender !== null && favorites.length > 0) {
            listEl.innerHTML = '<div class="no-results">🔍 Không tìm thấy kết quả phù hợp</div>';
        } else {
            listEl.innerHTML = '<div class="empty-message">Chưa có URL nào được lưu</div>';
        }
        return;
    }

    listEl.innerHTML = '';
    dataToRender.forEach((fav, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'favorite-item';
        const reminderIcon = fav.reminderTime ? `<span style="position: absolute; top: 4px; left: 4px;">⏰</span>` : '';
        itemEl.innerHTML = `
            ${reminderIcon}
            <div class="drag-handle" title="Kéo để thay đổi vị trí">⋮⋮</div>
            <div class="favorite-content">
                <div class="favorite-info">
                    <a href="${escapeHtml(fav.url)}" class="favorite-link" target="_blank" title="${escapeHtml(fav.url)}">
                        <div class="favorite-title">${fav.highlightedTitle || escapeHtml(fav.title)}</div>
                        <div class="favorite-url">${fav.highlightedUrl || escapeHtml(fav.url)}</div>
                    </a>
                    <div class="favorite-category">${escapeHtml(fav.category || 'Uncategorized')}</div>
                </div>
                <div class="favorite-actions">
                    <button class="note-btn ${fav.note ? 'has-note' : ''}" title="${fav.note ? 'Chỉnh sửa ghi chú' : 'Thêm ghi chú'}">📝</button>
                    <button class="delete-btn" title="Xóa">🗑️</button>
                    <button class="preview-btn" title="Xem trước trang">👀</button>
                </div>
            </div>
            ${fav.note ? `<div class="favorite-note">${escapeHtml(fav.note)}</div>` : ''}
        `;
        itemEl.draggable = favoritesToRender === null;
        itemEl.dataset.id = fav.id;
        if (favoritesToRender === null) {
            addDragListeners(itemEl, index);
        } else {
            itemEl.style.cursor = 'default';
            const dragHandle = itemEl.querySelector('.drag-handle');
            if (dragHandle) dragHandle.style.display = 'none';
        }
        itemEl.querySelector('.note-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            showNoteModal(fav.id, fav.note || '');
        });
        itemEl.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            showDeleteModal(fav.id, fav.title);
        });
        itemEl.querySelector('.preview-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            showPreviewModal(fav.id, fav.screenshot);
        });
        listEl.appendChild(itemEl);
    });
}

// Drag and Drop
function addDragListeners(itemEl, index) {
    itemEl.addEventListener('dragstart', (e) => {
        draggedElement = itemEl;
        draggedIndex = index;
        itemEl.classList.add('dragging');
        scrollContainer = document.getElementById('favoritesList');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', itemEl.outerHTML);
        itemEl.querySelectorAll('a').forEach(link => link.style.pointerEvents = 'none');
    });

    itemEl.addEventListener('dragend', () => {
        itemEl.classList.remove('dragging');
        stopAutoScroll();
        scrollContainer = null;
        itemEl.querySelectorAll('a').forEach(link => link.style.pointerEvents = 'auto');
        draggedElement = null;
        draggedIndex = -1;
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });

    itemEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (draggedElement && draggedElement !== itemEl) {
            itemEl.classList.add('drag-over');
        }
    });

    itemEl.addEventListener('dragleave', (e) => {
        if (!itemEl.contains(e.relatedTarget)) {
            itemEl.classList.remove('drag-over');
        }
    });

    itemEl.addEventListener('drop', (e) => {
        e.preventDefault();
        if (draggedElement && draggedElement !== itemEl) {
            moveItem(draggedIndex, index);
        }
        itemEl.classList.remove('drag-over');
    });
}

async function moveItem(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const newFavorites = [...favorites];
    const [movedItem] = newFavorites.splice(fromIndex, 1);
    newFavorites.splice(toIndex, 0, movedItem);
    newFavorites.forEach((fav, index) => fav.order = index);
    favorites = newFavorites;
    try {
        const db = await openDB();
        const tx = db.transaction("favorites", "readwrite");
        const store = tx.objectStore("favorites");
        for (const fav of favorites) {
            await store.put(fav);
        }
        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        renderFavorites();
        showStatus('Đã thay đổi thứ tự!');
    } catch (error) {
        console.error('Error saving new order:', error);
        showStatus('Lỗi khi lưu thứ tự mới!', 'error');
    }
}

function startAutoScroll(direction, speed = 2) {
    if (autoScrollInterval) clearInterval(autoScrollInterval);
    autoScrollInterval = setInterval(() => {
        if (scrollContainer) {
            if (direction === 'up') {
                scrollContainer.scrollTop -= speed;
                document.getElementById('scrollUpIndicator').classList.add('show');
                document.getElementById('scrollDownIndicator').classList.remove('show');
            } else if (direction === 'down') {
                scrollContainer.scrollTop += speed;
                document.getElementById('scrollDownIndicator').classList.add('show');
                document.getElementById('scrollUpIndicator').classList.remove('show');
            }
        }
    }, 16);
}

function stopAutoScroll() {
    if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
    }
    document.getElementById('scrollUpIndicator').classList.remove('show');
    document.getElementById('scrollDownIndicator').classList.remove('show');
}

// Modal Handling
function showDeleteModal(id, title) {
    deleteItemId = id;
    document.getElementById('deleteItemTitle').textContent = title;
    document.getElementById('deleteModal').classList.add('show');
}

function hideDeleteModal() {
    document.getElementById('deleteModal').classList.remove('show');
    deleteItemId = null;
}

function confirmDelete() {
    if (deleteItemId) {
        deleteFavorite(deleteItemId);
        hideDeleteModal();
    }
}

function showNoteModal(id, note) {
    currentNoteItemId = id;
    const fav = favorites.find(f => f.id === id);
    document.getElementById('noteInput').value = note;
    document.getElementById('enableReminder').checked = !!fav.reminderTime;
    const reminderOptions = document.getElementById('reminderOptions');
    if (fav.reminderTime) {
        reminderOptions.style.display = 'block';
        reminderOptions.classList.add('show');
    } else {
        reminderOptions.style.display = 'none';
        reminderOptions.classList.remove('show');
    }
    if (fav.reminderTime) {
        const date = new Date(fav.reminderTime);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        document.getElementById('reminderTime').value = `${year}-${month}-${day}T${hours}:${minutes}`;
    } else {
        document.getElementById('reminderTime').value = '';
    }
    document.getElementById('repeatType').value = fav.repeatType || 'none';
    document.getElementById('categoryInput').value = fav.category || 'Uncategorized';
    document.getElementById('noteModal').classList.add('show');
}

function hideNoteModal() {
    document.getElementById('noteModal').classList.remove('show');
    currentNoteItemId = null;
}

function showPreviewModal(id, screenshot) {
    const previewModal = document.getElementById('previewModal');
    const previewImage = document.getElementById('previewImage');
    const previewLoading = document.getElementById('previewLoading');
    const previewError = document.getElementById('previewError');
    const magnifyBtn = document.getElementById('magnifyBtn');

    previewImage.style.display = 'none';
    previewLoading.style.display = 'block';
    previewError.style.display = 'none';
    magnifyBtn.style.display = 'none';

    previewModal.classList.add('show');

    if (screenshot) {
        previewImage.src = screenshot;
        previewImage.onload = () => {
            previewLoading.style.display = 'none';
            previewImage.style.display = 'block';
            magnifyBtn.style.display = 'block';
        };
        previewImage.onerror = () => {
            previewLoading.style.display = 'none';
            previewError.style.display = 'block';
        };
    } else {
        previewLoading.style.display = 'none';
        previewError.style.display = 'block';
    }
}

function hidePreviewModal() {
    const previewModal = document.getElementById('previewModal');
    previewModal.classList.remove('show');
}

function showFullscreenPreview(screenshot) {
    if (!currentTab || !screenshot) {
        showStatus("Không thể hiển thị xem trước toàn màn hình!", "error");
        return;
    }

    const css = `
        .fullscreen-preview-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            backdrop-filter: blur(5px);
        }
        .fullscreen-preview-image {
            max-width: 90%;
            max-height: 90%;
            border-radius: 10px;
            box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);
        }
        .fullscreen-close-btn {
            position: absolute;
            top: 20px;
            right: 20px;
            width: 36px;
            height: 36px;
            border: none;
            border-radius: 8px;
            background: linear-gradient(135deg, #ff6b6b 0%, #ff5252 100%);
            color: white;
            cursor: pointer;
            font-size: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 8px rgba(255, 82, 82, 0.3);
            transition: all 0.3s ease;
        }
        .fullscreen-close-btn:hover {
            transform: scale(1.1);
            box-shadow: 0 6px 12px rgba(255, 82, 82, 0.4);
        }
    `;

    const js = `
        (function() {
            if (document.getElementById('fullscreenPreviewOverlay')) return;
            const overlay = document.createElement('div');
            overlay.id = 'fullscreenPreviewOverlay';
            overlay.className = 'fullscreen-preview-overlay';
            const img = document.createElement('img');
            img.className = 'fullscreen-preview-image';
            img.src = '${screenshot}';
            const closeBtn = document.createElement('button');
            closeBtn.className = 'fullscreen-close-btn';
            closeBtn.innerHTML = '✕';
            closeBtn.onclick = () => overlay.remove();
            overlay.appendChild(img);
            overlay.appendChild(closeBtn);
            document.body.appendChild(overlay);
            overlay.onclick = (e) => {
                if (e.target === overlay) overlay.remove();
            };
        })();
    `;

    chrome.scripting.insertCSS({
        target: { tabId: currentTab.id },
        css: css
    }).then(() => {
        chrome.scripting.executeScript({
            target: { tabId: currentTab.id },
            func: (screenshot) => {
                if (document.getElementById('fullscreenPreviewOverlay')) return;
                const overlay = document.createElement('div');
                overlay.id = 'fullscreenPreviewOverlay';
                overlay.className = 'fullscreen-preview-overlay';
                const img = document.createElement('img');
                img.className = 'fullscreen-preview-image';
                img.src = screenshot;
                const closeBtn = document.createElement('button');
                closeBtn.className = 'fullscreen-close-btn';
                closeBtn.innerHTML = '✕';
                closeBtn.onclick = () => overlay.remove();
                overlay.appendChild(img);
                overlay.appendChild(closeBtn);
                document.body.appendChild(overlay);
                overlay.onclick = (e) => {
                    if (e.target === overlay) overlay.remove();
                };
            },
            args: [screenshot]
        }).then(() => {
            showStatus("Đã hiển thị xem trước trên trang web!");
        }).catch((error) => {
            console.error('Error injecting preview:', error);
            showStatus("Lỗi khi hiển thị xem trước toàn màn hình!", "error");
        });
    }).catch((error) => {
        console.error('Error injecting CSS:', error);
        showStatus("Lỗi khi hiển thị xem trước toàn màn hình!", "error");
    });
}

async function saveNote() {
    const newNote = document.getElementById('noteInput').value;
    const reminderEnabled = document.getElementById('enableReminder').checked;
    const reminderTime = reminderEnabled ? document.getElementById('reminderTime').value : null;
    const repeatType = reminderEnabled ? document.getElementById('repeatType').value : 'none';
    const category = document.getElementById('categoryInput').value;
    const index = favorites.findIndex(f => f.id === currentNoteItemId);
    if (index !== -1) {
        favorites[index].note = newNote;
        favorites[index].reminderTime = reminderTime;
        favorites[index].repeatType = repeatType;
        favorites[index].category = category;
        try {
            await updateFavorite(favorites[index]);
            renderFavorites();
            showStatus("Đã lưu ghi chú!");
        } catch (e) {
            console.error("Note update error:", e);
            showStatus("Lỗi khi lưu ghi chú!", "error");
        }
    }
    hideNoteModal();
}

// Search and Filter
function highlightText(text, searchTerm) {
    if (!searchTerm) return escapeHtml(text);
    const escapedText = escapeHtml(text);
    const regex = new RegExp(`(${escapeHtml(searchTerm)})`, 'gi');
    return escapedText.replace(regex, '<span class="search-highlight">$1</span>');
}

function filterFavorites(searchTerm) {
    const categoryFilter = document.getElementById('categoryFilter').value;
    if (!searchTerm.trim() && categoryFilter === 'all') {
        filteredFavorites = [];
        updateSearchInfo('');
        renderFavorites();
        return;
    }
    const term = searchTerm.toLowerCase().trim();
    filteredFavorites = favorites.filter(fav => {
        const titleMatch = fav.title.toLowerCase().includes(term);
        const urlMatch = fav.url.toLowerCase().includes(term);
        const searchMatch = term ? (titleMatch || urlMatch) : true;
        const categoryMatch = categoryFilter === 'all' || fav.category === categoryFilter;
        return searchMatch && categoryMatch;
    }).map(fav => ({
        ...fav,
        highlightedTitle: highlightText(fav.title, searchTerm),
        highlightedUrl: highlightText(fav.url, searchTerm)
    }));
    updateSearchInfo(searchTerm);
    renderFavorites(filteredFavorites);
}

function updateSearchInfo(searchTerm) {
    const searchInfo = document.getElementById('searchInfo');
    const clearBtn = document.getElementById('clearSearch');
    if (!searchTerm.trim()) {
        searchInfo.style.display = 'none';
        clearBtn.style.display = 'none';
        return;
    }
    clearBtn.style.display = 'block';
    searchInfo.style.display = 'block';
    const count = filteredFavorites.length;
    const total = favorites.length;
    if (count === 0) {
        searchInfo.textContent = `Không tìm thấy kết quả cho "${searchTerm}"`;
        searchInfo.style.background = '#fff3cd';
        searchInfo.style.borderColor = '#ffeaa7';
        searchInfo.style.color = '#856404';
    } else if (count === total) {
        searchInfo.textContent = `Hiển thị tất cả ${count} kết quả`;
        searchInfo.style.background = '#d4edda';
        searchInfo.style.borderColor = '#c3e6cb';
        searchInfo.style.color = '#155724';
    } else {
        searchInfo.textContent = `Tìm thấy ${count}/${total} kết quả cho "${searchTerm}"`;
        searchInfo.style.background = '#f0f8ff';
        searchInfo.style.borderColor = '#e6f3ff';
        searchInfo.style.color = '#666';
    }
}

function clearSearch() {
    const searchInput = document.getElementById('searchInput');
    searchInput.value = '';
    filterFavorites('');
    searchInput.focus();
}

// Utility
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Initialization
async function init() {
    try {
        const permissionGranted = await chrome.permissions.contains({
            permissions: ['notifications']
        });
        if (!permissionGranted) {
            showStatus('Vui lòng cấp quyền thông báo để sử dụng nhắc nhở!', 'error');
        }
        currentTab = await getCurrentTab();
        if (currentTab) {
            document.getElementById('currentUrl').textContent = currentTab.url;
            favorites = await getAllFavorites();
            updateAddButtonState();
            renderFavorites();
            setInterval(checkReminders, 60 * 1000);
            checkReminders();
            document.getElementById('categoryFilter').addEventListener('change', () => {
                filterFavorites(document.getElementById('searchInput').value);
            });
        } else {
            document.getElementById('currentUrl').textContent = 'Không thể lấy thông tin trang';
            document.getElementById('addBtn').disabled = true;
        }
    } catch (err) {
        console.error('Init error:', err);
        showStatus('Lỗi khởi tạo extension!', 'error');
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    init();
    document.getElementById('addBtn').addEventListener('click', () => {
        if (currentTab) saveFavorite(currentTab.url, currentTab.title);
    });

    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => filterFavorites(e.target.value));
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') clearSearch();
        });
    }
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', clearSearch);
    }

    const cancelBtn = document.getElementById('cancelBtn');
    const confirmBtn = document.getElementById('confirmBtn');
    const deleteModal = document.getElementById('deleteModal');
    if (cancelBtn) cancelBtn.addEventListener('click', hideDeleteModal);
    if (confirmBtn) confirmBtn.addEventListener('click', confirmDelete);
    if (deleteModal) {
        deleteModal.addEventListener('click', (e) => {
            if (e.target === deleteModal) hideDeleteModal();
        });
    }

    document.getElementById('cancelNoteBtn').addEventListener('click', hideNoteModal);
    document.getElementById('saveNoteBtn').addEventListener('click', saveNote);
    document.getElementById('noteModal').addEventListener('click', (e) => {
        if (e.target.id === 'noteModal') hideNoteModal();
    });

    document.addEventListener('dragover', (e) => {
        if (draggedElement && scrollContainer) {
            const containerRect = scrollContainer.getBoundingClientRect();
            const scrollThreshold = 30;
            const scrollSpeed = 3;
            if (e.clientY < containerRect.top + scrollThreshold && e.clientY > containerRect.top) {
                startAutoScroll('up', scrollSpeed);
            } else if (e.clientY > containerRect.bottom - scrollThreshold && e.clientY < containerRect.bottom) {
                startAutoScroll('down', scrollSpeed);
            } else {
                stopAutoScroll();
            }
        }
    });

    document.addEventListener('dragend', stopAutoScroll);

    document.getElementById('enableReminder').addEventListener('change', (e) => {
        const reminderOptions = document.getElementById('reminderOptions');
        if (e.target.checked) {
            reminderOptions.style.display = 'block';
            setTimeout(() => reminderOptions.classList.add('show'), 10);
        } else {
            reminderOptions.classList.remove('show');
            setTimeout(() => reminderOptions.style.display = 'none', 300);
        }
    });

    document.getElementById('previewModal').addEventListener('click', (e) => {
        if (e.target.id === 'previewModal') hidePreviewModal();
    });

    document.getElementById('magnifyBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        const previewModal = document.getElementById('previewModal');
        const previewImage = document.getElementById('previewImage');
        if (previewModal.classList.contains('show') && previewImage.src) {
            showFullscreenPreview(previewImage.src);
        } else {
            showStatus("Không có ảnh để phóng to!", "error");
        }
        hidePreviewModal();
    });
});

async function checkReminders() {
    const now = new Date();
    for (const fav of favorites) {
        if (!fav.reminderTime) continue;
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
            try {
                await updateFavorite(fav);
            } catch (e) {
                console.error("Error updating reminder:", e);
            }
        }
    }
}