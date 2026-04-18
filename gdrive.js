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
     * Get OAuth2 Access Token
     * @param {boolean} interactive - Whether to show the login prompt if needed
     * @returns {Promise<string>} Token
     */
    async getAuthToken(interactive = true) {
        return new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive }, (token) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
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
            await new Promise((resolve) => {
                chrome.identity.removeCachedAuthToken({ token }, resolve);
            });
            // Also revoke the token via Google's API
            await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
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
    async saveBackup(data) {
        const token = await this.getAuthToken(true);
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

        if (!response.ok) {
            throw new Error('Failed to download from Google Drive');
        }

        return await response.json();
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

        if (!response.ok) {
            throw new Error('Failed to delete from Google Drive');
        }

        return true;
    }
}

const gDrive = new GDriveClient();
