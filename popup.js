let currentTab = null;
let favorites = [];
let filteredFavorites = [];
let autoScrollInterval = null;
let scrollContainer = null;

// Lấy thông tin tab hiện tại
async function getCurrentTab() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab;
    } catch (error) {
        console.error('Error getting current tab:', error);
        return null;
    }
}

// Hiển thị thông báo trạng thái
function showStatus(message, type = 'success') {
    const statusEl = document.getElementById('statusMessage');
    statusEl.textContent = message;
    statusEl.className = `status-message ${type}`;
    statusEl.style.display = 'block';

    setTimeout(() => {
        statusEl.style.display = 'none';
    }, 2000);
}

// Cập nhật trạng thái nút "Thêm vào Favorites"
function updateAddButtonState() {
    const addBtn = document.getElementById('addBtn');
    if (!currentTab || !addBtn) return;

    const exists = favorites.some(fav => fav.url === currentTab.url);
    if (exists) {
        addBtn.textContent = '✓ Đã có trong favorites';
        addBtn.disabled = true;
    } else {
        addBtn.textContent = '⭐ Thêm vào Favorites';
        addBtn.disabled = false;
    }
}

// Lưu favorite
async function saveFavorite(url, title) {
    try {
        // Kiểm tra URL đã tồn tại chưa
        const exists = favorites.some(fav => fav.url === url);
        if (exists) {
            showStatus('URL này đã có trong danh sách!', 'error');
            return;
        }

        const favorite = {
            id: Date.now().toString(),
            url: url,
            title: title || url,
            note: '',
            dateAdded: new Date().toISOString()
        };

        favorites.unshift(favorite);
        await chrome.storage.local.set({ favorites: favorites });

        renderFavorites();
        showStatus('Đã thêm vào favorites!');
        updateAddButtonState(); // Cập nhật trạng thái nút ngay sau khi thêm

    } catch (error) {
        console.error('Error saving favorite:', error);
        showStatus('Lỗi khi lưu favorite!', 'error');
    }
}

// Xóa favorite
async function deleteFavorite(id) {
    try {
        favorites = favorites.filter(fav => fav.id !== id);
        await chrome.storage.local.set({ favorites: favorites });
        renderFavorites();
        showStatus('Đã xóa khỏi favorites!');
        updateAddButtonState(); // Cập nhật trạng thái nút sau khi xóa
    } catch (error) {
        console.error('Error deleting favorite:', error);
        showStatus('Lỗi khi xóa favorite!', 'error');
    }
}

let draggedElement = null;
let draggedIndex = -1;

// Thêm event listeners cho drag & drop trong renderFavorites()
function addDragListeners(itemEl, index) {
    // Drag start
    itemEl.addEventListener('dragstart', (e) => {
        draggedElement = itemEl;
        draggedIndex = index;
        itemEl.classList.add('dragging');

        // Lấy reference đến scroll container
        scrollContainer = document.getElementById('favoritesList');

        // Set drag effect
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', itemEl.outerHTML);

        // Prevent link clicks during drag
        const links = itemEl.querySelectorAll('a');
        links.forEach(link => link.style.pointerEvents = 'none');
    });

    // Drag end
    itemEl.addEventListener('dragend', () => {
        itemEl.classList.remove('dragging');

        // Stop auto-scroll
        stopAutoScroll();
        scrollContainer = null;

        // Restore link clicks
        const links = itemEl.querySelectorAll('a');
        links.forEach(link => link.style.pointerEvents = 'auto');

        // Clean up
        draggedElement = null;
        draggedIndex = -1;

        // Remove all drag-over classes
        document.querySelectorAll('.drag-over').forEach(el => {
            el.classList.remove('drag-over');
        });
    });

    // Drag over
    itemEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        if (draggedElement && draggedElement !== itemEl) {
            itemEl.classList.add('drag-over');
        }
    });

    // Drag leave
    itemEl.addEventListener('dragleave', (e) => {
        // Only remove class if we're leaving the element itself, not a child
        if (!itemEl.contains(e.relatedTarget)) {
            itemEl.classList.remove('drag-over');
        }
    });

    // Drop
    itemEl.addEventListener('drop', (e) => {
        e.preventDefault();

        if (draggedElement && draggedElement !== itemEl) {
            const targetIndex = index;
            moveItem(draggedIndex, targetIndex);
        }

        itemEl.classList.remove('drag-over');
    });
}

document.addEventListener('DOMContentLoaded', () => {

    // Thêm mouse move listener cho auto-scroll khi drag
    document.addEventListener('dragover', (e) => {
        if (draggedElement && scrollContainer) {
            const containerRect = scrollContainer.getBoundingClientRect();
            const scrollThreshold = 30; // pixels from edge
            const scrollSpeed = 3;

            // Check if mouse is near container edges
            if (e.clientY < containerRect.top + scrollThreshold && 
                e.clientY > containerRect.top) {
                startAutoScroll('up', scrollSpeed);
            } else if (e.clientY > containerRect.bottom - scrollThreshold && 
                       e.clientY < containerRect.bottom) {
                startAutoScroll('down', scrollSpeed);
            } else {
                stopAutoScroll();
            }
        }
    });

    document.addEventListener('dragend', () => {
        stopAutoScroll();
    });
});


// Di chuyển item trong mảng
async function moveItem(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;

    // Tạo bản copy của mảng
    const newFavorites = [...favorites];

    // Lấy item cần di chuyển
    const [movedItem] = newFavorites.splice(fromIndex, 1);

    // Chèn vào vị trí mới
    newFavorites.splice(toIndex, 0, movedItem);

    // Cập nhật mảng chính
    favorites = newFavorites;

    try {
        // Lưu vào storage
        await chrome.storage.local.set({ favorites: favorites });

        // Re-render danh sách
        renderFavorites();

        showStatus('Đã thay đổi thứ tự!');
    } catch (error) {
        console.error('Error saving new order:', error);
        showStatus('Lỗi khi lưu thứ tự mới!', 'error');
    }
}

// Hiển thị danh sách favorites (có thể lọc)
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

        // Thêm HTML với drag handle
        itemEl.innerHTML = `
            <div class="drag-handle" title="Kéo để thay đổi vị trí">⋮⋮</div>
            <div class="favorite-content">
                <div class="favorite-info">
                    <a href="${escapeHtml(fav.url)}" class="favorite-link" target="_blank" title="${escapeHtml(fav.url)}">
                        <div class="favorite-title">${fav.highlightedTitle || escapeHtml(fav.title)}</div>
                        <div class="favorite-url">${fav.highlightedUrl || escapeHtml(fav.url)}</div>
                    </a>
                </div>
                <div class="favorite-actions">
                    <button class="note-btn ${fav.note ? 'has-note' : ''}" title="${fav.note ? 'Chỉnh sửa ghi chú' : 'Thêm ghi chú'}">📝</button>
                    <button class="delete-btn" title="Xóa">🗑️</button>
                </div>
            </div>
            ${fav.note ? `<div class="favorite-note">${escapeHtml(fav.note)}</div>` : ''}
        `;

        // Thêm attributes cho drag & drop
        itemEl.draggable = true;
        itemEl.dataset.id = fav.id;

        // Chỉ thêm drag listeners khi không đang search
        if (favoritesToRender === null) {
            addDragListeners(itemEl, index);
        } else {
            // Disable drag khi đang search
            itemEl.draggable = false;
            itemEl.style.cursor = 'default';
            const dragHandle = itemEl.querySelector('.drag-handle');
            if (dragHandle) {
                dragHandle.style.display = 'none';
            }
        }

        // Event listeners cho note và delete buttons
        const noteBtn = itemEl.querySelector('.note-btn');
        noteBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent drag
            showNoteModal(fav.id, fav.note || '');
        });

        const deleteBtn = itemEl.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent drag
            showDeleteModal(fav.id, fav.title);
        });

        listEl.appendChild(itemEl);
    });
}

// Escape HTML để tránh XSS
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Khởi tạo
async function init() {
    try {
        // Lấy thông tin tab hiện tại
        currentTab = await getCurrentTab();
        if (currentTab) {
            document.getElementById('currentUrl').textContent = currentTab.url;

            // Load danh sách favorites
            const data = await chrome.storage.local.get(['favorites']);
            favorites = data.favorites || [];
            updateAddButtonState(); // Cập nhật trạng thái nút khi khởi tạo
            renderFavorites();
        } else {
            document.getElementById('currentUrl').textContent = 'Không thể lấy thông tin trang';
            document.getElementById('addBtn').disabled = true;
        }
    } catch (error) {
        console.error('Error initializing:', error);
        showStatus('Lỗi khởi tạo extension!', 'error');
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Khởi tạo
    init();

    // Event listener cho nút thêm
    document.getElementById('addBtn').addEventListener('click', () => {
        if (currentTab) {
            saveFavorite(currentTab.url, currentTab.title);
        }
    });
});

let deleteItemId = null;

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

// Thêm event listeners cho modal
document.addEventListener('DOMContentLoaded', () => {
    // Event listeners cho modal delete
    const cancelBtn = document.getElementById('cancelBtn');
    const confirmBtn = document.getElementById('confirmBtn');
    const modalOverlay = document.getElementById('deleteModal');

    if (cancelBtn) {
        cancelBtn.addEventListener('click', hideDeleteModal);
    }

    if (confirmBtn) {
        confirmBtn.addEventListener('click', confirmDelete);
    }

    // Click overlay để đóng modal
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                hideDeleteModal();
            }
        });
    }

    // Event listeners cho modal note
    document.getElementById('cancelNoteBtn').addEventListener('click', hideNoteModal);
    document.getElementById('saveNoteBtn').addEventListener('click', saveNote);

    document.getElementById('noteModal').addEventListener('click', (e) => {
        if (e.target.id === 'noteModal') {
            hideNoteModal();
        }
    });

});

// Highlight text matching search term
function highlightText(text, searchTerm) {
    if (!searchTerm) return escapeHtml(text);

    const escapedText = escapeHtml(text);
    const regex = new RegExp(`(${escapeHtml(searchTerm)})`, 'gi');
    return escapedText.replace(regex, '<span class="search-highlight">$1</span>');
}

// Filter favorites based on search term
function filterFavorites(searchTerm) {
    if (!searchTerm.trim()) {
        filteredFavorites = [];
        updateSearchInfo('');
        renderFavorites();
        return;
    }

    const term = searchTerm.toLowerCase().trim();

    filteredFavorites = favorites.filter(fav => {
        const titleMatch = fav.title.toLowerCase().includes(term);
        const urlMatch = fav.url.toLowerCase().includes(term);
        return titleMatch || urlMatch;
    }).map(fav => ({
        ...fav,
        highlightedTitle: highlightText(fav.title, searchTerm),
        highlightedUrl: highlightText(fav.url, searchTerm)
    }));

    updateSearchInfo(searchTerm);
    renderFavorites(filteredFavorites);
}

// Update search results info
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

// Clear search
function clearSearch() {
    const searchInput = document.getElementById('searchInput');
    searchInput.value = '';
    filterFavorites('');
    searchInput.focus();
}

document.addEventListener('DOMContentLoaded', () => {
    // Search functionality
    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearch');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterFavorites(e.target.value);
        });

        // Clear search on Escape key
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                clearSearch();
            }
        });
    }

    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', clearSearch);
    }
});

let currentNoteItemId = null;

function showNoteModal(id, note) {
    currentNoteItemId = id;
    document.getElementById('noteInput').value = note;
    document.getElementById('noteModal').classList.add('show');
}

function hideNoteModal() {
    document.getElementById('noteModal').classList.remove('show');
    currentNoteItemId = null;
}

function saveNote() {
    const newNote = document.getElementById('noteInput').value;
    const index = favorites.findIndex(f => f.id === currentNoteItemId);
    if (index !== -1) {
        favorites[index].note = newNote;
        chrome.storage.local.set({ favorites: favorites }, () => {
            renderFavorites();
            showStatus('Đã lưu ghi chú!');
        });
    }
    hideNoteModal();
}

function startAutoScroll(direction, speed = 2) {
    if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
    }
    
    autoScrollInterval = setInterval(() => {
        if (scrollContainer) {
            if (direction === 'up') {
                scrollContainer.scrollTop -= speed;
                // Hiển thị indicator
                document.getElementById('scrollUpIndicator').classList.add('show');
                document.getElementById('scrollDownIndicator').classList.remove('show');
            } else if (direction === 'down') {
                scrollContainer.scrollTop += speed;
                // Hiển thị indicator
                document.getElementById('scrollDownIndicator').classList.add('show');
                document.getElementById('scrollUpIndicator').classList.remove('show');
            }
        }
    }, 16); // ~60fps
}

function stopAutoScroll() {
    if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
    }
    // Ẩn indicators
    document.getElementById('scrollUpIndicator').classList.remove('show');
    document.getElementById('scrollDownIndicator').classList.remove('show');
}
