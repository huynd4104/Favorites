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
            results.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
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

// Add these variables at the top
let currentScale = 1;
let isDragging = false;
let startX, startY, translateX = 0, translateY = 0;

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

function showStatus(message, type = 'success') {
    const statusModal = document.getElementById('statusModal');
    const statusEl = document.getElementById('statusMessage');
    statusEl.textContent = message;
    statusModal.className = `status-modal ${type} show`;
    setTimeout(() => {
        statusModal.classList.remove('show');
    }, 2000);
}

// Initialization
async function init() {
    try {
        favorites = await getAllFavorites();
        const storageData = await chrome.storage.local.get('customCategories');
        customCategories = JSON.parse(storageData.customCategories || '[]');

        // Update Category Selects
        const categoryFilter = document.getElementById('categoryFilter');
        const customGroup = document.getElementById('customCategories');
        const categoryInput = document.getElementById('categoryInput');

        customGroup.innerHTML = customCategories.map(c => `<option value="${c}">${c}</option>`).join('');
        // Add to note modal category select too
        const baseOptions = `
            <option value="Uncategorized">Chưa phân loại</option>
            <option value="Work">Công việc</option>
            <option value="Study">Học tập</option>
            <option value="Entertainment">Giải trí</option>
            <option value="Other">Khác</option>
        `;
        categoryInput.innerHTML = baseOptions + customCategories.map(c => `<option value="${c}">${c}</option>`).join('');

        updateDomainFilter();
        renderFavorites();

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
