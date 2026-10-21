/**
 * Google Drive Client for Chrome Extension
 * Handles OAuth2 authentication and file operations in the App Data folder.
 */
class GDriveClient {
    constructor() {
        this.CLIENT_ID = null; // Defined in manifest.json
        this.SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
        this.FILENAME = 'favorites_backup.json';
    }

    /**
     * Clear cached OAuth2 token
     * @param {string} [token=null]
     */
    async clearCachedToken(token = null) {
        if (token) {
            await new Promise((resolve) => {
                chrome.identity.removeCachedAuthToken({ token }, resolve);
            });
        }
        if (chrome.identity && chrome.identity.clearAllCachedAuthTokens) {
            await new Promise((resolve) => {
                chrome.identity.clearAllCachedAuthTokens(resolve);
            });
        }
    }

    /**
     * Get OAuth2 Access Token
     * @param {boolean} interactive - Whether to show the login prompt if needed
     * @returns {Promise<string>} Token
     */
    async getAuthToken(interactive = true) {
        return new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive }, (token) => {
                if (chrome.runtime.lastError) {
                    const lastErr = chrome.runtime.lastError;
                    const rawMsg = lastErr.message || '';
                    console.error('[GDriveClient] getAuthToken error:', lastErr);

                    let friendlyMsg = rawMsg || 'Lỗi xác thực Google';
                    if (rawMsg.includes('User is not signed in') || rawMsg.includes('not signed in to Chrome')) {
                        friendlyMsg = 'Chưa bật Đồng bộ hóa (Sync) trên trình duyệt Chrome. Bạn cần đăng nhập tài khoản Google và Bật tính năng đồng bộ hóa (Turn on sync) trong cài đặt Chrome.';
                    } else if (rawMsg.includes('bad client id') || rawMsg.includes('OAuth2 client id is invalid') || rawMsg.includes('OAuth client was not found')) {
                        friendlyMsg = `Client ID hoặc Extension ID chưa khớp trên Google Cloud Console (Extension ID: ${chrome.runtime.id}).`;
                    } else if (rawMsg.includes('did not approve access') || rawMsg.includes('access_denied')) {
                        friendlyMsg = 'Bạn đã hủy hoặc từ chối cấp quyền truy cập Google Drive.';
                    }

                    const error = new Error(friendlyMsg);
                    error.originalMessage = rawMsg;
                    reject(error);
                } else if (!token) {
                    reject(new Error('Không nhận được token xác thực từ Chrome'));
                } else {
                    resolve(token);
                }
            });
        });
    }

    /**
     * Purge current token (logout)
     */
    async logout() {
        const token = await this.getAuthToken(false).catch(() => null);
        if (token) {
            await this.clearCachedToken(token);
            // Also revoke the token via Google's API
            try {
                await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
            } catch (e) {
                console.warn('[GDriveClient] Revoke token failed:', e);
            }
        } else {
            await this.clearCachedToken();
        }
    }

    /**
     * Find the backup file in the App Data folder
     * @returns {Promise<string|null>} File ID if found
     */
    async findBackupFile(token) {
        const response = await fetch(
            'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=' +
            encodeURIComponent(`name = '${this.FILENAME}' and trashed = false`),
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );
        if (response.status === 401) {
            await this.clearCachedToken(token);
            throw new Error('Phiên đăng nhập Google Drive đã hết hạn. Vui lòng đăng nhập lại.');
        }
        const result = await response.json();
        if (result.files && result.files.length > 0) {
            return result.files[0].id;
        }
        return null;
    }

    /**
     * Save data to Google Drive
     * @param {Object} data - The data to save
     */
    async saveBackup(data, token = null) {
        if (!token) {
            token = await this.getAuthToken(true);
        }
        const fileId = await this.findBackupFile(token);

        let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
        let method = 'POST';
        const metadata = {};

        if (fileId) {
            url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
            method = 'PATCH';
            // Don't send any metadata (like name or parents) during update unless changing it
        } else {
            metadata.name = this.FILENAME;
            metadata.parents = ['appDataFolder'];
        }

        const formData = new FormData();
        formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        formData.append('file', new Blob([JSON.stringify(data)], { type: 'application/json' }));

        const response = await fetch(url, {
            method: method,
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        if (response.status === 401) {
            await this.clearCachedToken(token);
            throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại Google Drive.');
        }

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || 'Failed to upload to Google Drive');
        }

        return await response.json();
    }

    /**
     * Load data from Google Drive
     * @returns {Promise<Object|null>}
     */
    async loadBackup() {
        const token = await this.getAuthToken(true);
        const fileId = await this.findBackupFile(token);

        if (!fileId) return null;

        const response = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        if (response.status === 401) {
            await this.clearCachedToken(token);
            throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại Google Drive.');
        }

        if (!response.ok) {
            throw new Error('Không thể tải tệp sao lưu từ Google Drive.');
        }

        const text = await response.text();
        if (!text || !text.trim()) return null;

        let parsed = null;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            console.error('[GDriveClient] Failed to parse backup JSON:', text);
            throw new Error('Dữ liệu sao lưu trên Google Drive không đúng định dạng JSON.');
        }

        const favs = Array.isArray(parsed) ? parsed : (parsed?.favorites || []);
        if (favs.length === 0) {
            // Check if there are older revisions on Drive that might have data
            try {
                const revResp = await fetch(
                    `https://www.googleapis.com/drive/v3/files/${fileId}/revisions?fields=revisions(id,modifiedTime,size)`,
                    { headers: { 'Authorization': `Bearer ${token}` } }
                );
                if (revResp.ok) {
                    const revData = await revResp.json();
                    const revisions = revData.revisions || [];
                    // Look backwards from newest to oldest
                    for (let i = revisions.length - 2; i >= 0; i--) {
                        const rev = revisions[i];
                        const rResp = await fetch(
                            `https://www.googleapis.com/drive/v3/files/${fileId}/revisions/${rev.id}?alt=media`,
                            { headers: { 'Authorization': `Bearer ${token}` } }
                        );
                        if (rResp.ok) {
                            const rText = await rResp.text();
                            const rParsed = JSON.parse(rText);
                            const rFavs = Array.isArray(rParsed) ? rParsed : (rParsed?.favorites || []);
                            if (rFavs.length > 0) {
                                console.log(`[GDriveClient] Recovered ${rFavs.length} favorites from older revision:`, rev.id);
                                rParsed._recoveredFromRevision = rev.modifiedTime;
                                return rParsed;
                            }
                        }
                    }
                }
            } catch (revErr) {
                console.warn('[GDriveClient] Revision check warning:', revErr);
            }
        }

        return parsed;
    }

    /**
     * Get user profile information (avatar, display name, email) from Google Drive
     * @param {string} [token=null] - Access token
     * @returns {Promise<Object|null>} User info
     */
    async getUserInfo(token = null) {
        if (!token) {
            token = await this.getAuthToken(false);
        }
        if (!token) return null;

        const response = await fetch(
            'https://www.googleapis.com/drive/v3/about?fields=user',
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        if (response.status === 401) {
            await this.clearCachedToken(token);
            throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại Google Drive.');
        }

        if (!response.ok) {
            throw new Error('Failed to fetch user profile from Google Drive');
        }

        const result = await response.json();
        return result.user;
    }

    /**
     * Delete the backup file in Google Drive
     */
    async deleteBackup() {
        const token = await this.getAuthToken(true);
        const fileId = await this.findBackupFile(token);

        if (!fileId) return;

        const response = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}`,
            {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        if (response.status === 401) {
            await this.clearCachedToken(token);
            throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại Google Drive.');
        }

        if (!response.ok) {
            throw new Error('Failed to delete from Google Drive');
        }

        return true;
    }
}

const gDrive = new GDriveClient();
