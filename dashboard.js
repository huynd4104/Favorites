"use strict";

let favorites = [];
let filteredFavorites = [];
let customCategories = [];
let selectedIds = new Set();
let isBulkMode = false;
let currentNoteItemId = null;
let deleteItemId = null;

// IndexedDB Logic (Same as popup.js)
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
            results.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || new Date(b.dateAdded) - new Date(a.dateAdded));
            resolve(results);
        };
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

function notifyReminderUpdated(fav) {
    chrome.runtime.sendMessage({ action: 'reminderUpdated', favorite: fav });
}

// Add these variables at the top
let currentScale = 1;
let isDragging = false;
let startX, startY, translateX = 0, translateY = 0;
let deleteCategoryIndex = null;

// UI Logic
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

function escapeHtml(unsafe) {
    if (!unsafe) return "";
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderFavorites(dataToRender = null) {
    const listEl = document.getElementById('favoritesList');
    const displayData = dataToRender || favorites;

    if (displayData.length === 0) {
        listEl.innerHTML = `
            <div class="loading-state">
                <p>📭 Không có dữ liệu nào phù hợp</p>
            </div>`;
        updateStats();
        return;
    }

    const fragment = document.createDocumentFragment();
    displayData.forEach(fav => {
        const itemEl = document.createElement('div');
        itemEl.className = `dashboard-item ${isBulkMode ? 'selectable' : ''} ${selectedIds.has(fav.id) ? 'selected' : ''}`;
        itemEl.dataset.id = fav.id;

        const thumbnail = fav.screenshot ? `<img src="${fav.screenshot}" alt="${escapeHtml(fav.title)}">` : `<div class="placeholder-img">🖼️</div>`;

        itemEl.innerHTML = `
            <button class="hover-delete-btn" title="Xóa nhanh">✕</button>
            <div class="item-thumbnail">
                ${thumbnail}
                <div class="thumbnail-overlay">
                    <button class="action-btn preview-btn" data-id="${fav.id}">👀</button>
                </div>
            </div>
            <div class="item-info">
                <a href="${escapeHtml(fav.url)}" target="_blank" class="item-link-wrapper">
                    <div class="item-title" title="${escapeHtml(fav.title)}">${fav.highlightedTitle || escapeHtml(fav.title)}</div>
                    <div class="item-url" title="${escapeHtml(fav.url)}">${fav.highlightedUrl || escapeHtml(fav.url)}</div>
                </a>
                ${fav.note ? `<div class="item-note-preview">${escapeHtml(fav.note)}</div>` : ''}
            </div>
            <div class="item-meta">
                <div class="item-category">${translateCategory(fav.category)}</div>
                <div class="item-actions">
                    <button class="action-btn note-btn" data-id="${fav.id}" title="Ghi chú">📝</button>
                    <button class="action-btn delete-btn" data-id="${fav.id}" title="Xóa">🗑️</button>
                </div>
            </div>
        `;

        itemEl.addEventListener('click', (e) => {
            if (isBulkMode) {
                // In bulk mode, clicking the item toggles selection
                // Prevent toggling if clicking the link, preview, or note buttons
                if (!e.target.closest('.item-link-wrapper') && !e.target.closest('.action-btn') && !e.target.closest('.hover-delete-btn')) {
                    toggleSelection(fav.id);
                }
            }
        });

        const hoverDeleteBtn = itemEl.querySelector('.hover-delete-btn');
        hoverDeleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteFavorite(fav.id);
        });

        fragment.appendChild(itemEl);
    });

    listEl.innerHTML = '';
    listEl.appendChild(fragment);
    updateStats();
}

function toggleSelection(id) {
    if (selectedIds.has(id)) {
        selectedIds.delete(id);
    } else {
        selectedIds.add(id);
    }
    updateBulkUI();
    renderFavorites(filteredFavorites.length > 0 || document.getElementById('searchInput').value ? filteredFavorites : null);
}

function updateBulkUI() {
    const selectedCountEl = document.getElementById('selectedCount');
    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');

    selectedCountEl.textContent = selectedIds.size;
    if (selectedIds.size > 0 && isBulkMode) {
        bulkDeleteBtn.style.display = 'flex';
    } else {
        bulkDeleteBtn.style.display = 'none';
    }
}

function toggleBulkMode() {
    isBulkMode = !isBulkMode;
    const bulkActionBtn = document.getElementById('bulkActionBtn');
    const mainList = document.getElementById('favoritesList');

    if (isBulkMode) {
        bulkActionBtn.classList.add('active');
        bulkActionBtn.innerHTML = 'Xong';
        mainList.classList.add('bulk-mode');
    } else {
        bulkActionBtn.classList.remove('active');
        bulkActionBtn.innerHTML = '<span class="icon">🔘</span> Chọn';
        mainList.classList.remove('bulk-mode');
        selectedIds.clear();
        updateBulkUI();
    }
    renderFavorites(filteredFavorites.length > 0 || document.getElementById('searchInput').value ? filteredFavorites : null);
}

async function deleteFavorite(id) {
    try {
        await deleteFavoriteById(id);
        favorites = favorites.filter(f => f.id !== id);
        if (filteredFavorites.length > 0) {
            filteredFavorites = filteredFavorites.filter(f => f.id !== id);
        }
        selectedIds.delete(id);
        updateDomainFilter();
        renderFavorites(filteredFavorites.length > 0 || document.getElementById('searchInput').value ? filteredFavorites : null);
        showStatus("Đã xóa khỏi favorites!");
        updateBulkUI();
    } catch (err) {
        console.error('Delete error:', err);
        showStatus("Lỗi khi xóa favorite!", "error");
    }
}

async function bulkDelete() {
    const idsToDelete = Array.from(selectedIds);
    try {
        for (const id of idsToDelete) {
            await deleteFavoriteById(id);
        }
        favorites = favorites.filter(f => !selectedIds.has(f.id));
        if (filteredFavorites.length > 0) {
            filteredFavorites = filteredFavorites.filter(f => !selectedIds.has(f.id));
        }
        selectedIds.clear();
        updateDomainFilter();
        renderFavorites(filteredFavorites.length > 0 || document.getElementById('searchInput').value ? filteredFavorites : null);
        showStatus(`Đã xóa ${idsToDelete.length} mục!`);
        updateBulkUI();
        hideBulkDeleteModal();
    } catch (err) {
        console.error('Bulk delete error:', err);
        showStatus("Lỗi khi xóa hàng loạt!", "error");
    }
}

function updateStats() {
    document.getElementById('totalCount').textContent = favorites.length;
    const categories = new Set(favorites.map(f => f.category));
    document.getElementById('categoryCount').textContent = categories.size;
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

function highlightText(text, searchTerm) {
    if (!searchTerm) return escapeHtml(text);
    const escapedText = escapeHtml(text);
    const regex = new RegExp(`(${escapeHtml(searchTerm)})`, 'gi');
    return escapedText.replace(regex, '<span class="search-highlight">$1</span>');
}

function filterFavorites(searchTerm) {
    const categoryFilter = document.getElementById('categoryFilter').value;
    const domainFilter = document.getElementById('domainFilter').value;

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

    const searchInfo = document.getElementById('searchInfo');
    const clearBtn = document.getElementById('clearSearch');
    if (term) {
        searchInfo.style.display = 'block';
        searchInfo.textContent = `Tìm thấy ${filteredFavorites.length} kết quả`;
        clearBtn.style.display = 'block';
    } else {
        searchInfo.style.display = 'none';
        clearBtn.style.display = 'none';
    }

    renderFavorites(filteredFavorites);
}

// Modals
function showDeleteModal(id, title) {
    deleteItemId = id;
    document.getElementById('deleteItemTitle').textContent = title;
    document.getElementById('deleteModal').classList.add('show');
}

function hideDeleteModal() {
    document.getElementById('deleteModal').classList.remove('show');
    deleteItemId = null;
}

function showBulkDeleteModal() {
    document.getElementById('bulkDeleteCount').textContent = selectedIds.size;
    document.getElementById('bulkDeleteConfirmModal').classList.add('show');
}

function hideBulkDeleteModal() {
    document.getElementById('bulkDeleteConfirmModal').classList.remove('show');
}

function showNoteModal(id) {
    const fav = favorites.find(f => f.id === id);
    if (!fav) return;
    currentNoteItemId = id;
    document.getElementById('noteInput').value = fav.note || '';
    document.getElementById('titleInput').value = fav.title || '';
    document.getElementById('enableReminder').checked = !!fav.reminderTime;
    const reminderOptions = document.getElementById('reminderOptions');
    if (fav.reminderTime) {
        reminderOptions.style.display = 'block';
        const date = new Date(fav.reminderTime);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        document.getElementById('reminderTime').value = `${year}-${month}-${day}T${hours}:${minutes}`;
    } else {
        reminderOptions.style.display = 'none';
    }
    document.getElementById('repeatType').value = fav.repeatType || 'none';
    document.getElementById('categoryInput').value = fav.category || 'Uncategorized';
    document.getElementById('noteModal').classList.add('show');
}

function hideNoteModal() {
    document.getElementById('noteModal').classList.remove('show');
    currentNoteItemId = null;
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
            notifyReminderUpdated(favorites[index]);
            renderFavorites(filteredFavorites.length > 0 || document.getElementById('searchInput').value ? filteredFavorites : null);
            showStatus("Đã lưu ghi chú!");
        } catch (e) {
            console.error("Note update error:", e);
            showStatus("Lỗi khi lưu ghi chú!", "error");
        }
    }
    hideNoteModal();
}

function showPreviewModal(id) {
    const fav = favorites.find(f => f.id === id);
    const previewModal = document.getElementById('previewModal');
    const previewImage = document.getElementById('previewImage');
    const previewLoading = document.getElementById('previewLoading');
    const previewError = document.getElementById('previewError');

    currentScale = 1;
    translateX = 0;
    translateY = 0;
    updatePreviewTransform();

    previewImage.style.display = 'none';
    previewLoading.style.display = 'block';
    previewError.style.display = 'none';
    previewModal.style.display = 'flex';

    if (fav && fav.screenshot) {
        previewImage.src = fav.screenshot;
        previewImage.onload = () => {
            previewLoading.style.display = 'none';
            previewImage.style.display = 'block';
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

function updatePreviewTransform() {
    const img = document.getElementById('previewImage');
    if (img) {
        img.style.transform = `scale(${currentScale}) translate(${translateX}px, ${translateY}px)`;
    }
}

function showStatus(message, type = 'success', duration = 2500) {
    const statusModal = document.getElementById('statusModal');
    const statusEl = document.getElementById('statusMessage');
    if (!statusModal || !statusEl) return;
    statusEl.textContent = message;
    statusModal.className = `status-modal ${type} show`;
    if (window._statusTimeout) clearTimeout(window._statusTimeout);
    window._statusTimeout = setTimeout(() => {
        statusModal.classList.remove('show');
    }, duration);
}

// Initialization
async function init() {
    try {
        favorites = await getAllFavorites();
        const storageData = await chrome.storage.local.get('customCategories');
        customCategories = JSON.parse(storageData.customCategories || '[]');

        // Update Category Selects
        updateCategoryOptions();

        updateDomainFilter();
        renderFavorites();

        // New Event Listeners for Import/Export, Categories, Drive Sync
        document.getElementById('exportBtn').addEventListener('click', exportFavorites);
        document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
        document.getElementById('importFile').addEventListener('change', importFavorites);

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
            updateStats();
        });

        document.getElementById('manageCategoriesBtn').addEventListener('click', showManageCategoriesModal);
        document.getElementById('closeManageCategoriesBtn').addEventListener('click', hideManageCategoriesModal);
        document.getElementById('manageCategoriesModal').addEventListener('click', (e) => {
            if (e.target.id === 'manageCategoriesModal') hideManageCategoriesModal();
        });

        document.getElementById('openDriveSyncBtn').addEventListener('click', showDriveSyncModal);
        document.getElementById('closeDriveSyncBtn').addEventListener('click', hideDriveSyncModal);
        document.getElementById('driveSyncModal').addEventListener('click', (e) => {
            if (e.target.id === 'driveSyncModal') hideDriveSyncModal();
        });

        document.getElementById('openImportExportBtn').addEventListener('click', showImportExportModal);
        document.getElementById('closeImportExportBtn').addEventListener('click', hideImportExportModal);
        document.getElementById('importExportModal').addEventListener('click', (e) => {
            if (e.target.id === 'importExportModal') hideImportExportModal();
        });

        document.getElementById('cancelDeleteCategoryBtn').addEventListener('click', hideDeleteCategoryModal);
        document.getElementById('confirmDeleteCategoryBtn').addEventListener('click', confirmDeleteCategory);
        document.getElementById('deleteCategoryModal').addEventListener('click', (e) => {
            if (e.target.id === 'deleteCategoryModal') hideDeleteCategoryModal();
        });

        // Google Drive event listeners
        const extIdEl = document.getElementById('extIdDisplay');
        if (extIdEl) extIdEl.textContent = chrome.runtime.id;

        document.getElementById('loginGDriveBtn').addEventListener('click', async () => {
            const loginBtn = document.getElementById('loginGDriveBtn');
            const originalText = loginBtn.textContent;
            loginBtn.disabled = true;
            loginBtn.textContent = 'Đang kết nối...';
            showStatus('Đang kết nối tới Google Drive...', 'info', 2000);

            try {
                // Clear any stale cached token before interactive login attempt
                await gDrive.clearCachedToken();
                const token = await gDrive.getAuthToken(true);
                await updateSyncUI(token);
                showStatus('Kết nối Google Drive thành công!');
            } catch (err) {
                console.error('[GDrive] Login error:', err);
                const errMsg = err?.message || (typeof err === 'string' ? err : 'Lỗi kết nối Google Drive');
                showStatus(errMsg, 'error', 6000);
            } finally {
                loginBtn.disabled = false;
                loginBtn.textContent = originalText;
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
                checkAndTriggerBackup();
            } else {
                showStatus('Đã tắt tự động sao lưu');
            }
        });

        updateSyncUI();

        // Event Listeners
        document.getElementById('bulkActionBtn').addEventListener('click', toggleBulkMode);
        document.getElementById('bulkDeleteBtn').addEventListener('click', showBulkDeleteModal);
        document.getElementById('confirmBulkDeleteBtn').addEventListener('click', bulkDelete);
        document.getElementById('cancelBulkDeleteBtn').addEventListener('click', hideBulkDeleteModal);

        document.getElementById('searchInput').addEventListener('input', (e) => filterFavorites(e.target.value));
        document.getElementById('clearSearch').addEventListener('click', () => {
            document.getElementById('searchInput').value = '';
            filterFavorites('');
        });

        document.getElementById('categoryFilter').addEventListener('change', () => filterFavorites(document.getElementById('searchInput').value));
        document.getElementById('domainFilter').addEventListener('change', () => filterFavorites(document.getElementById('searchInput').value));

        document.getElementById('favoritesList').addEventListener('click', (e) => {
            const btn = e.target.closest('.action-btn');
            if (!btn) return;
            const id = btn.dataset.id;
            const action = btn.classList.contains('note-btn') ? 'note' :
                btn.classList.contains('delete-btn') ? 'delete' :
                    btn.classList.contains('preview-btn') ? 'preview' : '';

            if (action === 'note') showNoteModal(id);
            if (action === 'delete') {
                const fav = favorites.find(f => f.id === id);
                showDeleteModal(id, fav.title);
            }
            if (action === 'preview') showPreviewModal(id);
        });

        document.getElementById('confirmBtn').addEventListener('click', () => {
            if (deleteItemId) deleteFavorite(deleteItemId);
            hideDeleteModal();
        });
        document.getElementById('cancelBtn').addEventListener('click', hideDeleteModal);

        document.getElementById('saveNoteBtn').addEventListener('click', saveNote);
        document.getElementById('cancelNoteBtn').addEventListener('click', hideNoteModal);

        // Preview Modal Interaction
        const previewModal = document.getElementById('previewModal');
        const previewImage = document.getElementById('previewImage');

        document.getElementById('closePreviewBtn').addEventListener('click', () => {
            previewModal.style.display = 'none';
        });

        document.getElementById('zoomInBtn').addEventListener('click', () => {
            currentScale = Math.min(5, currentScale + 0.2);
            updatePreviewTransform();
        });

        document.getElementById('zoomOutBtn').addEventListener('click', () => {
            currentScale = Math.max(0.5, currentScale - 0.2);
            updatePreviewTransform();
        });

        document.getElementById('resetZoomBtn').addEventListener('click', () => {
            currentScale = 1;
            translateX = 0;
            translateY = 0;
            updatePreviewTransform();
        });

        previewImage.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            previewImage.classList.add('dragging');
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            translateX += dx / currentScale;
            translateY += dy / currentScale;
            startX = e.clientX;
            startY = e.clientY;
            updatePreviewTransform();
        });

        window.addEventListener('mouseup', () => {
            isDragging = false;
            previewImage.classList.remove('dragging');
        });

        previewImage.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            currentScale = Math.max(0.5, Math.min(5, currentScale + delta));
            updatePreviewTransform();
        }, { passive: false });

        document.getElementById('enableReminder').addEventListener('change', (e) => {
            document.getElementById('reminderOptions').style.display = e.target.checked ? 'block' : 'none';
        });

    } catch (err) {
        console.error('Init error:', err);
        showStatus('Lỗi tải dữ liệu!', 'error');
    }
}

document.addEventListener('DOMContentLoaded', init);

// New features functions
async function checkAndTriggerBackup() {
    const { autoBackup } = await chrome.storage.local.get('autoBackup');
    if (autoBackup) {
        chrome.runtime.sendMessage({ action: 'triggerAutoBackup' });
    }
}

function updateCategoryOptions() {
    const customGroup = document.getElementById('customCategories');
    const categoryInput = document.getElementById('categoryInput');
    const categoryFilter = document.getElementById('categoryFilter'); // added for completeness but logic handles customGroup

    if (customGroup) customGroup.innerHTML = customCategories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    
    if (categoryInput) {
        const baseOptions = `
            <option value="Uncategorized">Chưa phân loại</option>
            <option value="Work">Công việc</option>
            <option value="Study">Học tập</option>
            <option value="Entertainment">Giải trí</option>
            <option value="Other">Khác</option>
        `;
        categoryInput.innerHTML = baseOptions + customCategories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    }
}

function showManageCategoriesModal() {
    renderCategoriesList();
    document.getElementById('manageCategoriesModal').classList.add('show');
}

function hideManageCategoriesModal() {
    document.getElementById('manageCategoriesModal').classList.remove('show');
}

function showDriveSyncModal() {
    const extIdEl = document.getElementById('extIdDisplay');
    if (extIdEl) extIdEl.textContent = chrome.runtime.id;
    updateSyncUI();
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
    const categoryCounts = {};
    const predefinedCategories = ['Uncategorized', 'Work', 'Study', 'Entertainment', 'Other'];
    predefinedCategories.forEach(cat => {
        categoryCounts[cat] = favorites.filter(fav => fav.category === cat).length;
    });
    customCategories.forEach(cat => {
        categoryCounts[cat] = favorites.filter(fav => fav.category === cat).length;
    });
    listEl.innerHTML = customCategories.map((cat, index) => `
        <div class="category-item" style="display:flex; justify-content:space-between; align-items:center; padding:5px 0;">
            <input type="text" value="${escapeHtml(cat)}" data-index="${index}" class="category-name-input" style="flex-grow:1; margin-right:10px; padding:5px; border-radius:4px; border:1px solid #ddd;"/>
            <span class="category-count" style="margin-right:10px;">(${categoryCounts[cat]})</span>
            <button class="rename-btn" title="Đổi tên" data-index="${index}" style="margin-right:5px; background:none; border:none; cursor:pointer;">✏️</button>
            <button class="delete-category-btn" title="Xóa" data-index="${index}" style="background:none; border:none; cursor:pointer;">🗑️</button>
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
            renderFavorites(filteredFavorites.length > 0 || document.getElementById('searchInput').value ? filteredFavorites : null);
            renderCategoriesList();
            updateStats();
            showStatus('Đã đổi tên danh mục!');
            checkAndTriggerBackup();
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
            renderFavorites(filteredFavorites.length > 0 || document.getElementById('searchInput').value ? filteredFavorites : null);
            renderCategoriesList();
            updateStats();
            showStatus('Đã xóa danh mục!');
            checkAndTriggerBackup();
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
        const favoritesData = await getAllFavorites();
        const dataStr = JSON.stringify(favoritesData, null, 2);
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
                updateStats();
                showStatus('Đã nhập danh sách thành công!');
                checkAndTriggerBackup();
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

async function updateSyncUI(existingToken = null) {
    const syncStatus = document.getElementById('syncStatus');
    const loginBtn = document.getElementById('loginGDriveBtn');
    const syncButtons = document.getElementById('syncButtons');
    const deleteDataBtn = document.getElementById('deleteGDriveDataBtn');
    const userContainer = document.getElementById('gdriveUserContainer');
    const gdriveAvatar = document.getElementById('gdriveAvatar');
    const gdriveName = document.getElementById('gdriveName');
    const gdriveEmail = document.getElementById('gdriveEmail');
    const extIdEl = document.getElementById('extIdDisplay');

    if (extIdEl) extIdEl.textContent = chrome.runtime.id;
    if (!syncStatus || !loginBtn || !syncButtons) return;

    try {
        const token = existingToken || await gDrive.getAuthToken(false);
        if (token) {
            syncStatus.textContent = 'Đã kết nối Google Drive';
            syncStatus.style.color = '#2ecc71';
            syncStatus.style.background = 'rgba(46, 204, 113, 0.1)';
            loginBtn.style.display = 'none';
            syncButtons.style.display = 'flex';
            if (deleteDataBtn) deleteDataBtn.style.display = 'flex';

            // Show user profile info
            if (userContainer) {
                userContainer.style.display = 'flex';
                if (gdriveName) gdriveName.textContent = 'Đang tải...';
                if (gdriveEmail) gdriveEmail.textContent = '';
                
                try {
                    const userInfo = await gDrive.getUserInfo(token);
                    if (userInfo) {
                        if (gdriveAvatar) {
                            gdriveAvatar.src = userInfo.photoLink || 'avatar.png';
                        }
                        if (gdriveName) {
                            gdriveName.textContent = userInfo.displayName || 'Tài khoản Google';
                        }
                        if (gdriveEmail) {
                            gdriveEmail.textContent = userInfo.emailAddress || '';
                        }
                    }
                } catch (userErr) {
                    console.error('Failed to load user info:', userErr);
                    if (gdriveName) gdriveName.textContent = 'Lỗi tải thông tin';
                }
            }

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

        if (userContainer) {
            userContainer.style.display = 'none';
        }
        if (gdriveAvatar) gdriveAvatar.src = '';
        if (gdriveName) gdriveName.textContent = '';
        if (gdriveEmail) gdriveEmail.textContent = '';

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
        const favoritesData = await getAllFavorites();
        if (favoritesData.length === 0) {
            const proceed = confirm('CẢNH BÁO: Danh sách hiện tại trên máy đang không có liên kết nào (0 link).\n\nNếu sao lưu, dữ liệu cũ trên Google Drive sẽ bị thay thế bằng danh sách trống. Bạn có chắc chắn muốn tiếp tục không?');
            if (!proceed) {
                return;
            }
        }
        const storageData = await chrome.storage.local.get('customCategories');
        const customCategoriesData = JSON.parse(storageData.customCategories || '[]');
        const dataToBackup = {
            favorites: favoritesData,
            customCategories: customCategoriesData,
            lastSynced: new Date().toISOString()
        };
        await gDrive.saveBackup(dataToBackup);
        showStatus('Đã sao lưu lên Google Drive thành công!');
    } catch (err) {
        console.error('Backup error:', err);
        showStatus('Lỗi khi sao lưu: ' + (err.message || 'Không xác định'), 'error');
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
            showStatus('Không tìm thấy bản sao lưu nào trên Google Drive!', 'error', 4000);
            return;
        }

        const favoritesList = Array.isArray(data) ? data : (data.favorites || []);
        const categoriesList = Array.isArray(data.customCategories) ? data.customCategories : [];
        const lastSyncedStr = data.lastSynced ? new Date(data.lastSynced).toLocaleString('vi-VN') : 'Không rõ thời gian';

        if (favoritesList.length === 0) {
            showStatus('Bản sao lưu trên Google Drive không có liên kết nào!', 'error', 4000);
            return;
        }

        const confirmMsg = `Tìm thấy bản sao lưu trên Drive:\n- Số lượng: ${favoritesList.length} liên kết\n- Thời gian sao lưu: ${lastSyncedStr}\n\nDữ liệu hiện tại trên trình duyệt sẽ được thay thế bằng bản sao lưu này. Bạn có chắc chắn muốn khôi phục?`;

        if (confirm(confirmMsg)) {
            const db = await openDB();
            const tx = db.transaction('favorites', 'readwrite');
            const store = tx.objectStore('favorites');

            await new Promise((resolve, reject) => {
                const clearRequest = store.clear();
                clearRequest.onsuccess = resolve;
                clearRequest.onerror = () => reject(clearRequest.error);
            });

            for (const fav of favoritesList) {
                if (fav && fav.id && fav.url) {
                    await new Promise((resolve, reject) => {
                        const putRequest = store.put(fav);
                        putRequest.onsuccess = resolve;
                        putRequest.onerror = () => reject(putRequest.error);
                    });
                }
            }

            await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });

            if (categoriesList.length > 0) {
                await chrome.storage.local.set({ customCategories: JSON.stringify(categoriesList) });
                customCategories = categoriesList;
            }

            // Reset filters to show all restored items
            currentCategory = 'all';
            currentDomain = 'all';
            searchKeyword = '';
            const searchInput = document.getElementById('searchInput');
            if (searchInput) searchInput.value = '';

            favorites = await getAllFavorites();
            updateCategoryOptions();
            updateDomainFilter();
            renderFavorites();
            updateStats();

            chrome.runtime.sendMessage({ action: 'rescheduleAll' }).catch(() => {});

            showStatus(`Đã khôi phục thành công ${favoritesList.length} liên kết từ Google Drive!`);
        }
    } catch (err) {
        console.error('Restore error:', err);
        showStatus('Lỗi khi khôi phục: ' + (err.message || 'Không xác định'), 'error', 5000);
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
    const confirmation = confirm('CẢNH BÁO: Bạn có chắc chắn muốn xóa vĩnh viễn tệp sao lưu trên Google Drive?\\n\\nHành động này không thể hoàn tác và dữ liệu đám mây của bạn sẽ bị mất hoàn toàn.');
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
