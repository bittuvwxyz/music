/**
 * Offline Storage Manager using IndexedDB & LocalStorage
 * Persists offline songs, playlists, liked tracks, recently played, and player preferences.
 */

const StorageManager = {
    db: null,
    DB_NAME: 'SpotifyOfflineDB',
    DB_VERSION: 1,

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('tracks')) {
                    const trackStore = db.createObjectStore('tracks', { keyPath: 'id' });
                    trackStore.createIndex('title', 'title', { unique: false });
                    trackStore.createIndex('artist', 'artist', { unique: false });
                    trackStore.createIndex('album', 'album', { unique: false });
                }
                if (!db.objectStoreNames.contains('playlists')) {
                    db.createObjectStore('playlists', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('blobs')) {
                    db.createObjectStore('blobs', { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('IndexedDB error:', event.target.error);
                reject(event.target.error);
            };
        });
    },

    // Save a batch of tracks
    async saveTracks(tracks) {
        if (!this.db) await this.init();
        const tx = this.db.transaction(['tracks'], 'readwrite');
        const store = tx.objectStore('tracks');
        for (const track of tracks) {
            // strip file object or non-serializable fields for tracks store
            const cleanTrack = { ...track };
            if (cleanTrack.file) {
                // save blob separately if possible
                this.saveFileBlob(cleanTrack.id, cleanTrack.file);
                delete cleanTrack.file;
            }
            store.put(cleanTrack);
        }
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    // Save file blob for offline access
    async saveFileBlob(id, file) {
        try {
            const tx = this.db.transaction(['blobs'], 'readwrite');
            tx.objectStore('blobs').put({ id, blob: file });
        } catch (e) {
            console.warn('Could not store blob for id', id, e);
        }
    },

    // Get file blob by id
    async getFileBlob(id) {
        if (!this.db) await this.init();
        return new Promise((resolve) => {
            const tx = this.db.transaction(['blobs'], 'readonly');
            const req = tx.objectStore('blobs').get(id);
            req.onsuccess = () => resolve(req.result ? req.result.blob : null);
            req.onerror = () => resolve(null);
        });
    },

    // Get all stored tracks
    async getAllTracks() {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['tracks'], 'readonly');
            const store = tx.objectStore('tracks');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    },

    // Clear all offline tracks
    async clearTracks() {
        if (!this.db) await this.init();
        const tx = this.db.transaction(['tracks', 'blobs'], 'readwrite');
        tx.objectStore('tracks').clear();
        tx.objectStore('blobs').clear();
        return new Promise((resolve) => {
            tx.oncomplete = () => resolve();
        });
    },

    // Playlists
    async getPlaylists() {
        if (!this.db) await this.init();
        return new Promise((resolve) => {
            const tx = this.db.transaction(['playlists'], 'readonly');
            const req = tx.objectStore('playlists').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    },

    async savePlaylist(playlist) {
        if (!this.db) await this.init();
        const tx = this.db.transaction(['playlists'], 'readwrite');
        tx.objectStore('playlists').put(playlist);
        return new Promise((resolve) => {
            tx.oncomplete = () => resolve();
        });
    },

    async deletePlaylist(id) {
        if (!this.db) await this.init();
        const tx = this.db.transaction(['playlists'], 'readwrite');
        tx.objectStore('playlists').delete(id);
        return new Promise((resolve) => {
            tx.oncomplete = () => resolve();
        });
    },

    // Liked songs (stored in localStorage for instantaneous fast lookups)
    getLikedSongIds() {
        try {
            return JSON.parse(localStorage.getItem('spotify_liked_tracks') || '[]');
        } catch {
            return [];
        }
    },

    saveLikedSongIds(ids) {
        localStorage.setItem('spotify_liked_tracks', JSON.stringify(ids));
    },

    isLiked(trackId) {
        const liked = this.getLikedSongIds();
        return liked.includes(trackId);
    },

    toggleLike(trackId) {
        let liked = this.getLikedSongIds();
        const index = liked.indexOf(trackId);
        let isNowLiked = false;
        if (index > -1) {
            liked.splice(index, 1);
            isNowLiked = false;
        } else {
            liked.unshift(trackId);
            isNowLiked = true;
        }
        this.saveLikedSongIds(liked);
        return isNowLiked;
    },

    // Recently played
    getRecentlyPlayed() {
        try {
            return JSON.parse(localStorage.getItem('spotify_recently_played') || '[]');
        } catch {
            return [];
        }
    },

    addRecentlyPlayed(trackId) {
        let recent = this.getRecentlyPlayed().filter(id => id !== trackId);
        recent.unshift(trackId);
        if (recent.length > 30) recent = recent.slice(0, 30);
        localStorage.setItem('spotify_recently_played', JSON.stringify(recent));
    },

    // Player Preferences
    getSetting(key, defaultValue) {
        try {
            const val = localStorage.getItem(`spotify_setting_${key}`);
            return val !== null ? JSON.parse(val) : defaultValue;
        } catch {
            return defaultValue;
        }
    },

    setSetting(key, value) {
        try {
            localStorage.setItem(`spotify_setting_${key}`, JSON.stringify(value));
        } catch (e) {
            console.warn(e);
        }
    },

    // Custom Lyrics Storage
    getLyrics(trackId) {
        try {
            const lyricsMap = JSON.parse(localStorage.getItem('songplayer_custom_lyrics') || '{}');
            return lyricsMap[trackId] || null;
        } catch {
            return null;
        }
    },

    saveLyrics(trackId, text) {
        try {
            const lyricsMap = JSON.parse(localStorage.getItem('songplayer_custom_lyrics') || '{}');
            lyricsMap[trackId] = text;
            localStorage.setItem('songplayer_custom_lyrics', JSON.stringify(lyricsMap));
        } catch (e) {
            console.warn(e);
        }
    },

    // Track Metadata Overrides (Custom Title, Artist, Album)
    getTrackOverrides() {
        try {
            return JSON.parse(localStorage.getItem('songplayer_track_overrides') || '{}');
        } catch {
            return {};
        }
    },

    saveTrackOverride(trackId, data) {
        try {
            const overrides = this.getTrackOverrides();
            overrides[trackId] = { ...(overrides[trackId] || {}), ...data };
            localStorage.setItem('songplayer_track_overrides', JSON.stringify(overrides));
        } catch (e) {
            console.warn(e);
        }
    },

    // Theme Accent
    getThemeAccent() {
        return localStorage.getItem('songplayer_theme_accent') || '#1db954';
    },

    setThemeAccent(color) {
        localStorage.setItem('songplayer_theme_accent', color);
    },

    // Export entire library metadata, custom playlists, favorites, lyrics to JSON
    async exportBackup() {
        const playlists = await this.getPlaylists();
        const liked = this.getLikedSongIds();
        const lyrics = JSON.parse(localStorage.getItem('songplayer_custom_lyrics') || '{}');
        const overrides = this.getTrackOverrides();
        const accent = this.getThemeAccent();

        const backupData = {
            version: 1,
            exportedAt: new Date().toISOString(),
            playlists,
            liked,
            lyrics,
            overrides,
            accent
        };

        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `SongPlayer-Backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    // Import backup JSON
    async importBackup(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            if (data.playlists && Array.isArray(data.playlists)) {
                for (const pl of data.playlists) {
                    await this.savePlaylist(pl);
                }
            }
            if (data.liked && Array.isArray(data.liked)) {
                this.saveLikedSongIds(data.liked);
            }
            if (data.lyrics) {
                localStorage.setItem('songplayer_custom_lyrics', JSON.stringify(data.lyrics));
            }
            if (data.overrides) {
                localStorage.setItem('songplayer_track_overrides', JSON.stringify(data.overrides));
            }
            if (data.accent) {
                this.setThemeAccent(data.accent);
            }
            return true;
        } catch (err) {
            console.error('Failed to import backup:', err);
            return false;
        }
    }
};

window.StorageManager = StorageManager;
