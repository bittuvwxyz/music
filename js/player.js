/**
 * Core Audio Player Engine with Web Audio API, Equalizer, Queue, & MediaSession
 */

class AudioPlayer {
    constructor() {
        this.audio = new Audio();
        this.audio.preload = 'metadata';

        // Web Audio API
        this.audioCtx = null;
        this.sourceNode = null;
        this.analyserNode = null;
        this.eqNodes = [];
        this.isAudioCtxInitialized = false;

        // Playback State
        this.currentTrack = null;
        this.queue = [];
        this.originalQueue = [];
        this.currentIndex = -1;
        this.isPlaying = false;
        this.isMuted = false;
        this.volume = StorageManager.getSetting('volume', 0.8);
        this.playbackRate = StorageManager.getSetting('playback_rate', 1.0);
        this.repeatMode = StorageManager.getSetting('repeat', 'off'); // 'off', 'all', 'one'
        this.isShuffled = StorageManager.getSetting('shuffle', false);
        this.currentBlobUrl = null;

        // Enhanced Audio Features
        this.pannerNode = null;
        this.bassBoostNode = null;
        this.isBassBoosted = false;
        this.stereoPan = 0; // -1.0 to 1.0

        // A-B Looper
        this.loopA = null;
        this.loopB = null;
        this.isLoopingAB = false;

        // Sleep Timer
        this.sleepTimerInterval = null;
        this.sleepTargetTime = null;
        this.stopAtTrackEnd = false;

        // Callbacks
        this.onTrackChange = null;
        this.onPlayStateChange = null;
        this.onTimeUpdate = null;
        this.onQueueUpdate = null;
        this.onVolumeChange = null;
        this.onSleepTimerTick = null;
        this.onABLoopChange = null;

        this.initAudioEvents();
        this.initMediaSession();
        this.setVolume(this.volume);
        this.setPlaybackRate(this.playbackRate);
    }

    initAudioContext() {
        if (this.isAudioCtxInitialized) return;
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioCtx = new AudioContext();

            this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);
            this.analyserNode = this.audioCtx.createAnalyser();

            // 5-band EQ: 60Hz (Lowshelf), 250Hz (Peaking), 1000Hz (Peaking), 4000Hz (Peaking), 14000Hz (Highshelf)
            const frequencies = [60, 250, 1000, 4000, 14000];
            let lastNode = this.sourceNode;

            this.eqNodes = frequencies.map((freq, i) => {
                const filter = this.audioCtx.createBiquadFilter();
                if (i === 0) {
                    filter.type = 'lowshelf';
                } else if (i === frequencies.length - 1) {
                    filter.type = 'highshelf';
                } else {
                    filter.type = 'peaking';
                    filter.Q.value = 1.0;
                }
                filter.frequency.value = freq;
                filter.gain.value = 0;

                lastNode.connect(filter);
                lastNode = filter;
                return filter;
            });

            lastNode.connect(this.analyserNode);

            // Bass Booster Node (60Hz shelf)
            this.bassBoostNode = this.audioCtx.createBiquadFilter();
            this.bassBoostNode.type = 'lowshelf';
            this.bassBoostNode.frequency.value = 80;
            this.bassBoostNode.gain.value = this.isBassBoosted ? 9 : 0;
            this.analyserNode.connect(this.bassBoostNode);

            // Stereo Panner Node
            if (this.audioCtx.createStereoPanner) {
                this.pannerNode = this.audioCtx.createStereoPanner();
                this.pannerNode.pan.value = this.stereoPan;
                this.bassBoostNode.connect(this.pannerNode);
                this.pannerNode.connect(this.audioCtx.destination);
            } else {
                this.bassBoostNode.connect(this.audioCtx.destination);
            }

            this.isAudioCtxInitialized = true;

            // Load saved EQ preset
            const savedEq = StorageManager.getSetting('eq_gains', [0, 0, 0, 0, 0]);
            this.setEqualizerGains(savedEq);
        } catch (e) {
            console.warn('Web Audio API initialization failed:', e);
        }
    }

    initAudioEvents() {
        this.audio.addEventListener('play', () => {
            this.isPlaying = true;
            if (this.onPlayStateChange) this.onPlayStateChange(true);
        });

        this.audio.addEventListener('pause', () => {
            this.isPlaying = false;
            if (this.onPlayStateChange) this.onPlayStateChange(false);
        });

        this.audio.addEventListener('timeupdate', () => {
            // A-B Looping check
            if (this.isLoopingAB && this.loopA !== null && this.loopB !== null) {
                if (this.audio.currentTime >= this.loopB) {
                    this.audio.currentTime = this.loopA;
                }
            }

            if (this.onTimeUpdate) {
                this.onTimeUpdate(this.audio.currentTime, this.audio.duration || 0);
            }
        });

        this.audio.addEventListener('ended', () => {
            if (this.stopAtTrackEnd) {
                this.stopAtTrackEnd = false;
                this.pause();
                if (this.onSleepTimerTick) this.onSleepTimerTick(0, 'Timer finished: stopped at track end.');
                return;
            }
            this.handleTrackEnded();
        });

        this.audio.addEventListener('error', (e) => {
            console.error('Audio playback error:', e);
            if (this.queue.length > 1) {
                // Skip to next if current track has decoding/loading error
                setTimeout(() => this.next(), 1000);
            }
        });
    }

    initMediaSession() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => this.play());
            navigator.mediaSession.setActionHandler('pause', () => this.pause());
            navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
            navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
            navigator.mediaSession.setActionHandler('seekto', (details) => {
                if (details.seekTime !== undefined) this.seek(details.seekTime);
            });
        }
    }

    updateMediaSession() {
        if (!('mediaSession' in navigator) || !this.currentTrack) return;
        navigator.mediaSession.metadata = new MediaMetadata({
            title: this.currentTrack.title || 'Unknown Title',
            artist: this.currentTrack.artist || 'Local Artist',
            album: this.currentTrack.album || 'Offline Library',
            artwork: [
                { src: this.currentTrack.coverArt || '', sizes: '512x512', type: 'image/png' }
            ]
        });
    }

    setQueue(tracks, startIndex = 0) {
        if (!tracks || tracks.length === 0) return;
        this.originalQueue = [...tracks];
        if (this.isShuffled) {
            const current = tracks[startIndex];
            const remaining = tracks.filter((_, i) => i !== startIndex);
            this.queue = [current, ...this.shuffleArray(remaining)];
            this.currentIndex = 0;
        } else {
            this.queue = [...tracks];
            this.currentIndex = Math.max(0, Math.min(startIndex, this.queue.length - 1));
        }

        if (this.onQueueUpdate) this.onQueueUpdate(this.queue, this.currentIndex);
        this.loadTrack(this.currentIndex, true);
    }

    async loadTrack(index, autoPlay = true) {
        if (index < 0 || index >= this.queue.length) return;
        this.currentIndex = index;
        const track = this.queue[index];
        this.currentTrack = track;

        // Cleanup old blob URL
        if (this.currentBlobUrl) {
            URL.revokeObjectURL(this.currentBlobUrl);
            this.currentBlobUrl = null;
        }

        let audioSource = track.url;

        // Check if track has a file object or stored blob in IndexedDB
        if (track.file) {
            this.currentBlobUrl = URL.createObjectURL(track.file);
            audioSource = this.currentBlobUrl;
        } else if (!track.url || track.url.startsWith('blob:')) {
            const blob = await StorageManager.getFileBlob(track.id);
            if (blob) {
                this.currentBlobUrl = URL.createObjectURL(blob);
                audioSource = this.currentBlobUrl;
            }
        }

        this.audio.src = audioSource;
        this.updateMediaSession();
        StorageManager.addRecentlyPlayed(track.id);

        if (this.onTrackChange) this.onTrackChange(track, this.currentIndex);

        if (autoPlay) {
            this.play();
        }
    }

    async play() {
        if (!this.isAudioCtxInitialized) {
            this.initAudioContext();
        }
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            await this.audioCtx.resume();
        }

        if (!this.audio.src && this.queue.length > 0) {
            await this.loadTrack(0, true);
            return;
        }

        try {
            await this.audio.play();
        } catch (err) {
            console.warn('Playback failed or blocked:', err);
        }
    }

    pause() {
        this.audio.pause();
    }

    togglePlay() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    next() {
        if (this.queue.length === 0) return;

        if (this.repeatMode === 'one') {
            this.seek(0);
            this.play();
            return;
        }

        if (this.currentIndex < this.queue.length - 1) {
            this.loadTrack(this.currentIndex + 1, true);
        } else if (this.repeatMode === 'all') {
            this.loadTrack(0, true);
        } else {
            this.pause();
            this.seek(0);
        }
    }

    previous() {
        if (this.queue.length === 0) return;

        // If played more than 3 seconds, replay current song first
        if (this.audio.currentTime > 3) {
            this.seek(0);
            return;
        }

        if (this.currentIndex > 0) {
            this.loadTrack(this.currentIndex - 1, true);
        } else {
            this.loadTrack(this.queue.length - 1, true);
        }
    }

    seek(seconds) {
        if (this.audio.duration) {
            this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration));
        }
    }

    setVolume(value) {
        this.volume = Math.max(0, Math.min(1, value));
        this.audio.volume = this.isMuted ? 0 : this.volume;
        StorageManager.setSetting('volume', this.volume);
        if (this.onVolumeChange) this.onVolumeChange(this.volume, this.isMuted);
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        this.audio.volume = this.isMuted ? 0 : this.volume;
        if (this.onVolumeChange) this.onVolumeChange(this.volume, this.isMuted);
    }

    toggleShuffle() {
        this.isShuffled = !this.isShuffled;
        StorageManager.setSetting('shuffle', this.isShuffled);

        if (this.queue.length <= 1) return;

        const currentTrack = this.queue[this.currentIndex];

        if (this.isShuffled) {
            const remaining = this.queue.filter((_, i) => i !== this.currentIndex);
            this.queue = [currentTrack, ...this.shuffleArray(remaining)];
            this.currentIndex = 0;
        } else {
            this.queue = [...this.originalQueue];
            this.currentIndex = this.queue.findIndex(t => t.id === currentTrack.id);
            if (this.currentIndex === -1) this.currentIndex = 0;
        }

        if (this.onQueueUpdate) this.onQueueUpdate(this.queue, this.currentIndex);
    }

    toggleRepeat() {
        const modes = ['off', 'all', 'one'];
        const nextIdx = (modes.indexOf(this.repeatMode) + 1) % modes.length;
        this.repeatMode = modes[nextIdx];
        StorageManager.setSetting('repeat', this.repeatMode);
        return this.repeatMode;
    }

    handleTrackEnded() {
        if (this.repeatMode === 'one') {
            this.seek(0);
            this.play();
        } else if (this.currentIndex < this.queue.length - 1 || this.repeatMode === 'all') {
            this.next();
        } else {
            this.isPlaying = false;
            if (this.onPlayStateChange) this.onPlayStateChange(false);
        }
    }

    shuffleArray(arr) {
        const copy = [...arr];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    // Equalizer
    setEqualizerGains(gains) {
        if (!this.eqNodes || this.eqNodes.length === 0) return;
        gains.forEach((gainVal, idx) => {
            if (this.eqNodes[idx]) {
                this.eqNodes[idx].gain.value = gainVal;
            }
        });
        StorageManager.setSetting('eq_gains', gains);
    }

    // Add track to up next queue
    addToQueue(track) {
        this.queue.push(track);
        this.originalQueue.push(track);
        if (this.onQueueUpdate) this.onQueueUpdate(this.queue, this.currentIndex);
    }

    // Remove from queue
    removeFromQueue(index) {
        if (index === this.currentIndex) return;
        this.queue.splice(index, 1);
        if (index < this.currentIndex) this.currentIndex--;
        if (this.onQueueUpdate) this.onQueueUpdate(this.queue, this.currentIndex);
    }

    // Playback Speed
    setPlaybackRate(rate) {
        this.playbackRate = Math.max(0.25, Math.min(3.0, rate));
        this.audio.playbackRate = this.playbackRate;
        StorageManager.setSetting('playback_rate', this.playbackRate);
    }

    // Stereo Spatial Pan
    setStereoPan(pan) {
        this.stereoPan = Math.max(-1, Math.min(1, pan));
        if (this.pannerNode) {
            this.pannerNode.pan.value = this.stereoPan;
        }
    }

    // Bass Boost
    toggleBassBoost() {
        this.isBassBoosted = !this.isBassBoosted;
        if (this.bassBoostNode) {
            this.bassBoostNode.gain.value = this.isBassBoosted ? 9 : 0;
        }
        return this.isBassBoosted;
    }

    // A-B Looper
    setLoopA() {
        this.loopA = this.audio.currentTime;
        if (this.loopB !== null && this.loopB <= this.loopA) {
            this.loopB = null;
            this.isLoopingAB = false;
        }
        if (this.onABLoopChange) this.onABLoopChange(this.loopA, this.loopB, this.isLoopingAB);
        return this.loopA;
    }

    setLoopB() {
        if (this.loopA === null) {
            this.loopA = 0;
        }
        this.loopB = Math.max(this.loopA + 0.5, this.audio.currentTime);
        this.isLoopingAB = true;
        if (this.onABLoopChange) this.onABLoopChange(this.loopA, this.loopB, this.isLoopingAB);
        return this.loopB;
    }

    clearLoopAB() {
        this.loopA = null;
        this.loopB = null;
        this.isLoopingAB = false;
        if (this.onABLoopChange) this.onABLoopChange(null, null, false);
    }

    // Sleep Timer
    startSleepTimer(minutes) {
        this.cancelSleepTimer();

        if (minutes === 'end_of_track') {
            this.stopAtTrackEnd = true;
            if (this.onSleepTimerTick) this.onSleepTimerTick(null, 'End of track');
            return;
        }

        const durationMs = minutes * 60 * 1000;
        this.sleepTargetTime = Date.now() + durationMs;
        const initialVolume = this.volume;

        this.sleepTimerInterval = setInterval(() => {
            const remainingMs = this.sleepTargetTime - Date.now();
            if (remainingMs <= 0) {
                this.cancelSleepTimer();
                this.pause();
                this.setVolume(initialVolume);
                if (this.onSleepTimerTick) this.onSleepTimerTick(0, 'Timer expired');
            } else {
                const remainingSecs = Math.ceil(remainingMs / 1000);
                // Smooth fade-out in last 20 seconds
                if (remainingSecs <= 20) {
                    const fadeRatio = remainingSecs / 20;
                    this.audio.volume = initialVolume * fadeRatio;
                }
                if (this.onSleepTimerTick) this.onSleepTimerTick(remainingSecs, null);
            }
        }, 1000);
    }

    cancelSleepTimer() {
        if (this.sleepTimerInterval) {
            clearInterval(this.sleepTimerInterval);
            this.sleepTimerInterval = null;
        }
        this.sleepTargetTime = null;
        this.stopAtTrackEnd = false;
        this.audio.volume = this.isMuted ? 0 : this.volume;
        if (this.onSleepTimerTick) this.onSleepTimerTick(0, 'Off');
    }
}

window.AudioPlayer = AudioPlayer;
