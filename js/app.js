/**
 * Song Player - Main Application Orchestrator
 * Pure vanilla JavaScript - 100% Offline Compatible
 */

class SongPlayerApp {
    constructor() {
        this.player = null;
        this.visualizer = null;
        this.allTracks = [];
        this.currentView = 'home';
        this.history = ['home'];
        this.historyIndex = 0;
        this.playlists = [];
        this.activePlaylist = null;
        this.activeFilter = 'all';

        // Right pane tabs
        this.rightPaneTab = 'now-playing'; // 'now-playing', 'queue', 'lyrics'
        this.isRightPaneOpen = false;

        // Scrubbing state flags to prevent UI jitter
        this.isSeeking = false;
        this.isVolSeeking = false;

        // Synced lyrics cache
        this.currentSyncedLyrics = null; // array of { time: seconds, text: string }

        this.init();
    }

    async init() {
        // Initialize storage
        await StorageManager.init();

        // Apply saved Theme Accent
        const savedAccent = StorageManager.getThemeAccent();
        document.documentElement.style.setProperty('--theme-accent', savedAccent);

        // Initialize audio engine
        this.player = new AudioPlayer();

        // Initialize visualizer
        const canvas = document.getElementById('visualizerCanvas');
        this.visualizer = new AudioVisualizer(canvas);
        this.visualizer.setThemeColor(savedAccent);

        // Bind Player Callbacks
        this.setupPlayerCallbacks();

        // Setup DOM Events
        this.setupNavigation();
        this.setupFolderInput();
        this.setupDragAndDrop();
        this.setupControls();
        this.setupThemePicker();
        this.setupSleepTimer();
        this.setupSpeedControl();
        this.setupABLooper();
        this.setupTagEditor();
        this.setupSortingAndFiltering();
        this.setupBackupRestore();
        this.setupEqualizer();
        this.setupFullscreen();
        this.setupKeyboardShortcuts();
        this.setupSearch();
        this.setupPlaylists();

        // Set greeting
        this.updateGreeting();

        // Load library
        await this.loadInitialLibrary();

        // Render browse categories
        this.renderBrowseCategories();
    }

    /* ==========================================================================
       Greeting & Time Helpers
       ========================================================================== */
    updateGreeting() {
        const hour = new Date().getHours();
        let greeting = 'Good evening';
        if (hour >= 5 && hour < 12) greeting = 'Good morning';
        else if (hour >= 12 && hour < 18) greeting = 'Good afternoon';

        const greetingEl = document.getElementById('greetingText');
        if (greetingEl) greetingEl.textContent = greeting;
    }

    formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    /* ==========================================================================
       Initial Library Loading
       ========================================================================== */
    async loadInitialLibrary() {
        let loaded = [];

        // 1. Try loading from songs/songs.json if available
        try {
            const resp = await fetch('songs/songs.json');
            if (resp.ok) {
                const jsonTracks = await resp.json();
                for (const t of jsonTracks) {
                    if (!t.coverArt) {
                        t.coverArt = MetadataParser.generateCoverArt(t.title, t.artist);
                    }
                    loaded.push(t);
                }
            }
        } catch (e) {
            console.log('songs.json fetch skipped (likely file:// protocol). Using embedded defaults.');
        }

        // If file:// protocol or fetch blocked, provide default offline songs fallback
        if (loaded.length === 0) {
            const defaultSongs = [
                {
                    id: "offline_1",
                    title: "Morning Coffee",
                    artist: "Acoustic Breeze",
                    album: "Local Music",
                    filename: "Acoustic Breeze - Morning Coffee.wav",
                    url: "songs/Acoustic Breeze - Morning Coffee.wav",
                    format: "wav",
                    duration: 16
                },
                {
                    id: "offline_2",
                    title: "Sunset Reverie",
                    artist: "Lofi Study",
                    album: "Local Music",
                    filename: "Lofi Study - Sunset Reverie.wav",
                    url: "songs/Lofi Study - Sunset Reverie.wav",
                    format: "wav",
                    duration: 16
                },
                {
                    id: "offline_3",
                    title: "Synthwave Dream",
                    artist: "Midnight City",
                    album: "Local Music",
                    filename: "Midnight City - Synthwave Dream.wav",
                    url: "songs/Midnight City - Synthwave Dream.wav",
                    format: "wav",
                    duration: 10
                },
                {
                    id: "offline_master",
                    title: "Master Track",
                    artist: "Offline Artist",
                    album: "Local Music",
                    filename: "master.mp3",
                    url: "songs/master.mp3",
                    format: "mp3",
                    duration: 210
                },
                {
                    id: "offline_4",
                    title: "Cyber Romance",
                    artist: "Neon Drive",
                    album: "Local Music",
                    filename: "Neon Drive - Cyber Romance.wav",
                    url: "songs/Neon Drive - Cyber Romance.wav",
                    format: "wav",
                    duration: 16
                }
            ];

            for (const t of defaultSongs) {
                t.coverArt = MetadataParser.generateCoverArt(t.title, t.artist);
                loaded.push(t);
            }
        }

        // 2. Load stored tracks from IndexedDB
        const stored = await StorageManager.getAllTracks();
        for (const st of stored) {
            if (!loaded.find(t => t.id === st.id)) {
                if (!st.coverArt) {
                    st.coverArt = MetadataParser.generateCoverArt(st.title, st.artist);
                }
                loaded.push(st);
            }
        }

        // 3. Apply user saved metadata overrides (custom Title, Artist, Album)
        const overrides = StorageManager.getTrackOverrides();
        for (const track of loaded) {
            if (overrides[track.id]) {
                if (overrides[track.id].title) track.title = overrides[track.id].title;
                if (overrides[track.id].artist) track.artist = overrides[track.id].artist;
                if (overrides[track.id].album) track.album = overrides[track.id].album;
            }
        }

        this.allTracks = loaded;
        this.updateLibraryCounters();
        this.renderHomeView();
        this.renderSidebarPlaylists();

        // Preload queue and first song into player bar without autoplaying
        if (this.allTracks.length > 0) {
            this.player.setQueue(this.allTracks, 0, false);
            this.updatePlayerUI(this.allTracks[0], false);
        }
    }

    updateLibraryCounters() {
        const likedIds = StorageManager.getLikedSongIds();
        const likedCountEl = document.getElementById('likedSongsCount');
        if (likedCountEl) {
            likedCountEl.textContent = `${likedIds.length} song${likedIds.length === 1 ? '' : 's'}`;
        }

        const offlineCountEl = document.getElementById('offlineSongsCount');
        if (offlineCountEl) {
            offlineCountEl.textContent = `${this.allTracks.length} track${this.allTracks.length === 1 ? '' : 's'}`;
        }
    }

    /* ==========================================================================
       Player Callbacks
       ========================================================================== */
    setupPlayerCallbacks() {
        const playBtn = document.getElementById('btnPlayPause');
        const playIcon = document.getElementById('playIconSvg');

        this.player.onPlayStateChange = (isPlaying) => {
            if (isPlaying) {
                playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
                playBtn.title = 'Pause';
                playBtn.setAttribute('aria-label', 'Pause');
                if (this.player.analyserNode) {
                    this.visualizer.connect(this.player.analyserNode);
                    this.visualizer.start();
                }
            } else {
                playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
                playBtn.title = 'Play';
                playBtn.setAttribute('aria-label', 'Play');
                this.visualizer.stop();
            }
        };

        this.player.onBufferingChange = (isBuffering) => {
            if (playBtn) {
                playBtn.classList.toggle('buffering', isBuffering);
                if (isBuffering) {
                    playBtn.title = 'Buffering...';
                } else {
                    playBtn.title = this.player.isPlaying ? 'Pause' : 'Play';
                }
            }
        };

        this.player.onError = (err) => {
            this.showToast(`⚠️ Audio error: ${err.message || 'Playback failed'}`);
        };

        this.player.onTrackChange = (track) => {
            this.updatePlayerUI(track, true);
            this.updateActiveTrackInTables(track.id);
            this.renderQueueTab();
        };

        this.player.onTimeUpdate = (currentTime, duration) => {
            const timeCurrent = document.getElementById('timeCurrent');
            const timeTotal = document.getElementById('timeTotal');
            const seekProgress = document.getElementById('seekProgress');
            const seekSlider = document.getElementById('seekSlider');
            const mobProgress = document.getElementById('mobileProgressBar');

            if (timeTotal && duration) timeTotal.textContent = this.formatTime(duration);

            if (!this.isSeeking) {
                if (timeCurrent) timeCurrent.textContent = this.formatTime(currentTime);

                if (duration > 0) {
                    const percent = (currentTime / duration) * 100;
                    if (seekProgress) seekProgress.style.width = `${percent}%`;
                    if (mobProgress) mobProgress.style.width = `${percent}%`;
                    if (seekSlider) {
                        seekSlider.setAttribute('aria-valuenow', Math.round(currentTime));
                        seekSlider.setAttribute('aria-valuemax', Math.round(duration));
                        seekSlider.setAttribute('aria-valuetext', `${this.formatTime(currentTime)} of ${this.formatTime(duration)}`);
                    }
                } else {
                    if (seekProgress) seekProgress.style.width = '0%';
                    if (mobProgress) mobProgress.style.width = '0%';
                }
            }

            // Synced lyrics highlighting
            if (this.currentSyncedLyrics && this.currentSyncedLyrics.length > 0) {
                this.highlightSyncedLyric(currentTime);
            }
        };

        this.player.onVolumeChange = (vol, isMuted) => {
            const volProgress = document.getElementById('volumeProgress');
            const volumeSlider = document.getElementById('volumeSlider');
            const volIcon = document.getElementById('volumeIconSvg');

            const effectiveVol = isMuted ? 0 : vol;
            if (volProgress && !this.isVolSeeking) {
                volProgress.style.width = `${effectiveVol * 100}%`;
            }

            if (volumeSlider) {
                volumeSlider.setAttribute('aria-valuenow', Math.round(effectiveVol * 100));
                volumeSlider.setAttribute('aria-valuetext', `${Math.round(effectiveVol * 100)}% volume`);
            }

            if (volIcon) {
                if (isMuted || vol === 0) {
                    volIcon.innerHTML = '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>';
                } else if (vol < 0.5) {
                    volIcon.innerHTML = '<path d="M3 9v6h4l5 5V4L7 9H3zm10.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>';
                } else {
                    volIcon.innerHTML = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
                }
            }
        };

        this.player.onQueueUpdate = () => {
            this.renderQueueTab();
        };

        this.player.onSleepTimerTick = (remainingSecs, label) => {
            const badge = document.getElementById('topSleepBadge');
            if (!badge) return;
            if (label === 'End of track') {
                badge.style.display = 'inline';
                badge.textContent = 'Track';
            } else if (remainingSecs && remainingSecs > 0) {
                badge.style.display = 'inline';
                badge.textContent = this.formatTime(remainingSecs);
            } else {
                badge.style.display = 'none';
            }
        };

        this.player.onABLoopChange = (a, b, isLooping) => {
            const btn = document.getElementById('btnABLoop');
            if (!btn) return;
            if (isLooping && a !== null && b !== null) {
                btn.textContent = 'A-B';
                btn.classList.add('active');
            } else if (a !== null) {
                btn.textContent = 'A-..';
                btn.classList.add('active');
            } else {
                btn.textContent = 'A-B';
                btn.classList.remove('active');
            }
        };
    }

    updatePlayerUI(track, isPlaying = true) {
        if (!track) return;

        // Player Bar
        const thumb = document.getElementById('playerThumb');
        const title = document.getElementById('playerTitle');
        const artist = document.getElementById('playerArtist');
        const likeBtn = document.getElementById('btnPlayerLike');

        if (thumb) thumb.src = track.coverArt || '';
        if (title) title.textContent = track.title || 'Unknown Track';
        if (artist) artist.textContent = track.artist || 'Local Artist';

        const isLiked = StorageManager.isLiked(track.id);
        if (likeBtn) {
            likeBtn.classList.toggle('liked', isLiked);
            likeBtn.innerHTML = isLiked
                ? '<svg viewBox="0 0 24 24"><path fill="var(--spotify-green)" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>'
                : '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
        }

        // Right pane (Now Playing tab)
        const paneCover = document.getElementById('paneCoverImg');
        const paneTitle = document.getElementById('paneTrackTitle');
        const paneArtist = document.getElementById('paneTrackArtist');
        const paneBadge = document.getElementById('paneAudioBadge');

        if (paneCover) paneCover.src = track.coverArt || '';
        if (paneTitle) paneTitle.textContent = track.title || 'Unknown Track';
        if (paneArtist) paneArtist.textContent = track.artist || 'Local Artist';
        if (paneBadge) {
            const format = (track.format || 'audio').toUpperCase();
            const sizeMb = track.size ? ` • ${(track.size / (1024 * 1024)).toFixed(1)} MB` : '';
            paneBadge.textContent = `${format}${sizeMb}`;
        }

        // Fullscreen overlay
        const fsBackdrop = document.getElementById('fullscreenBackdrop');
        const fsCover = document.getElementById('fullscreenCover');
        const fsTitle = document.getElementById('fsTitle');
        const fsArtist = document.getElementById('fsArtist');

        if (fsBackdrop) fsBackdrop.style.backgroundImage = `url("${track.coverArt}")`;
        if (fsCover) fsCover.src = track.coverArt || '';
        if (fsTitle) fsTitle.textContent = track.title || 'Unknown Track';
        if (fsArtist) fsArtist.textContent = track.artist || 'Local Artist';

        // Update Lyrics Tab
        this.updateLyricsTab(track);
    }

    updateLyricsTab(track) {
        const lyricsBox = document.getElementById('paneLyricsText');
        const fsLyrics = document.getElementById('fullscreenLyrics');

        // Check for custom stored lyrics first
        const customLyrics = StorageManager.getLyrics(track.id);

        if (customLyrics) {
            // Check if LRC format: [00:12.34] lyric line
            const lrcRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/g;
            const matches = [...customLyrics.matchAll(lrcRegex)];

            if (matches.length > 0) {
                this.currentSyncedLyrics = matches.map(m => {
                    const mins = parseInt(m[1], 10);
                    const secs = parseInt(m[2], 10);
                    const ms = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) : 0;
                    return {
                        time: mins * 60 + secs + ms / 1000,
                        text: m[4].trim() || '♪'
                    };
                });

                const html = this.currentSyncedLyrics.map((item, idx) => `
                    <div class="lyric-line ${idx === 0 ? 'active-line' : ''}" data-idx="${idx}" style="margin-bottom: 12px; cursor: pointer;">
                        ${item.text}
                    </div>
                `).join('');

                if (lyricsBox) lyricsBox.innerHTML = html;
                if (fsLyrics) fsLyrics.innerHTML = html;

                // Click on lyric line seeks to that timestamp
                lyricsBox.querySelectorAll('.lyric-line').forEach(el => {
                    el.addEventListener('click', () => {
                        const idx = parseInt(el.dataset.idx, 10);
                        if (this.currentSyncedLyrics[idx]) {
                            this.player.seek(this.currentSyncedLyrics[idx].time);
                        }
                    });
                });
                return;
            } else {
                this.currentSyncedLyrics = null;
                const plainHtml = customLyrics.split('\n').map(line => `
                    <div style="margin-bottom: 8px;">${line || '&nbsp;'}</div>
                `).join('');
                if (lyricsBox) lyricsBox.innerHTML = plainHtml;
                if (fsLyrics) fsLyrics.innerHTML = plainHtml;
                return;
            }
        }

        // Fallback default lyrics view
        this.currentSyncedLyrics = null;
        const defaultLines = [
            `♪ Playing ${track.title} ♪`,
            `Artist: ${track.artist}`,
            `Album: ${track.album || 'Local Music'}`,
            `Click "Edit Song Info" to add custom lyrics.`
        ];

        const defaultHtml = defaultLines.map((line, idx) => `
            <div class="${idx === 0 ? 'active-line' : ''}" style="margin-bottom: 12px;">${line}</div>
        `).join('');

        if (lyricsBox) lyricsBox.innerHTML = defaultHtml;
        if (fsLyrics) {
            fsLyrics.innerHTML = defaultLines.map((l, i) => `<div class="${i === 0 ? 'fs-active-line' : ''}">${l}</div>`).join('');
        }
    }

    highlightSyncedLyric(currentTime) {
        if (!this.currentSyncedLyrics) return;
        let activeIdx = 0;
        for (let i = 0; i < this.currentSyncedLyrics.length; i++) {
            if (currentTime >= this.currentSyncedLyrics[i].time) {
                activeIdx = i;
            } else {
                break;
            }
        }

        const paneLines = document.querySelectorAll('#paneLyricsText .lyric-line');
        paneLines.forEach((line, idx) => {
            const isAct = idx === activeIdx;
            line.classList.toggle('active-line', isAct);
            if (isAct) {
                line.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    }

    /* ==========================================================================
       Navigation & Views
       ========================================================================== */
    setupNavigation() {
        const navHome = document.getElementById('navHome');
        const navSearch = document.getElementById('navSearch');
        const navLibrary = document.getElementById('navLibrary');
        const brandLogo = document.getElementById('brandLogo');

        brandLogo.addEventListener('click', () => this.switchView('home'));
        navHome.addEventListener('click', () => this.switchView('home'));
        navSearch.addEventListener('click', () => this.switchView('search'));
        navLibrary.addEventListener('click', () => this.switchView('library'));

        // Mobile bottom navigation items (< 768px)
        const mobHome = document.getElementById('mobNavHome');
        const mobSearch = document.getElementById('mobNavSearch');
        const mobLibrary = document.getElementById('mobNavLibrary');

        if (mobHome) mobHome.addEventListener('click', () => this.switchView('home'));
        if (mobSearch) mobSearch.addEventListener('click', () => this.switchView('search'));
        if (mobLibrary) mobLibrary.addEventListener('click', () => this.switchView('library'));

        // History buttons
        const btnBack = document.getElementById('btnHistoryBack');
        const btnFwd = document.getElementById('btnHistoryForward');

        btnBack.addEventListener('click', () => {
            if (this.historyIndex > 0) {
                this.historyIndex--;
                this.applyView(this.history[this.historyIndex]);
            }
        });

        btnFwd.addEventListener('click', () => {
            if (this.historyIndex < this.history.length - 1) {
                this.historyIndex++;
                this.applyView(this.history[this.historyIndex]);
            }
        });

        // Sidebar pinned items
        const sidebarLiked = document.getElementById('sidebarLikedSongs');
        sidebarLiked.addEventListener('click', () => this.openLikedSongsView());

        const sidebarOffline = document.getElementById('sidebarOfflineFolder');
        sidebarOffline.addEventListener('click', () => this.openOfflineFolderView());

        // Show all offline
        const btnViewAllOffline = document.getElementById('btnViewAllOffline');
        if (btnViewAllOffline) {
            btnViewAllOffline.addEventListener('click', () => this.openOfflineFolderView());
        }

        // Library filter pills
        document.querySelectorAll('.filter-pills .pill-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-pills .pill-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeFilter = btn.dataset.filter;
                this.renderLibraryView();
            });
        });
    }

    switchView(viewName) {
        if (this.history[this.historyIndex] !== viewName) {
            this.history = this.history.slice(0, this.historyIndex + 1);
            this.history.push(viewName);
            this.historyIndex = this.history.length - 1;
        }
        this.applyView(viewName);
    }

    applyView(viewName) {
        this.currentView = viewName;

        // Nav active class
        const navH = document.getElementById('navHome');
        const navS = document.getElementById('navSearch');
        const navL = document.getElementById('navLibrary');
        if (navH) navH.classList.toggle('active', viewName === 'home');
        if (navS) navS.classList.toggle('active', viewName === 'search');
        if (navL) navL.classList.toggle('active', viewName === 'library');

        // Mobile bottom nav active class
        const mobH = document.getElementById('mobNavHome');
        const mobS = document.getElementById('mobNavSearch');
        const mobL = document.getElementById('mobNavLibrary');
        if (mobH) mobH.classList.toggle('active', viewName === 'home');
        if (mobS) mobS.classList.toggle('active', viewName === 'search');
        if (mobL) mobL.classList.toggle('active', viewName === 'library');

        // Toggle Top Search input visibility
        const topSearch = document.getElementById('topSearchContainer');
        topSearch.style.display = viewName === 'search' ? 'flex' : 'none';
        if (viewName === 'search') {
            document.getElementById('mainSearchInput').focus();
        }

        // Show view section
        document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));

        if (viewName === 'home') {
            document.getElementById('homeView').classList.add('active');
            this.renderHomeView();
        } else if (viewName === 'search') {
            document.getElementById('searchView').classList.add('active');
        } else if (viewName === 'library') {
            document.getElementById('libraryView').classList.add('active');
            this.renderLibraryView();
        } else if (viewName === 'playlist') {
            document.getElementById('playlistView').classList.add('active');
        }

        // Scroll main to top
        document.getElementById('viewContainer').scrollTop = 0;
    }

    /* ==========================================================================
       Home View Rendering
       ========================================================================== */
    renderHomeView() {
        this.updateGreeting();

        // 1. Quick picks (top 6)
        const quickGrid = document.getElementById('quickPicksGrid');
        quickGrid.innerHTML = '';
        const quickPicks = this.allTracks.slice(0, 6);

        // Always add Liked Songs card
        const likedCard = document.createElement('div');
        likedCard.className = 'quick-card';
        likedCard.innerHTML = `
            <div class="library-item-thumb liked-gradient" style="width: 64px; height: 64px; border-radius: 4px 0 0 4px;">
                <svg viewBox="0 0 24 24" style="width: 28px; height: 28px; fill: #fff;"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            </div>
            <div class="quick-card-title">Liked Songs</div>
            <button class="quick-card-play" title="Play Liked Songs">
                <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </button>
        `;
        likedCard.addEventListener('click', (e) => {
            if (e.target.closest('.quick-card-play')) {
                this.playLikedSongs();
            } else {
                this.openLikedSongsView();
            }
        });
        quickGrid.appendChild(likedCard);

        quickPicks.forEach((track, idx) => {
            const card = document.createElement('div');
            card.className = 'quick-card';
            card.innerHTML = `
                <img src="${track.coverArt}" class="quick-card-img" alt="${track.title}">
                <div class="quick-card-title">${track.title}</div>
                <button class="quick-card-play" title="Play">
                    <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </button>
            `;
            card.addEventListener('click', () => {
                this.player.setQueue(this.allTracks, idx);
            });
            quickGrid.appendChild(card);
        });

        // 2. Tracks Grid
        const offlineGrid = document.getElementById('offlineTracksGrid');
        offlineGrid.innerHTML = '';
        this.allTracks.slice(0, 10).forEach((track, idx) => {
            const card = this.createSongCard(track, () => {
                this.player.setQueue(this.allTracks, idx);
            });
            offlineGrid.appendChild(card);
        });

        // 3. Recently Played Grid
        const recentIds = StorageManager.getRecentlyPlayed();
        const recentSection = document.getElementById('recentHeader');
        const recentGrid = document.getElementById('recentlyPlayedGrid');
        recentGrid.innerHTML = '';

        const recentTracks = recentIds
            .map(id => this.allTracks.find(t => t.id === id))
            .filter(Boolean);

        if (recentTracks.length > 0) {
            recentSection.style.display = 'flex';
            recentTracks.slice(0, 6).forEach((track) => {
                const card = this.createSongCard(track, () => {
                    this.player.setQueue(recentTracks, recentTracks.indexOf(track));
                });
                recentGrid.appendChild(card);
            });
        } else {
            recentSection.style.display = 'none';
        }

        // 4. Mixes
        const mixesGrid = document.getElementById('mixesGrid');
        mixesGrid.innerHTML = '';
        const mixes = [
            { title: 'Chill Mix', desc: 'Relaxing tunes', color: '#1db954' },
            { title: 'Synthwave Night', desc: 'Retro electro vibes', color: '#8400e7' },
            { title: 'Daily Drive', desc: 'Upbeat tracks for your journey', color: '#27856a' },
            { title: 'Focus Flow', desc: 'Ambient and lo-fi melodies', color: '#e91429' }
        ];

        mixes.forEach((mix) => {
            const card = document.createElement('div');
            card.className = 'spotify-card';
            card.innerHTML = `
                <div class="card-img-wrap" style="background: linear-gradient(135deg, ${mix.color}, #121212); display: flex; align-items: center; justify-content: center;">
                    <svg viewBox="0 0 24 24" style="width: 60px; height: 60px; fill: rgba(255,255,255,0.7);"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                    <button class="card-play-btn" title="Play Mix">
                        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                </div>
                <div class="card-title">${mix.title}</div>
                <div class="card-sub">${mix.desc}</div>
            `;
            card.addEventListener('click', () => {
                if (this.allTracks.length > 0) {
                    this.player.setQueue(this.allTracks, 0);
                    this.showToast(`Playing ${mix.title}`);
                }
            });
            mixesGrid.appendChild(card);
        });
    }

    createSongCard(track, onPlay) {
        const card = document.createElement('div');
        card.className = 'spotify-card';
        card.innerHTML = `
            <div class="card-img-wrap">
                <img src="${track.coverArt}" class="card-img" alt="${track.title}">
                <button class="card-play-btn" title="Play">
                    <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </button>
            </div>
            <div class="card-title">${track.title}</div>
            <div class="card-sub">${track.artist}</div>
        `;
        card.addEventListener('click', () => {
            onPlay();
        });
        return card;
    }

    /* ==========================================================================
       Dedicated Folder View & Liked Songs View
       ========================================================================== */
    openOfflineFolderView() {
        this.activePlaylist = {
            id: 'offline_folder',
            title: 'My Songs Folder',
            desc: 'Tracks loaded directly from your dedicated local songs folder.',
            coverArt: 'folder',
            tracks: this.allTracks
        };

        const heroCover = document.getElementById('heroCover');
        heroCover.src = MetadataParser.generateCoverArt('My Songs', 'Folder');
        document.getElementById('heroTag').textContent = 'LOCAL FOLDER';
        document.getElementById('heroTitle').textContent = 'My Songs Folder';
        document.getElementById('heroDesc').textContent = 'Direct disk playback with zero internet required.';
        document.getElementById('heroOwner').textContent = 'Local User';
        document.getElementById('heroStats').textContent = `${this.allTracks.length} tracks`;

        this.renderTrackTable('playlistTracksTbody', this.allTracks);

        const heroPlay = document.getElementById('btnHeroPlay');
        heroPlay.onclick = () => {
            if (this.allTracks.length > 0) this.player.setQueue(this.allTracks, 0);
        };

        this.switchView('playlist');
    }

    openLikedSongsView() {
        const likedIds = StorageManager.getLikedSongIds();
        const likedTracks = likedIds
            .map(id => this.allTracks.find(t => t.id === id))
            .filter(Boolean);

        this.activePlaylist = {
            id: 'liked_songs',
            title: 'Liked Songs',
            desc: 'Your favorite tracks.',
            coverArt: 'liked',
            tracks: likedTracks
        };

        const heroCover = document.getElementById('heroCover');
        heroCover.src = MetadataParser.generateCoverArt('♥ Liked Songs', 'Favorites');
        document.getElementById('heroTag').textContent = 'PLAYLIST';
        document.getElementById('heroTitle').textContent = 'Liked Songs';
        document.getElementById('heroDesc').textContent = 'All your favorite songs kept ready.';
        document.getElementById('heroOwner').textContent = 'Local User';
        document.getElementById('heroStats').textContent = `${likedTracks.length} songs`;

        this.renderTrackTable('playlistTracksTbody', likedTracks);

        const heroPlay = document.getElementById('btnHeroPlay');
        heroPlay.onclick = () => {
            if (likedTracks.length > 0) this.player.setQueue(likedTracks, 0);
            else this.showToast('No liked songs yet! Click the heart on any song.');
        };

        this.switchView('playlist');
    }

    playLikedSongs() {
        const likedIds = StorageManager.getLikedSongIds();
        const likedTracks = likedIds
            .map(id => this.allTracks.find(t => t.id === id))
            .filter(Boolean);

        if (likedTracks.length > 0) {
            this.player.setQueue(likedTracks, 0);
        } else {
            this.openLikedSongsView();
        }
    }

    /* ==========================================================================
       Render Track Table
       ========================================================================== */
    renderTrackTable(tbodyId, tracks) {
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        tbody.innerHTML = '';

        if (!tracks || tracks.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; padding: 48px; color: var(--text-secondary);">
                        <svg viewBox="0 0 24 24" style="width: 48px; height: 48px; fill: var(--text-muted); margin-bottom: 12px;"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                        <div style="font-size: 16px; font-weight: 700; color: #fff;">No tracks here yet</div>
                        <div style="font-size: 13px; margin-top: 4px;">Click "Open Music Folder" or drop music files into the window!</div>
                    </td>
                </tr>
            `;
            return;
        }

        tracks.forEach((track, index) => {
            const isPlayingThis = this.player.currentTrack && this.player.currentTrack.id === track.id;
            const isLiked = StorageManager.isLiked(track.id);

            const tr = document.createElement('tr');
            tr.className = `track-row ${isPlayingThis ? 'active' : ''}`;
            tr.dataset.trackId = track.id;

            tr.innerHTML = `
                <td class="track-num-cell col-num">
                    <span class="row-index">${index + 1}</span>
                    <button class="row-play-btn" title="Play ${track.title}" aria-label="Play ${track.title}">
                        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                </td>
                <td class="col-title">
                    <div class="track-title-cell">
                        <img src="${track.coverArt}" class="track-table-thumb" alt="${track.title}">
                        <div class="track-title-meta">
                            <div class="track-meta-title">${track.title}</div>
                            <div class="track-meta-artist">${track.artist}</div>
                        </div>
                    </div>
                </td>
                <td class="col-album">${track.album || 'Local Music'}</td>
                <td class="col-time" style="text-align: right; font-variant-numeric: tabular-nums;">
                    ${track.duration ? this.formatTime(track.duration) : '--:--'}
                </td>
                <td class="track-action-cell col-actions" style="display: flex; align-items: center; justify-content: flex-end; gap: 8px;">
                    <button class="btn-track-heart ${isLiked ? 'liked' : ''}" title="${isLiked ? 'Remove from Liked' : 'Save to Liked'}" aria-label="${isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}">
                        <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                    </button>
                    <button class="track-options-btn" title="Edit song details & lyrics" aria-label="Edit song details and lyrics">
                        <svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                    </button>
                </td>
            `;

            // Row click plays track
            tr.addEventListener('click', (e) => {
                if (e.target.closest('.btn-track-heart')) {
                    const liked = StorageManager.toggleLike(track.id);
                    const heartBtn = tr.querySelector('.btn-track-heart');
                    heartBtn.classList.toggle('liked', liked);
                    this.updateLibraryCounters();
                    this.showToast(liked ? 'Added to Liked Songs' : 'Removed from Liked Songs');
                    if (this.player.currentTrack && this.player.currentTrack.id === track.id) {
                        this.updatePlayerUI(track, this.player.isPlaying);
                    }
                    return;
                }
                if (e.target.closest('.track-options-btn')) {
                    this.openTagEditor(track);
                    return;
                }
                this.player.setQueue(tracks, index);
            });

            tbody.appendChild(tr);
        });
    }

    updateActiveTrackInTables(currentTrackId) {
        document.querySelectorAll('.track-row').forEach(row => {
            row.classList.toggle('active', row.dataset.trackId === currentTrackId);
        });
    }

    /* ==========================================================================
       Library View
       ========================================================================== */
    renderLibraryView() {
        let displayTracks = [...this.allTracks];

        if (this.activeFilter === 'offline') {
            displayTracks = this.allTracks;
        } else if (this.activeFilter === 'playlists') {
            displayTracks = this.allTracks;
        }

        // Apply search filter if active
        const filterInput = document.getElementById('libraryFilterInput');
        if (filterInput && filterInput.value.trim()) {
            const q = filterInput.value.trim().toLowerCase();
            displayTracks = displayTracks.filter(t =>
                (t.title && t.title.toLowerCase().includes(q)) ||
                (t.artist && t.artist.toLowerCase().includes(q)) ||
                (t.album && t.album.toLowerCase().includes(q))
            );
        }

        // Apply sorting
        const sortSelect = document.getElementById('librarySortSelect');
        if (sortSelect) {
            displayTracks = this.applySorting(displayTracks, sortSelect.value);
        }

        this.renderTrackTable('libraryTracksTbody', displayTracks);
    }

    applySorting(tracks, sortMode) {
        const sorted = [...tracks];
        if (sortMode === 'title_asc') {
            sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        } else if (sortMode === 'artist_asc') {
            sorted.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
        } else if (sortMode === 'duration_desc') {
            sorted.sort((a, b) => (b.duration || 0) - (a.duration || 0));
        } else if (sortMode === 'duration_asc') {
            sorted.sort((a, b) => (a.duration || 0) - (b.duration || 0));
        }
        return sorted;
    }

    setupSortingAndFiltering() {
        const libInput = document.getElementById('libraryFilterInput');
        const libSort = document.getElementById('librarySortSelect');

        if (libInput) {
            libInput.addEventListener('input', () => this.renderLibraryView());
        }
        if (libSort) {
            libSort.addEventListener('change', () => this.renderLibraryView());
        }

        const plInput = document.getElementById('playlistFilterInput');
        const plSort = document.getElementById('playlistSortSelect');

        const updatePlaylistFiltered = () => {
            if (!this.activePlaylist) return;
            let tracks = [...this.activePlaylist.tracks];
            if (plInput && plInput.value.trim()) {
                const q = plInput.value.trim().toLowerCase();
                tracks = tracks.filter(t =>
                    (t.title && t.title.toLowerCase().includes(q)) ||
                    (t.artist && t.artist.toLowerCase().includes(q))
                );
            }
            if (plSort) {
                tracks = this.applySorting(tracks, plSort.value);
            }
            this.renderTrackTable('playlistTracksTbody', tracks);
        };

        if (plInput) plInput.addEventListener('input', updatePlaylistFiltered);
        if (plSort) plSort.addEventListener('change', updatePlaylistFiltered);
    }

    /* ==========================================================================
       Search & Categories
       ========================================================================== */
    setupSearch() {
        const input = document.getElementById('mainSearchInput');
        const clearBtn = document.getElementById('btnClearSearch');
        const searchResultsSection = document.getElementById('searchResultsSection');
        const browseCategoriesSection = document.getElementById('browseCategoriesSection');

        input.addEventListener('input', () => {
            const q = input.value.trim().toLowerCase();
            clearBtn.classList.toggle('visible', q.length > 0);

            if (q.length === 0) {
                searchResultsSection.style.display = 'none';
                browseCategoriesSection.style.display = 'block';
                return;
            }

            searchResultsSection.style.display = 'block';
            browseCategoriesSection.style.display = 'none';

            // Filter all tracks
            const results = this.allTracks.filter(t => 
                (t.title && t.title.toLowerCase().includes(q)) ||
                (t.artist && t.artist.toLowerCase().includes(q)) ||
                (t.album && t.album.toLowerCase().includes(q))
            );

            this.renderTrackTable('searchResultsTbody', results);
        });

        clearBtn.addEventListener('click', () => {
            input.value = '';
            clearBtn.classList.remove('visible');
            searchResultsSection.style.display = 'none';
            browseCategoriesSection.style.display = 'block';
        });
    }

    renderBrowseCategories() {
        const grid = document.getElementById('browseCategoriesGrid');
        if (!grid) return;
        grid.innerHTML = '';

        const categories = [
            { name: 'Pop', color: '#8d67ab' },
            { name: 'Lo-Fi Chill', color: '#e8115b' },
            { name: 'Synthwave', color: '#1e3264' },
            { name: 'Electronic', color: '#ba5d07' },
            { name: 'Rock & Metal', color: '#e91429' },
            { name: 'Hip-Hop', color: '#bc5900' },
            { name: 'Workout', color: '#777777' },
            { name: 'Indie & Acoustic', color: '#503750' }
        ];

        categories.forEach(cat => {
            const card = document.createElement('div');
            card.className = 'browse-card';
            card.style.backgroundColor = cat.color;
            card.innerHTML = `
                <span>${cat.name}</span>
                <img src="${MetadataParser.generateCoverArt(cat.name, 'Genre')}" class="browse-card-decor" alt="${cat.name}">
            `;
            card.addEventListener('click', () => {
                this.showToast(`Browsing ${cat.name}`);
                this.openOfflineFolderView();
            });
            grid.appendChild(card);
        });
    }

    /* ==========================================================================
       Dedicated Folder & File Imports
       ========================================================================== */
    setupFolderInput() {
        const folderInput = document.getElementById('folderInput');
        const fileInput = document.getElementById('fileInput');

        const btnChooseTop = document.getElementById('btnChooseFolderTop');
        const btnPickSide = document.getElementById('btnPickFolderSide');

        const openFolderPicker = () => {
            folderInput.click();
        };

        if (btnChooseTop) btnChooseTop.addEventListener('click', openFolderPicker);
        if (btnPickSide) btnPickSide.addEventListener('click', openFolderPicker);

        folderInput.addEventListener('change', (e) => {
            this.handleFilesImport(Array.from(e.target.files));
        });

        fileInput.addEventListener('change', (e) => {
            this.handleFilesImport(Array.from(e.target.files));
        });
    }

    setupDragAndDrop() {
        const overlay = document.getElementById('dropzoneOverlay');
        let dragCounter = 0;

        window.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCounter++;
            overlay.classList.add('active');
        });

        window.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                overlay.classList.remove('active');
            }
        });

        window.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        window.addEventListener('drop', async (e) => {
            e.preventDefault();
            dragCounter = 0;
            overlay.classList.remove('active');

            const files = [];
            if (e.dataTransfer.items) {
                for (const item of e.dataTransfer.items) {
                    if (item.kind === 'file') {
                        const file = item.getAsFile();
                        if (file) files.push(file);
                    }
                }
            } else if (e.dataTransfer.files) {
                files.push(...Array.from(e.dataTransfer.files));
            }

            if (files.length > 0) {
                await this.handleFilesImport(files);
            }
        });
    }

    async handleFilesImport(files) {
        const audioExtensions = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'];
        const audioFiles = files.filter(f => {
            const ext = f.name.split('.').pop().toLowerCase();
            return audioExtensions.includes(ext) || f.type.startsWith('audio/');
        });

        if (audioFiles.length === 0) {
            this.showToast('No supported audio files found.');
            return;
        }

        this.showToast(`Importing ${audioFiles.length} song${audioFiles.length === 1 ? '' : 's'}...`);

        const newTracks = [];
        for (let i = 0; i < audioFiles.length; i++) {
            const file = audioFiles[i];
            const meta = await MetadataParser.parse(file);

            const trackObj = {
                id: `track_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 5)}`,
                title: meta.title || file.name,
                artist: meta.artist || 'Local Artist',
                album: meta.album || 'Local Music',
                year: meta.year,
                genre: meta.genre,
                duration: meta.duration,
                coverArt: meta.coverArt,
                format: meta.format,
                size: file.size,
                file: file
            };

            newTracks.push(trackObj);
        }

        // Save to IndexedDB
        await StorageManager.saveTracks(newTracks);

        // Prepend to current list
        this.allTracks = [...newTracks, ...this.allTracks];
        this.updateLibraryCounters();
        this.renderHomeView();
        this.renderLibraryView();

        this.showToast(`✓ Added ${newTracks.length} song${newTracks.length === 1 ? '' : 's'} to Library!`);

        // If player is idle, queue up newly added tracks and start playing
        if (!this.player.isPlaying) {
            this.player.setQueue(this.allTracks, 0);
        }
    }

    /* ==========================================================================
       Player Bar Controls & Scrubber
       ========================================================================== */
    setupControls() {
        const btnPlayPause = document.getElementById('btnPlayPause');
        const btnNext = document.getElementById('btnNext');
        const btnPrevious = document.getElementById('btnPrevious');
        const btnShuffle = document.getElementById('btnShuffle');
        const btnRepeat = document.getElementById('btnRepeat');
        const btnLike = document.getElementById('btnPlayerLike');

        btnPlayPause.addEventListener('click', () => {
            if (!this.player.audio.src && this.allTracks.length > 0) {
                this.player.setQueue(this.allTracks, 0);
            } else {
                this.player.togglePlay();
            }
        });

        btnNext.addEventListener('click', () => {
            if (this.player.queue.length === 0 && this.allTracks.length > 0) {
                this.player.setQueue(this.allTracks, 0, true);
            } else {
                this.player.next();
            }
        });

        btnPrevious.addEventListener('click', () => {
            if (this.player.queue.length === 0 && this.allTracks.length > 0) {
                this.player.setQueue(this.allTracks, 0, true);
            } else {
                this.player.previous();
            }
        });

        btnShuffle.addEventListener('click', () => {
            this.player.toggleShuffle();
            btnShuffle.classList.toggle('active', this.player.isShuffled);
            this.showToast(this.player.isShuffled ? 'Shuffle on' : 'Shuffle off');
        });

        btnRepeat.addEventListener('click', () => {
            const mode = this.player.toggleRepeat();
            btnRepeat.classList.toggle('active', mode !== 'off');
            this.showToast(`Repeat: ${mode}`);
        });

        btnLike.addEventListener('click', () => {
            if (!this.player.currentTrack) return;
            const liked = StorageManager.toggleLike(this.player.currentTrack.id);
            this.updatePlayerUI(this.player.currentTrack, this.player.isPlaying);
            this.updateLibraryCounters();
            this.showToast(liked ? 'Added to Liked Songs' : 'Removed from Liked Songs');
        });

        // Timeline Seek Scrubber with Pointer Events & Keyboard Accessibility
        const seekSlider = document.getElementById('seekSlider');
        const seekProgress = document.getElementById('seekProgress');
        const mobProgress = document.getElementById('mobileProgressBar');
        const timeCurrent = document.getElementById('timeCurrent');
        let seekTargetTime = 0;

        const calculateSeekPos = (clientX) => {
            const rect = seekSlider.getBoundingClientRect();
            if (rect.width <= 0) return 0;
            return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        };

        const updateSeekVisual = (pos) => {
            const duration = this.player.duration || 0;
            seekTargetTime = pos * duration;
            const percent = pos * 100;
            if (seekProgress) seekProgress.style.width = `${percent}%`;
            if (mobProgress) mobProgress.style.width = `${percent}%`;
            if (timeCurrent) timeCurrent.textContent = this.formatTime(seekTargetTime);
            if (seekSlider) {
                seekSlider.setAttribute('aria-valuenow', Math.round(seekTargetTime));
                seekSlider.setAttribute('aria-valuetext', `${this.formatTime(seekTargetTime)} of ${this.formatTime(duration)}`);
            }
        };

        seekSlider.addEventListener('pointerdown', (e) => {
            this.isSeeking = true;
            try {
                seekSlider.setPointerCapture(e.pointerId);
            } catch (err) {}
            const pos = calculateSeekPos(e.clientX);
            updateSeekVisual(pos);
        });

        seekSlider.addEventListener('pointermove', (e) => {
            if (!this.isSeeking) return;
            const pos = calculateSeekPos(e.clientX);
            updateSeekVisual(pos);
        });

        const finishSeek = (e) => {
            if (!this.isSeeking) return;
            const pos = calculateSeekPos(e.clientX);
            updateSeekVisual(pos);
            const duration = this.player.duration || 0;
            if (duration > 0) {
                this.player.seek(seekTargetTime);
            }
            this.isSeeking = false;
            try {
                if (seekSlider.hasPointerCapture(e.pointerId)) {
                    seekSlider.releasePointerCapture(e.pointerId);
                }
            } catch (err) {}
        };

        seekSlider.addEventListener('pointerup', finishSeek);
        seekSlider.addEventListener('pointercancel', (e) => {
            this.isSeeking = false;
            try {
                if (seekSlider.hasPointerCapture(e.pointerId)) {
                    seekSlider.releasePointerCapture(e.pointerId);
                }
            } catch (err) {}
        });

        // Seek keyboard accessibility
        seekSlider.addEventListener('keydown', (e) => {
            const duration = this.player.duration || 0;
            if (duration <= 0) return;
            let handled = false;
            if (e.key === 'ArrowRight') {
                this.player.seek(this.player.currentTime + 5);
                handled = true;
            } else if (e.key === 'ArrowLeft') {
                this.player.seek(this.player.currentTime - 5);
                handled = true;
            } else if (e.key === 'Home') {
                this.player.seek(0);
                handled = true;
            } else if (e.key === 'End') {
                this.player.seek(Math.max(0, duration - 1));
                handled = true;
            }
            if (handled) {
                e.preventDefault();
                e.stopPropagation();
            }
        });

        // Volume Slider with Pointer Events & Keyboard Accessibility
        const volumeSlider = document.getElementById('volumeSlider');
        const volProgress = document.getElementById('volumeProgress');
        const btnMute = document.getElementById('btnVolumeMute');

        btnMute.addEventListener('click', () => {
            this.player.toggleMute();
        });

        const calculateVolPos = (clientX) => {
            const rect = volumeSlider.getBoundingClientRect();
            if (rect.width <= 0) return 0;
            return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        };

        const applyVolumeChange = (pos) => {
            const clamped = Math.max(0, Math.min(1, pos));
            this.player.setVolume(clamped);
            if (volProgress) volProgress.style.width = `${clamped * 100}%`;
            volumeSlider.setAttribute('aria-valuenow', Math.round(clamped * 100));
            volumeSlider.setAttribute('aria-valuetext', `${Math.round(clamped * 100)}% volume`);
        };

        volumeSlider.addEventListener('pointerdown', (e) => {
            this.isVolSeeking = true;
            try {
                volumeSlider.setPointerCapture(e.pointerId);
            } catch (err) {}
            const pos = calculateVolPos(e.clientX);
            applyVolumeChange(pos);
        });

        volumeSlider.addEventListener('pointermove', (e) => {
            if (!this.isVolSeeking) return;
            const pos = calculateVolPos(e.clientX);
            applyVolumeChange(pos);
        });

        const finishVolSeek = (e) => {
            if (!this.isVolSeeking) return;
            const pos = calculateVolPos(e.clientX);
            applyVolumeChange(pos);
            this.isVolSeeking = false;
            try {
                if (volumeSlider.hasPointerCapture(e.pointerId)) {
                    volumeSlider.releasePointerCapture(e.pointerId);
                }
            } catch (err) {}
        };

        volumeSlider.addEventListener('pointerup', finishVolSeek);
        volumeSlider.addEventListener('pointercancel', (e) => {
            this.isVolSeeking = false;
            try {
                if (volumeSlider.hasPointerCapture(e.pointerId)) {
                    volumeSlider.releasePointerCapture(e.pointerId);
                }
            } catch (err) {}
        });

        // Volume slider keyboard accessibility
        volumeSlider.addEventListener('keydown', (e) => {
            let handled = false;
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                this.player.setVolume(this.player.volume + 0.05);
                handled = true;
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                this.player.setVolume(this.player.volume - 0.05);
                handled = true;
            } else if (e.key === 'Home') {
                this.player.setVolume(0);
                handled = true;
            } else if (e.key === 'End') {
                this.player.setVolume(1.0);
                handled = true;
            }
            if (handled) {
                e.preventDefault();
                e.stopPropagation();
            }
        });

        // Mobile Player Left Area Tap to open Fullscreen Modal
        const playerLeftArea = document.getElementById('playerLeftArea');
        if (playerLeftArea) {
            playerLeftArea.addEventListener('click', (e) => {
                if (e.target.closest('#btnPlayerLike')) return;
                // On mobile / tablet screens (< 768px), opening fullscreen modal provides full controls
                if (window.innerWidth < 768) {
                    const fsModal = document.getElementById('fullscreenModal');
                    if (fsModal) fsModal.classList.add('active');
                }
            });
        }

        // Right pane toggles
        document.getElementById('btnToggleLyrics').addEventListener('click', () => this.toggleRightPane('lyrics'));
        document.getElementById('btnToggleQueue').addEventListener('click', () => this.toggleRightPane('queue'));
        document.getElementById('btnCloseRightPane').addEventListener('click', () => this.closeRightPane());

        // Top visualizer toggle button
        document.getElementById('btnToggleVisualizerTop').addEventListener('click', () => {
            const modes = ['bars', 'wave', 'circle'];
            const nextMode = modes[(modes.indexOf(this.visualizer.mode) + 1) % modes.length];
            this.visualizer.setMode(nextMode);
            this.showToast(`Visualizer mode: ${nextMode}`);
        });

        // Edit Song info button in Now Playing pane
        const btnEditCurrent = document.getElementById('btnEditCurrentTrackInfo');
        if (btnEditCurrent) {
            btnEditCurrent.addEventListener('click', () => {
                if (this.player.currentTrack) {
                    this.openTagEditor(this.player.currentTrack);
                }
            });
        }

        // Edit Lyrics button in pane header
        const btnEditLyricsRight = document.getElementById('btnEditLyricsRight');
        if (btnEditLyricsRight) {
            btnEditLyricsRight.addEventListener('click', () => {
                if (this.player.currentTrack) {
                    this.openTagEditor(this.player.currentTrack);
                }
            });
        }
    }

    /* ==========================================================================
       Theme Palette Switcher
       ========================================================================== */
    setupThemePicker() {
        const btnToggle = document.getElementById('btnToggleThemePicker');
        const dropdown = document.getElementById('themeDropdown');

        btnToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('active');
        });

        document.querySelectorAll('.theme-swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                const color = swatch.dataset.color;
                document.documentElement.style.setProperty('--theme-accent', color);
                StorageManager.setThemeAccent(color);
                this.visualizer.setThemeColor(color);
                dropdown.classList.remove('active');
                this.showToast(`Theme updated!`);
            });
        });

        window.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && e.target !== btnToggle) {
                dropdown.classList.remove('active');
            }
        });
    }

    /* ==========================================================================
       Sleep Timer
       ========================================================================== */
    setupSleepTimer() {
        const modal = document.getElementById('sleepTimerModal');
        const btnOpen = document.getElementById('btnOpenSleepTimer');
        const btnClose = document.getElementById('btnCloseSleepModal');
        const btnCancel = document.getElementById('btnCancelSleepTimer');

        btnOpen.addEventListener('click', () => {
            modal.classList.add('active');
        });

        btnClose.addEventListener('click', () => {
            modal.classList.remove('active');
        });

        btnCancel.addEventListener('click', () => {
            this.player.cancelSleepTimer();
            modal.classList.remove('active');
            this.showToast('Sleep timer turned off');
        });

        document.querySelectorAll('.sleep-option-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mins = btn.dataset.mins;
                if (mins === 'end_of_track') {
                    this.player.startSleepTimer('end_of_track');
                    this.showToast('Sleep timer: stop after this song');
                } else {
                    const parsedMins = parseInt(mins, 10);
                    this.player.startSleepTimer(parsedMins);
                    this.showToast(`Sleep timer set for ${parsedMins} minutes`);
                }
                modal.classList.remove('active');
            });
        });
    }

    /* ==========================================================================
       Playback Speed Control
       ========================================================================== */
    setupSpeedControl() {
        const btn = document.getElementById('btnPlaybackSpeed');
        const speeds = [1.0, 1.25, 1.5, 2.0, 0.5, 0.75];

        btn.addEventListener('click', () => {
            const currentSpeed = this.player.playbackRate;
            let nextIndex = speeds.indexOf(currentSpeed) + 1;
            if (nextIndex >= speeds.length) nextIndex = 0;
            const newSpeed = speeds[nextIndex];

            this.player.setPlaybackRate(newSpeed);
            btn.textContent = `${newSpeed}x`;
            this.showToast(`Speed: ${newSpeed}x`);
        });
    }

    /* ==========================================================================
       A-B Section Looper
       ========================================================================== */
    setupABLooper() {
        const btn = document.getElementById('btnABLoop');

        btn.addEventListener('click', () => {
            if (this.player.loopA === null) {
                const a = this.player.setLoopA();
                this.showToast(`Loop Point A: ${this.formatTime(a)}`);
            } else if (!this.player.isLoopingAB) {
                const b = this.player.setLoopB();
                this.showToast(`Looping ${this.formatTime(this.player.loopA)} ⇄ ${this.formatTime(b)}`);
            } else {
                this.player.clearLoopAB();
                this.showToast('Loop cleared');
            }
        });
    }

    /* ==========================================================================
       Song Details & Tag Editor
       ========================================================================== */
    setupTagEditor() {
        const modal = document.getElementById('tagEditorModal');
        const btnClose = document.getElementById('btnCloseTagModal');
        const btnCancel = document.getElementById('btnCancelTagEdit');
        const btnSave = document.getElementById('btnSaveTagEdit');

        const inputId = document.getElementById('editTrackId');
        const inputTitle = document.getElementById('editTitleInput');
        const inputArtist = document.getElementById('editArtistInput');
        const inputAlbum = document.getElementById('editAlbumInput');
        const inputLyrics = document.getElementById('editLyricsInput');

        btnClose.addEventListener('click', () => modal.classList.remove('active'));
        btnCancel.addEventListener('click', () => modal.classList.remove('active'));

        btnSave.addEventListener('click', () => {
            const trackId = inputId.value;
            const track = this.allTracks.find(t => t.id === trackId);
            if (!track) return;

            const newTitle = inputTitle.value.trim() || track.title;
            const newArtist = inputArtist.value.trim() || track.artist;
            const newAlbum = inputAlbum.value.trim() || track.album;
            const newLyrics = inputLyrics.value;

            track.title = newTitle;
            track.artist = newArtist;
            track.album = newAlbum;

            // Save overrides and lyrics
            StorageManager.saveTrackOverride(trackId, {
                title: newTitle,
                artist: newArtist,
                album: newAlbum
            });

            StorageManager.saveLyrics(trackId, newLyrics);

            modal.classList.remove('active');
            this.showToast('Track details and lyrics updated!');

            // Update UI
            if (this.player.currentTrack && this.player.currentTrack.id === trackId) {
                this.updatePlayerUI(track, this.player.isPlaying);
            }
            this.renderHomeView();
            this.renderLibraryView();
            if (this.currentView === 'playlist') {
                this.renderTrackTable('playlistTracksTbody', this.activePlaylist ? this.activePlaylist.tracks : this.allTracks);
            }
        });
    }

    openTagEditor(track) {
        if (!track) return;
        const modal = document.getElementById('tagEditorModal');
        document.getElementById('editTrackId').value = track.id;
        document.getElementById('editTitleInput').value = track.title || '';
        document.getElementById('editArtistInput').value = track.artist || '';
        document.getElementById('editAlbumInput').value = track.album || '';

        const lyrics = StorageManager.getLyrics(track.id) || '';
        document.getElementById('editLyricsInput').value = lyrics;

        modal.classList.add('active');
    }

    /* ==========================================================================
       Backup & Restore
       ========================================================================== */
    setupBackupRestore() {
        const btnExport = document.getElementById('btnExportBackup');
        const btnImport = document.getElementById('btnImportBackup');
        const fileInput = document.getElementById('backupFileInput');

        if (btnExport) {
            btnExport.addEventListener('click', async () => {
                await StorageManager.exportBackup();
                this.showToast('Exported backup successfully!');
            });
        }

        if (btnImport && fileInput) {
            btnImport.addEventListener('click', () => fileInput.click());

            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = async (evt) => {
                    const success = await StorageManager.importBackup(evt.target.result);
                    if (success) {
                        this.playlists = await StorageManager.getPlaylists();
                        const savedAccent = StorageManager.getThemeAccent();
                        document.documentElement.style.setProperty('--theme-accent', savedAccent);
                        this.visualizer.setThemeColor(savedAccent);
                        this.updateLibraryCounters();
                        this.renderSidebarPlaylists();
                        this.renderHomeView();
                        this.renderLibraryView();
                        this.showToast('✓ Library backup restored successfully!');
                    } else {
                        this.showToast('Failed to import backup file.');
                    }
                };
                reader.readAsText(file);
            });
        }
    }

    /* ==========================================================================
       Right Pane (Now Playing / Queue / Lyrics)
       ========================================================================== */
    toggleRightPane(tabName) {
        const layout = document.getElementById('mainLayout');
        const pane = document.getElementById('rightPane');

        if (this.isRightPaneOpen && this.rightPaneTab === tabName) {
            this.closeRightPane();
            return;
        }

        this.isRightPaneOpen = true;
        this.rightPaneTab = tabName;
        layout.classList.add('with-right-pane');
        pane.classList.add('visible');

        document.getElementById('paneNowPlaying').style.display = tabName === 'now-playing' ? 'flex' : 'none';
        document.getElementById('paneQueue').style.display = tabName === 'queue' ? 'flex' : 'none';
        document.getElementById('paneLyrics').style.display = tabName === 'lyrics' ? 'flex' : 'none';

        const editLyricsBtn = document.getElementById('btnEditLyricsRight');
        if (editLyricsBtn) {
            editLyricsBtn.style.display = tabName === 'lyrics' ? 'inline-block' : 'none';
        }

        const titleMap = {
            'now-playing': 'Now Playing',
            'queue': 'Play Queue',
            'lyrics': 'Lyrics'
        };
        document.getElementById('paneTitle').textContent = titleMap[tabName] || 'Details';

        if (tabName === 'queue') this.renderQueueTab();
        if (tabName === 'lyrics' && this.player.currentTrack) this.updateLyricsTab(this.player.currentTrack);
    }

    closeRightPane() {
        this.isRightPaneOpen = false;
        document.getElementById('mainLayout').classList.remove('with-right-pane');
        document.getElementById('rightPane').classList.remove('visible');
    }

    renderQueueTab() {
        const currentItem = document.getElementById('queueCurrentItem');
        const list = document.getElementById('queueList');

        if (this.player.currentTrack) {
            currentItem.innerHTML = `
                <img src="${this.player.currentTrack.coverArt}" class="queue-item-thumb" alt="art">
                <div style="flex: 1; min-width: 0;">
                    <div style="font-weight: 700; color: var(--spotify-green); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${this.player.currentTrack.title}
                    </div>
                    <div style="font-size: 12px; color: var(--text-secondary);">${this.player.currentTrack.artist}</div>
                </div>
            `;
        } else {
            currentItem.innerHTML = `<span style="color: var(--text-secondary);">Nothing currently playing</span>`;
        }

        list.innerHTML = '';
        const upcoming = this.player.queue.slice(this.player.currentIndex + 1);

        if (upcoming.length === 0) {
            list.innerHTML = `<div style="color: var(--text-secondary); font-size: 13px; padding: 8px;">Queue is empty</div>`;
            return;
        }

        upcoming.forEach((track, idx) => {
            const actualIndex = this.player.currentIndex + 1 + idx;
            const item = document.createElement('div');
            item.className = 'queue-item';
            item.innerHTML = `
                <img src="${track.coverArt}" class="queue-item-thumb" alt="art">
                <div style="flex: 1; min-width: 0;">
                    <div style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${track.title}
                    </div>
                    <div style="font-size: 12px; color: var(--text-secondary);">${track.artist}</div>
                </div>
                <button class="pane-close-btn" title="Remove from queue">✕</button>
            `;

            item.querySelector('.pane-close-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.player.removeFromQueue(actualIndex);
            });

            item.addEventListener('click', () => {
                this.player.loadTrack(actualIndex, true);
            });

            list.appendChild(item);
        });
    }

    /* ==========================================================================
       Fullscreen Overlay
       ========================================================================== */
    setupFullscreen() {
        const fsModal = document.getElementById('fullscreenModal');
        const btnOpen = document.getElementById('btnFullscreen');
        const btnClose = document.getElementById('btnExitFullscreen');

        btnOpen.addEventListener('click', () => {
            fsModal.classList.add('active');
        });

        btnClose.addEventListener('click', () => {
            fsModal.classList.remove('active');
        });
    }

    /* ==========================================================================
       Equalizer & Sound Effects Modal
       ========================================================================== */
    setupEqualizer() {
        const eqModal = document.getElementById('eqModal');
        const btnOpen = document.getElementById('btnToggleEq');
        const btnClose = document.getElementById('btnCloseEqModal');

        btnOpen.addEventListener('click', () => {
            eqModal.classList.add('active');
        });

        btnClose.addEventListener('click', () => {
            eqModal.classList.remove('active');
        });

        // Sliders
        const sliders = document.querySelectorAll('.eq-range');
        sliders.forEach(slider => {
            slider.addEventListener('input', () => {
                const gains = Array.from(sliders).map(s => parseFloat(s.value));
                this.player.setEqualizerGains(gains);
            });
        });

        // Presets
        const presets = {
            flat: [0, 0, 0, 0, 0],
            bass: [8, 5, 1, 0, -2],
            vocal: [-2, 1, 6, 4, 1],
            electronic: [6, 4, 0, 3, 5],
            rock: [5, 3, -1, 3, 6],
            acoustic: [4, 2, 2, 4, 3]
        };

        document.querySelectorAll('.eq-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.eq-preset-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const preset = presets[btn.dataset.preset] || presets.flat;
                preset.forEach((val, i) => {
                    if (sliders[i]) sliders[i].value = val;
                });
                this.player.setEqualizerGains(preset);
                this.showToast(`Equalizer: ${btn.dataset.preset}`);
            });
        });

        // Bass Boost Switch
        const btnBass = document.getElementById('btnToggleBassBoost');
        if (btnBass) {
            btnBass.addEventListener('click', () => {
                const isBass = this.player.toggleBassBoost();
                btnBass.classList.toggle('active', isBass);
                btnBass.textContent = isBass ? 'Bass: ON' : 'Bass: OFF';
                this.showToast(isBass ? 'Bass Booster ON' : 'Bass Booster OFF');
            });
        }

        // Stereo Pan Slider
        const panSlider = document.getElementById('stereoPanSlider');
        const panLabel = document.getElementById('panValLabel');
        if (panSlider && panLabel) {
            panSlider.addEventListener('input', () => {
                const val = parseFloat(panSlider.value);
                this.player.setStereoPan(val);
                if (val === 0) panLabel.textContent = 'Center';
                else if (val < 0) panLabel.textContent = `Left ${Math.abs(Math.round(val * 100))}%`;
                else panLabel.textContent = `Right ${Math.round(val * 100)}%`;
            });
        }
    }

    /* ==========================================================================
       Custom User Playlists
       ========================================================================== */
    setupPlaylists() {
        const modal = document.getElementById('playlistModal');
        const btnCreate = document.getElementById('btnCreatePlaylist');
        const btnCancel = document.getElementById('btnCancelPlaylist');
        const btnConfirm = document.getElementById('btnConfirmPlaylist');
        const inputName = document.getElementById('playlistNameInput');

        btnCreate.addEventListener('click', () => {
            inputName.value = `My Playlist #${this.playlists.length + 1}`;
            modal.classList.add('active');
            inputName.focus();
        });

        btnCancel.addEventListener('click', () => {
            modal.classList.remove('active');
        });

        btnConfirm.addEventListener('click', async () => {
            const name = inputName.value.trim() || 'Untitled Playlist';
            const playlist = {
                id: `pl_${Date.now()}`,
                name: name,
                tracks: [...this.allTracks],
                createdAt: new Date().toISOString()
            };

            await StorageManager.savePlaylist(playlist);
            this.playlists.push(playlist);
            modal.classList.remove('active');
            this.renderSidebarPlaylists();
            this.showToast(`Playlist "${name}" created!`);
        });
    }

    renderSidebarPlaylists() {
        const container = document.getElementById('userPlaylistsList');
        if (!container) return;
        container.innerHTML = '';

        this.playlists.forEach(pl => {
            const item = document.createElement('div');
            item.className = 'library-item';
            item.innerHTML = `
                <div class="library-item-thumb">
                    <svg viewBox="0 0 24 24"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
                </div>
                <div class="library-item-info">
                    <div class="library-item-title">${pl.name}</div>
                    <div class="library-item-sub">Playlist • ${pl.tracks.length} songs</div>
                </div>
            `;
            item.addEventListener('click', () => {
                this.activePlaylist = pl;
                const heroCover = document.getElementById('heroCover');
                heroCover.src = MetadataParser.generateCoverArt(pl.name, 'Playlist');
                document.getElementById('heroTag').textContent = 'PLAYLIST';
                document.getElementById('heroTitle').textContent = pl.name;
                document.getElementById('heroDesc').textContent = 'Custom user playlist';
                document.getElementById('heroOwner').textContent = 'Local User';
                document.getElementById('heroStats').textContent = `${pl.tracks.length} songs`;

                this.renderTrackTable('playlistTracksTbody', pl.tracks);
                this.switchView('playlist');
            });
            container.appendChild(item);
        });
    }

    /* ==========================================================================
       Keyboard Shortcuts
       ========================================================================== */
    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            // Ignore when typing inside input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.code === 'Space') {
                e.preventDefault();
                this.player.togglePlay();
            } else if (e.code === 'ArrowRight') {
                if (e.shiftKey) {
                    this.player.next();
                } else {
                    this.player.seek(this.player.audio.currentTime + 5);
                }
            } else if (e.code === 'ArrowLeft') {
                if (e.shiftKey) {
                    this.player.previous();
                } else {
                    this.player.seek(this.player.audio.currentTime - 5);
                }
            } else if (e.code === 'ArrowUp') {
                e.preventDefault();
                this.player.setVolume(this.player.volume + 0.05);
            } else if (e.code === 'ArrowDown') {
                e.preventDefault();
                this.player.setVolume(this.player.volume - 0.05);
            } else if (e.code === 'KeyM') {
                this.player.toggleMute();
            } else if (e.code === 'KeyL') {
                if (this.player.currentTrack) {
                    const liked = StorageManager.toggleLike(this.player.currentTrack.id);
                    this.updatePlayerUI(this.player.currentTrack, this.player.isPlaying);
                    this.updateLibraryCounters();
                    this.showToast(liked ? 'Added to Liked Songs' : 'Removed from Liked Songs');
                }
            } else if (e.code === 'KeyF') {
                const fs = document.getElementById('fullscreenModal');
                fs.classList.toggle('active');
            } else if (e.code === 'KeyS') {
                this.player.toggleShuffle();
                document.getElementById('btnShuffle').classList.toggle('active', this.player.isShuffled);
                this.showToast(this.player.isShuffled ? 'Shuffle on' : 'Shuffle off');
            } else if (e.code === 'KeyR') {
                const mode = this.player.toggleRepeat();
                document.getElementById('btnRepeat').classList.toggle('active', mode !== 'off');
                this.showToast(`Repeat: ${mode}`);
            }
        });
    }

    /* ==========================================================================
       Toast Notifications
       ========================================================================== */
    showToast(message) {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
    window.songPlayer = new SongPlayerApp();
    window.spotifyApp = window.songPlayer; // backwards compatibility alias
});
