"use strict";
//biến toàn cục
let favorites = [];
let currentTab = null;
let draggedElement = null;
let draggedIndex = -1;
let scrollContainer = null;
let autoScrollInterval = null;
let deleteItemId = null;
let currentNoteItemId = null;
let filteredFavorites = [];
let customCategories = [];
let deleteCategoryIndex = null;

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
            results.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
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
        updateDomainFilter();
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
        updateDomainFilter();
        renderFavorites();
        showStatus("Đã xóa khỏi favorites!");
        updateAddButtonState();
    } catch (err) {
        console.error('Delete error:', err);
        showStatus("Lỗi khi xóa favorite!", "error");
    }
}

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

function translateCategory(category) {
    const categoryMap = {
        'Uncategorized': 'Chưa phân loại',
        'Work': 'Công việc',
        'Study': 'Học tập',
        'Entertainment': 'Giải trí',
        'Other': 'Khác'
    };
    return categoryMap[category] || category || 'Chưa phân loại';
}

function formatDate(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${hours}:${minutes} ${day}/${month}/${year}`;
}

function renderFavorites(favoritesToRender = null) {
    const listEl = document.getElementById('favoritesList');
    const dataToRender = favoritesToRender || favorites;

    if (dataToRender.length === 0) {
        listEl.innerHTML = favoritesToRender !== null && favorites.length > 0
            ? '<div class="no-results">🔍 Không tìm thấy kết quả phù hợp</div>'
            : '<div class="empty-message">Chưa có URL nào được lưu</div>';
        return;
    }

    const fragment = document.createDocumentFragment();
    dataToRender.forEach((fav, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'favorite-item';
        itemEl.dataset.id = fav.id;
        itemEl.draggable = favoritesToRender === null;

        const reminderIcon = fav.reminderTime ? `<span class="reminder-indicator">⏰</span>` : '';
        const title = fav.highlightedTitle || escapeHtml(fav.title);
        const url = fav.highlightedUrl || escapeHtml(fav.url);

        itemEl.innerHTML = `
            ${reminderIcon}
            <div class="drag-handle" title="Kéo để thay đổi vị trí" style="${favoritesToRender !== null ? 'display:none' : ''}">⋮⋮</div>
            <div class="favorite-content">
                <div class="favorite-info">
                    <a href="${escapeHtml(fav.url)}" class="favorite-link" target="_blank" title="${escapeHtml(fav.url)}">
                        <div class="favorite-title">${title}</div>
                        <div class="favorite-url">${url}</div>
                    </a>
                    <div class="favorite-category">${escapeHtml(translateCategory(fav.category))}</div>
                </div>
                <div class="favorite-actions">
                    <button class="action-btn note-btn ${fav.note ? 'has-note' : ''}" title="${fav.note ? 'Chỉnh sửa' : 'Thêm ghi chú'}" data-action="note">📝</button>
                    <button class="action-btn delete-btn" title="Xóa" data-action="delete">🗑️</button>
                    <button class="action-btn preview-btn" title="Xem trước" data-action="preview">👀</button>
                </div>
            </div>
            ${fav.note ? `<div class="favorite-note">${escapeHtml(fav.note)}</div>` : ''}
            <div class="favorite-date">${formatDate(fav.dateAdded)}</div>
        `;

        if (favoritesToRender === null) {
            addDragListeners(itemEl, index);
        } else {
            itemEl.style.cursor = 'default';
        }

        fragment.appendChild(itemEl);
    });

    listEl.innerHTML = '';
    listEl.appendChild(fragment);
}

// Thêm event delegation cho các hành động trong danh sách
document.getElementById('favoritesList').addEventListener('click', (e) => {
    const btn = e.target.closest('.action-btn');
    if (!btn) return;

    const item = btn.closest('.favorite-item');
    const id = item.dataset.id;
    const fav = favorites.find(f => f.id === id);
    const action = btn.dataset.action;

    e.stopPropagation();

    if (action === 'note') showNoteModal(id, fav);
    else if (action === 'delete') showDeleteModal(id, fav.title);
    else if (action === 'preview') showPreviewModal(id, fav.screenshot);
});

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

function showNoteModal(id, fav) {
    currentNoteItemId = id;
    if (!fav) {
        showStatus("Không tìm thấy mục yêu thích!", "error");
        return;
    }
    updateCategoryOptions();
    document.getElementById('noteInput').value = fav.note || '';
    document.getElementById('titleInput').value = fav.title || '';
    document.getElementById('enableReminder').checked = !!fav.reminderTime;
    const reminderOptions = document.getElementById('reminderOptions');
    if (fav.reminderTime) {
        reminderOptions.style.display = 'block';
        reminderOptions.classList.add('show');
        const date = new Date(fav.reminderTime);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        document.getElementById('reminderTime').value = `${year}-${month}-${day}T${hours}:${minutes}`;
    } else {
        reminderOptions.style.display = 'none';
        reminderOptions.classList.remove('show');
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

async function showFullscreenPreview(screenshot) {
    if (!currentTab || !screenshot) {
        showStatus("Không thể hiển thị xem trước toàn màn hình!", "error");
        return;
    }

    chrome.scripting.insertCSS({
        target: { tabId: currentTab.id },
        files: ['fullscreen.css']
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

                let scale = 1;
                const minScale = 0.5;
                const maxScale = 5;
                let translateX = 0;
                let translateY = 0;
                let isDragging = false;
                let startX, startY, initialX, initialY;

                img.addEventListener('wheel', (e) => {
                    e.preventDefault();
                    const delta = e.deltaY > 0 ? -0.1 : 0.1;
                    scale = Math.max(minScale, Math.min(maxScale, scale + delta));
                    img.style.transform = 'scale(' + scale + ') translate(' + translateX + 'px, ' + translateY + 'px)';
                });

                img.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    isDragging = true;
                    img.classList.add('dragging');
                    startX = e.clientX;
                    startY = e.clientY;
                    initialX = translateX;
                    initialY = translateY;
                    document.body.style.userSelect = 'none';
                });

                document.addEventListener('mousemove', (e) => {
                    if (!isDragging) return;
                    e.preventDefault();
                    const dx = e.clientX - startX;
                    const dy = e.clientY - startY;
                    translateX = initialX + dx / scale;
                    translateY = initialY + dy / scale;
                    img.style.transform = 'scale(' + scale + ') translate(' + translateX + 'px, ' + translateY + 'px)';
                });

                document.addEventListener('mouseup', () => {
                    if (!isDragging) return;
                    isDragging = false;
                    img.classList.remove('dragging');
                    document.body.style.userSelect = '';
                });

                const closeBtn = document.createElement('button');
                closeBtn.className = 'fullscreen-close-btn';
                closeBtn.innerHTML = '✕';
                closeBtn.onclick = () => overlay.remove();
                overlay.appendChild(img);
                overlay.appendChild(closeBtn);
                document.body.appendChild(overlay);
                document.body.style.overflow = 'hidden';
                overlay.onclick = (e) => {
                    if (e.target === overlay) {
                        overlay.remove();
                        document.body.style.overflow = '';
                    }
                };
                closeBtn.onclick = () => {
                    overlay.remove();
                    document.body.style.overflow = '';
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
    const newTitle = document.getElementById('titleInput').value.trim() || favorites.find(f => f.id === currentNoteItemId)?.title;
    const reminderEnabled = document.getElementById('enableReminder').checked;
    const reminderTimeInput = document.getElementById('reminderTime').value;
    const reminderTime = reminderEnabled && reminderTimeInput ? new Date(reminderTimeInput).toISOString() : null;
    const repeatType = reminderEnabled ? document.getElementById('repeatType').value : 'none';
    const category = document.getElementById('categoryInput').value;
    const index = favorites.findIndex(f => f.id === currentNoteItemId);
    if (index !== -1) {
        favorites[index].note = newNote;
        favorites[index].title = newTitle;
        favorites[index].reminderTime = reminderTime;
        favorites[index].repeatType = repeatType;
        favorites[index].category = category;
        try {
            await updateFavorite(favorites[index]);
            if (!reminderEnabled) {
                // Xóa thông báo nếu bỏ chọn nhắc nhở
                chrome.notifications.clear(favorites[index].id, (wasCleared) => {
                    if (!wasCleared) {
                        console.warn(`Không thể xóa thông báo cho ID: ${favorites[index].id}`);
                    }
                });
            }
            renderFavorites();
            showStatus("Đã lưu ghi chú!");
        } catch (e) {
            console.error("Note update error:", e);
            showStatus("Lỗi khi lưu ghi chú!", "error");
        }
    }
    hideNoteModal();
}

function highlightText(text, searchTerm) {
    if (!searchTerm) return escapeHtml(text);
    const escapedText = escapeHtml(text);
    const regex = new RegExp(`(${escapeHtml(searchTerm)})`, 'gi');
    return escapedText.replace(regex, '<span class="search-highlight">$1</span>');
}

function updateDomainFilter() {
    const domainFilter = document.getElementById('domainFilter');
    if (!domainFilter) return;

    const domains = [...new Set(favorites.map(fav => {
        try {
            return new URL(fav.url).hostname;
        } catch (e) {
            return '';
        }
    }).filter(d => d !== ''))].sort();

    const currentValue = domainFilter.value;
    domainFilter.innerHTML = '<option value="all">Tất cả domain</option>' +
        domains.map(d => `<option value="${d}">${d}</option>`).join('');

    if (currentValue !== 'all' && domains.includes(currentValue)) {
        domainFilter.value = currentValue;
    } else {
        domainFilter.value = 'all';
    }
}

function filterFavorites(searchTerm) {
    const categoryFilter = document.getElementById('categoryFilter').value;
    const domainFilter = document.getElementById('domainFilter').value;

    if (!searchTerm.trim() && categoryFilter === 'all' && domainFilter === 'all') {
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

        let domainMatch = true;
        if (domainFilter !== 'all') {
            try {
                domainMatch = new URL(fav.url).hostname === domainFilter;
            } catch (e) {
                domainMatch = false;
            }
        }

        return searchMatch && categoryMatch && domainMatch;
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

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function init() {
    updateSyncUI();
    try {
        const permissionGranted = await chrome.permissions.contains({
            permissions: ['notifications']
        });
        if (!permissionGranted) {
            showStatus('Vui lòng cấp quyền thông báo để sử dụng nhắc nhở!', 'error');
        }
        const storageData = await chrome.storage.local.get('customCategories');
        customCategories = JSON.parse(storageData.customCategories || '[]');
        updateCategoryOptions();
        currentTab = await getCurrentTab();
        if (currentTab) {
            document.getElementById('currentUrl').textContent = currentTab.url;
            favorites = await getAllFavorites();
            updateAddButtonState();
            updateDomainFilter();
            renderFavorites();
            document.getElementById('exportBtn').addEventListener('click', exportFavorites);
            document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
            document.getElementById('importFile').addEventListener('change', importFavorites);
            document.getElementById('categoryFilter').addEventListener('change', () => {
                filterFavorites(document.getElementById('searchInput').value);
            });
            document.getElementById('domainFilter').addEventListener('change', () => {
                filterFavorites(document.getElementById('searchInput').value);
            });
            document.getElementById('addCategoryBtn').addEventListener('click', async () => {
                const newCategoryInput = document.getElementById('newCategoryInput');
                const newCategory = newCategoryInput.value.trim();
                if (!newCategory || customCategories.includes(newCategory) || ['Uncategorized', 'Work', 'Study', 'Entertainment', 'Other'].includes(newCategory)) {
                    showStatus('Danh mục không hợp lệ hoặc đã tồn tại!', 'error');
                    return;
                }
                customCategories.push(newCategory);
                await chrome.storage.local.set({ customCategories: JSON.stringify(customCategories) });
                updateCategoryOptions();
                renderCategoriesList();
                newCategoryInput.value = '';
                showStatus('Đã thêm danh mục mới!');
            });
            document.getElementById('manageCategoriesBtn').addEventListener('click', showManageCategoriesModal);
            document.getElementById('closeManageCategoriesBtn').addEventListener('click', hideManageCategoriesModal);
            document.getElementById('manageCategoriesModal').addEventListener('click', (e) => {
                if (e.target.id === 'manageCategoriesModal') hideManageCategoriesModal();
            });

            // Drive Sync Modal
            document.getElementById('openDriveSyncBtn').addEventListener('click', showDriveSyncModal);
            document.getElementById('closeDriveSyncBtn').addEventListener('click', hideDriveSyncModal);
            document.getElementById('driveSyncModal').addEventListener('click', (e) => {
                if (e.target.id === 'driveSyncModal') hideDriveSyncModal();
            });

            // Import/Export Modal
            document.getElementById('openImportExportBtn').addEventListener('click', showImportExportModal);
            document.getElementById('closeImportExportBtn').addEventListener('click', hideImportExportModal);
            document.getElementById('importExportModal').addEventListener('click', (e) => {
                if (e.target.id === 'importExportModal') hideImportExportModal();
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

    document.getElementById('cancelDeleteCategoryBtn').addEventListener('click', hideDeleteCategoryModal);
    document.getElementById('confirmDeleteCategoryBtn').addEventListener('click', confirmDeleteCategory);
    document.getElementById('deleteCategoryModal').addEventListener('click', (e) => {
        if (e.target.id === 'deleteCategoryModal') hideDeleteCategoryModal();
    });

    // Google Drive event listeners
    document.getElementById('loginGDriveBtn').addEventListener('click', async () => {
        try {
            await gDrive.getAuthToken(true);
            await updateSyncUI();
            showStatus('Kết nối Google Drive thành công!');
        } catch (err) {
            showStatus('Lỗi kết nối Google Drive', 'error');
        }
    });
    document.getElementById('backupGDriveBtn').addEventListener('click', handleGDriveBackup);
    document.getElementById('restoreGDriveBtn').addEventListener('click', handleGDriveRestore);
    document.getElementById('logoutGDriveBtn').addEventListener('click', handleGDriveLogout);
    document.getElementById('deleteGDriveDataBtn').addEventListener('click', handleGDriveDelete);

    document.getElementById('enableAutoBackup').addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        await chrome.storage.local.set({ autoBackup: enabled });
        if (enabled) {
            showStatus('Đã bật tự động sao lưu!');
            // Kích hoạt alarm ngay lập tức qua background
            chrome.runtime.sendMessage({ action: 'startAutoBackupAlarm' });
        } else {
            showStatus('Đã tắt tự động sao lưu');
        }
    });
});

function updateCategoryOptions() {
    const categoryInput = document.getElementById('categoryInput');
    const categoryFilter = document.getElementById('categoryFilter');
    const customCategoriesGroup = document.getElementById('customCategories');

    categoryInput.innerHTML = `
          <option value="Uncategorized">Chưa phân loại</option>
          <option value="Work">Công việc</option>
          <option value="Study">Học tập</option>
          <option value="Entertainment">Giải trí</option>
          <option value="Other">Khác</option>
          ${customCategories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('')}
      `;

    customCategoriesGroup.innerHTML = customCategories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('');
}

function showManageCategoriesModal() {
    renderCategoriesList();
    document.getElementById('manageCategoriesModal').classList.add('show');
}

function hideManageCategoriesModal() {
    document.getElementById('manageCategoriesModal').classList.remove('show');
}

function showDriveSyncModal() {
    document.getElementById('driveSyncModal').classList.add('show');
}

function hideDriveSyncModal() {
    document.getElementById('driveSyncModal').classList.remove('show');
}

function showImportExportModal() {
    document.getElementById('importExportModal').classList.add('show');
}

function hideImportExportModal() {
    document.getElementById('importExportModal').classList.remove('show');
}

function renderCategoriesList() {
    const listEl = document.getElementById('customCategoriesList');
    const noCategoriesMessage = document.getElementById('noCategoriesMessage');
    if (customCategories.length === 0) {
        listEl.innerHTML = '';
        noCategoriesMessage.style.display = 'block';
        return;
    }
    noCategoriesMessage.style.display = 'none';
    // Tạo một đối tượng để đếm số URL cho mỗi danh mục
    const categoryCounts = {};
    const predefinedCategories = ['Uncategorized', 'Work', 'Study', 'Entertainment', 'Other'];
    // Khởi tạo số đếm cho các danh mục mặc định
    predefinedCategories.forEach(cat => {
        categoryCounts[cat] = favorites.filter(fav => fav.category === cat).length;
    });
    // Đếm số URL cho các danh mục tùy chỉnh
    customCategories.forEach(cat => {
        categoryCounts[cat] = favorites.filter(fav => fav.category === cat).length;
    });
    // Hiển thị danh sách danh mục tùy chỉnh với số lượng URL
    listEl.innerHTML = customCategories.map((cat, index) => `
        <div class="category-item">
            <input type="text" value="${escapeHtml(cat)}" data-index="${index}" class="category-name-input" />
            <span class="category-count">(${categoryCounts[cat]})</span>
            <button class="rename-btn" title="Đổi tên" data-index="${index}">✏️</button>
            <button class="delete-category-btn" title="Xóa" data-index="${index}">🗑️</button>
        </div>
    `).join('');
    document.querySelectorAll('.rename-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            const input = e.target.parentElement.querySelector('.category-name-input');
            renameCategory(index, input.value.trim());
        });
    });
    document.querySelectorAll('.delete-category-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            showDeleteCategoryModal(index, customCategories[index]);
        });
    });
}

async function renameCategory(index, newName) {
    if (!newName || customCategories.includes(newName) || ['Uncategorized', 'Work', 'Study', 'Entertainment', 'Other'].includes(newName)) {
        showStatus('Tên danh mục không hợp lệ hoặc đã tồn tại!', 'error');
        return;
    }
    const oldName = customCategories[index];
    customCategories[index] = newName;
    await chrome.storage.local.set({ customCategories: JSON.stringify(customCategories) });
    try {
        const db = await openDB();
        const tx = db.transaction('favorites', 'readwrite');
        const store = tx.objectStore('favorites');
        const request = store.getAll();
        request.onsuccess = async () => {
            const favoritesToUpdate = request.result.filter(fav => fav.category === oldName);
            for (const fav of favoritesToUpdate) {
                fav.category = newName;
                await store.put(fav);
            }
            await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
            favorites = await getAllFavorites();
            updateCategoryOptions();
            renderFavorites();
            renderCategoriesList();
            showStatus('Đã đổi tên danh mục!');
        };
    } catch (err) {
        console.error('Rename category error:', err);
        showStatus('Lỗi khi đổi tên danh mục!', 'error');
    }
}

async function deleteCategory(index) {
    const category = customCategories[index];
    customCategories.splice(index, 1);
    await chrome.storage.local.set({ customCategories: JSON.stringify(customCategories) });
    try {
        const db = await openDB();
        const tx = db.transaction('favorites', 'readwrite');
        const store = tx.objectStore('favorites');
        const request = store.getAll();
        request.onsuccess = async () => {
            const favoritesToUpdate = request.result.filter(fav => fav.category === category);
            for (const fav of favoritesToUpdate) {
                fav.category = 'Uncategorized';
                await store.put(fav);
            }
            await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
            favorites = await getAllFavorites();
            updateCategoryOptions();
            renderFavorites();
            renderCategoriesList();
            showStatus('Đã xóa danh mục!');
        };
    } catch (err) {
        console.error('Delete category error:', err);
        showStatus('Lỗi khi xóa danh mục!', 'error');
    }
}

function showDeleteCategoryModal(index, category) {
    deleteCategoryIndex = index;
    document.getElementById('deleteCategoryName').textContent = category;
    document.getElementById('deleteCategoryModal').classList.add('show');
}

function hideDeleteCategoryModal() {
    document.getElementById('deleteCategoryModal').classList.remove('show');
    deleteCategoryIndex = null;
}

function confirmDeleteCategory() {
    if (deleteCategoryIndex !== null) {
        deleteCategory(deleteCategoryIndex);
        hideDeleteCategoryModal();
    }
}

async function exportFavorites() {
    try {
        const favorites = await getAllFavorites();
        const dataStr = JSON.stringify(favorites, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `favorites_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showStatus('Đã xuất danh sách thành công!');
    } catch (err) {
        console.error('Export error:', err);
        showStatus('Lỗi khi xuất danh sách!', 'error');
    }
}

async function importFavorites(event) {
    try {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const importedFavorites = JSON.parse(e.target.result);
                if (!Array.isArray(importedFavorites)) throw new Error('Dữ liệu không hợp lệ');
                const db = await openDB();
                const tx = db.transaction('favorites', 'readwrite');
                const store = tx.objectStore('favorites');
                for (const fav of importedFavorites) {
                    if (fav.id && fav.url) {
                        await store.put(fav);
                    }
                }
                await new Promise((resolve, reject) => {
                    tx.oncomplete = resolve;
                    tx.onerror = () => reject(tx.error);
                });
                favorites = await getAllFavorites();
                updateDomainFilter();
                renderFavorites();
                updateAddButtonState();
                showStatus('Đã nhập danh sách thành công!');
            } catch (err) {
                console.error('Import error:', err);
                showStatus('Lỗi khi nhập danh sách!', 'error');
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    } catch (err) {
        console.error('Import error:', err);
        showStatus('Lỗi khi nhập danh sách!', 'error');
    }
}

/* Google Drive Sync Logic */
async function updateSyncUI() {
    const syncStatus = document.getElementById('syncStatus');
    const loginBtn = document.getElementById('loginGDriveBtn');
    const syncButtons = document.getElementById('syncButtons');
    const deleteDataBtn = document.getElementById('deleteGDriveDataBtn');

    if (!syncStatus || !loginBtn || !syncButtons) return;

    try {
        const token = await gDrive.getAuthToken(false);
        if (token) {
            syncStatus.textContent = 'Đã kết nối Google Drive';
            syncStatus.style.color = '#2ecc71';
            syncStatus.style.background = 'rgba(46, 204, 113, 0.1)';
            loginBtn.style.display = 'none';
            syncButtons.style.display = 'flex';
            if (deleteDataBtn) deleteDataBtn.style.display = 'flex';

            const autoBackupOptions = document.getElementById('autoBackupOptions');
            if (autoBackupOptions) {
                autoBackupOptions.style.display = 'block';
                const { autoBackup } = await chrome.storage.local.get('autoBackup');
                document.getElementById('enableAutoBackup').checked = !!autoBackup;
            }
        } else {
            throw new Error('No token');
        }
    } catch (err) {
        syncStatus.textContent = 'Chưa kết nối Google Drive';
        syncStatus.style.color = '#4facfe';
        syncStatus.style.background = 'rgba(79, 172, 254, 0.1)';
        loginBtn.style.display = 'block';
        syncButtons.style.display = 'none';
        if (deleteDataBtn) deleteDataBtn.style.display = 'none';

        const autoBackupOptions = document.getElementById('autoBackupOptions');
        if (autoBackupOptions) {
            autoBackupOptions.style.display = 'none';
        }
    }
}

async function handleGDriveBackup() {
    const backupBtn = document.getElementById('backupGDriveBtn');
    const originalText = backupBtn.textContent;
    backupBtn.disabled = true;
    backupBtn.innerHTML = 'Đang sao lưu...';

    try {
        const favorites = await getAllFavorites();
        const storageData = await chrome.storage.local.get('customCategories');
        const customCategories = JSON.parse(storageData.customCategories || '[]');
        const dataToBackup = {
            favorites,
            customCategories,
            lastSynced: new Date().toISOString()
        };
        await gDrive.saveBackup(dataToBackup);
        showStatus('Đã sao lưu lên Google Drive thành công!');
    } catch (err) {
        console.error('Backup error:', err);
        showStatus('Lỗi khi sao lưu: ' + (err.message || 'Không xách định'), 'error');
    } finally {
        backupBtn.disabled = false;
        backupBtn.textContent = originalText;
    }
}

async function handleGDriveRestore() {
    const restoreBtn = document.getElementById('restoreGDriveBtn');
    const originalText = restoreBtn.textContent;
    restoreBtn.disabled = true;
    restoreBtn.innerHTML = 'Đang khôi phục...';

    try {
        const data = await gDrive.loadBackup();
        if (!data) {
            showStatus('Không tìm thấy bản sao lưu trên Google Drive!', 'error');
            return;
        }

        if (confirm('Dữ liệu hiện tại sẽ bị ghi đè bởi bản sao lưu. Bạn có chắc chắn muốn tiếp tục?')) {
            const db = await openDB();
            const tx = db.transaction('favorites', 'readwrite');
            const store = tx.objectStore('favorites');

            await new Promise((resolve, reject) => {
                const clearRequest = store.clear();
                clearRequest.onsuccess = resolve;
                clearRequest.onerror = () => reject(clearRequest.error);
            });

            for (const fav of data.favorites) {
                await new Promise((resolve, reject) => {
                    const putRequest = store.put(fav);
                    putRequest.onsuccess = resolve;
                    putRequest.onerror = () => reject(putRequest.error);
                });
            }

            await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });

            if (data.customCategories) {
                await chrome.storage.local.set({ customCategories: JSON.stringify(data.customCategories) });
                customCategories = data.customCategories;
            }

            favorites = await getAllFavorites();
            updateCategoryOptions();
            updateDomainFilter();
            renderFavorites();

            showStatus('Đã khôi phục dữ liệu từ Google Drive thành công!');
        }
    } catch (err) {
        console.error('Restore error:', err);
        showStatus('Lỗi khi khôi phục: ' + (err.message || 'Không xác định'), 'error');
    } finally {
        restoreBtn.disabled = false;
        restoreBtn.textContent = originalText;
    }
}

async function handleGDriveLogout() {
    if (confirm('Bạn có chắc chắn muốn đăng xuất khỏi Google Drive?')) {
        try {
            await gDrive.logout();
            await updateSyncUI();
            showStatus('Đã đăng xuất khỏi Google Drive');
        } catch (err) {
            console.error('Logout error:', err);
            showStatus('Lỗi khi đăng xuất', 'error');
        }
    }
}

async function handleGDriveDelete() {
    // Panel xác thực đầy đủ trước khi xóa
    const confirmation = confirm('CẢNH BÁO: Bạn có chắc chắn muốn xóa vĩnh viễn tệp sao lưu trên Google Drive?\n\nHành động này không thể hoàn tác và dữ liệu đám mây của bạn sẽ bị mất hoàn toàn.');

    if (confirmation) {
        const secondConfirmation = confirm('Xác nhận lần cuối: Bạn thực sự muốn xóa dữ liệu trên Drive chứ?');

        if (secondConfirmation) {
            try {
                const deleteBtn = document.getElementById('deleteGDriveDataBtn');
                deleteBtn.disabled = true;
                deleteBtn.style.opacity = '0.3';

                await gDrive.deleteBackup();
                showStatus('Đã xóa dữ liệu trên Google Drive thành công!');
            } catch (err) {
                console.error('Delete error:', err);
                showStatus('Lỗi khi xóa dữ liệu trên Drive: ' + (err.message || 'Không xác định'), 'error');
            } finally {
                const deleteBtn = document.getElementById('deleteGDriveDataBtn');
                deleteBtn.disabled = false;
                deleteBtn.style.opacity = '';
            }
        }
    }
}
