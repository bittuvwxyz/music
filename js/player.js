/**
 * Core Audio Player Engine with Web Audio API, Equalizer, Queue, & MediaSession
 * Highly resilient, handles rapid track switching, buffering, autoplay restrictions,
 * touch-friendly seeking, and device media session integration.
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
        this.isBuffering = false;
        this.isMuted = false;
        this.volume = StorageManager.getSetting('volume', 0.8);
        this.playbackRate = StorageManager.getSetting('playback_rate', 1.0);
        this.repeatMode = StorageManager.getSetting('repeat', 'off'); // 'off', 'all', 'one'
        this.isShuffled = StorageManager.getSetting('shuffle', false);
        this.currentBlobUrl = null;
        this.loadRequestId = 0;

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
        this.onBufferingChange = null;
        this.onTimeUpdate = null;
        this.onDurationChange = null;
        this.onQueueUpdate = null;
        this.onVolumeChange = null;
        this.onSleepTimerTick = null;
        this.onABLoopChange = null;
        this.onError = null;

        this.initAudioEvents();
        this.initMediaSession();
        this.setVolume(this.volume);
        this.setPlaybackRate(this.playbackRate);
    }

    initAudioContext() {
        if (this.isAudioCtxInitialized) return;
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return;

            this.audioCtx = new AudioContextClass();
            this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);
            this.analyserNode = this.audioCtx.createAnalyser();
            this.analyserNode.fftSize = 256;

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

            // Bass Booster Node (lowshelf at 80Hz)
            this.bassBoostNode = this.audioCtx.createBiquadFilter();
            this.bassBoostNode.type = 'lowshelf';
            this.bassBoostNode.frequency.value = 80;
            this.bassBoostNode.gain.value = this.isBassBoosted ? 9 : 0;
            this.analyserNode.connect(this.bassBoostNode);

            // Stereo Panner Node
            if (typeof this.audioCtx.createStereoPanner === 'function') {
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
            console.warn('Web Audio API initialization failed (fallback to standard audio):', e);
        }
    }

    async ensureAudioContext() {
        if (!this.isAudioCtxInitialized) {
            this.initAudioContext();
        }
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            try {
                await this.audioCtx.resume();
            } catch (err) {
                console.warn('AudioContext resume was prevented:', err);
            }
        }
    }

    initAudioEvents() {
        this.audio.addEventListener('play', () => {
            this.isPlaying = true;
            this.isBuffering = false;
            if (this.onBufferingChange) this.onBufferingChange(false);
            if (this.onPlayStateChange) this.onPlayStateChange(true);
        });

        this.audio.addEventListener('playing', () => {
            this.isPlaying = true;
            this.isBuffering = false;
            if (this.onBufferingChange) this.onBufferingChange(false);
            if (this.onPlayStateChange) this.onPlayStateChange(true);
        });

        this.audio.addEventListener('pause', () => {
            this.isPlaying = false;
            this.isBuffering = false;
            if (this.onBufferingChange) this.onBufferingChange(false);
            if (this.onPlayStateChange) this.onPlayStateChange(false);
        });

        this.audio.addEventListener('waiting', () => {
            this.isBuffering = true;
            if (this.onBufferingChange) this.onBufferingChange(true);
        });

        this.audio.addEventListener('canplay', () => {
            this.isBuffering = false;
            if (this.onBufferingChange) this.onBufferingChange(false);
        });

        this.audio.addEventListener('loadedmetadata', () => {
            const dur = Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
            if (this.currentTrack && dur > 0) {
                this.currentTrack.duration = dur;
            }
            if (this.onDurationChange) this.onDurationChange(dur);
            if (this.onTimeUpdate) this.onTimeUpdate(this.audio.currentTime || 0, dur);
        });

        this.audio.addEventListener('timeupdate', () => {
            // A-B Looping check
            if (this.isLoopingAB && this.loopA !== null && this.loopB !== null) {
                if (this.audio.currentTime >= this.loopB) {
                    this.audio.currentTime = this.loopA;
                }
            }

            if (this.onTimeUpdate) {
                const dur = Number.isFinite(this.audio.duration) ? this.audio.duration : (this.currentTrack?.duration || 0);
                this.onTimeUpdate(this.audio.currentTime || 0, dur);
            }
        });

        this.audio.addEventListener('ended', () => {
            if (this.stopAtTrackEnd) {
                this.stopAtTrackEnd = false;
                this.pause();
                if (this.onSleepTimerTick) this.onSleepTimerTick(0, 'Timer finished');
                return;
            }
            this.handleTrackEnded();
        });

        this.audio.addEventListener('error', () => {
            this.isPlaying = false;
            this.isBuffering = false;
            if (this.onBufferingChange) this.onBufferingChange(false);
            if (this.onPlayStateChange) this.onPlayStateChange(false);

            const err = this.audio.error;
            let message = 'Audio loading error';
            if (err) {
                if (err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
                    message = 'Format not supported or file missing.';
                } else if (err.code === MediaError.MEDIA_ERR_NETWORK) {
                    message = 'Network error while loading file.';
                } else if (err.code === MediaError.MEDIA_ERR_DECODE) {
                    message = 'Decoding error occurred.';
                }
            }
            console.warn(`Playback error for "${this.currentTrack?.title}": ${message}`);
            if (this.onError) {
                this.onError(new Error(message), this.currentTrack);
            }
        });
    }

    initMediaSession() {
        if (!('mediaSession' in navigator)) return;
        try {
            navigator.mediaSession.setActionHandler('play', () => this.play());
            navigator.mediaSession.setActionHandler('pause', () => this.pause());
            navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
            navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
            navigator.mediaSession.setActionHandler('seekto', (details) => {
                if (details.seekTime !== undefined) this.seek(details.seekTime);
            });
            navigator.mediaSession.setActionHandler('seekforward', () => {
                this.seek(this.audio.currentTime + 10);
            });
            navigator.mediaSession.setActionHandler('seekbackward', () => {
                this.seek(this.audio.currentTime - 10);
            });
        } catch (e) {
            console.warn('MediaSession handler error:', e);
        }
    }

    updateMediaSession() {
        if (!('mediaSession' in navigator) || !this.currentTrack) return;
        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: this.currentTrack.title || 'Unknown Title',
                artist: this.currentTrack.artist || 'Local Artist',
                album: this.currentTrack.album || 'Local Music',
                artwork: [
                    { src: this.currentTrack.coverArt || '', sizes: '512x512', type: 'image/png' }
                ]
            });
        } catch (e) {
            console.warn('MediaSession metadata error:', e);
        }
    }

    get duration() {
        if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
            return this.audio.duration;
        }
        return this.currentTrack?.duration || 0;
    }

    get currentTime() {
        return Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
    }

    setQueue(tracks, startIndex = 0, autoPlay = true) {
        if (!Array.isArray(tracks) || tracks.length === 0) return;
        this.originalQueue = [...tracks];
        if (this.isShuffled) {
            const current = tracks[startIndex] || tracks[0];
            const remaining = tracks.filter((_, i) => i !== startIndex);
            this.queue = [current, ...this.shuffleArray(remaining)];
            this.currentIndex = 0;
        } else {
            this.queue = [...tracks];
            this.currentIndex = Math.max(0, Math.min(startIndex, this.queue.length - 1));
        }

        if (this.onQueueUpdate) this.onQueueUpdate(this.queue, this.currentIndex);
        this.loadTrack(this.currentIndex, autoPlay);
    }

    async loadTrack(index, autoPlay = true) {
        if (index < 0 || index >= this.queue.length) return;
        const requestId = ++this.loadRequestId;
        this.currentIndex = index;
        const track = this.queue[index];
        this.currentTrack = track;

        // Reset A-B looper on song switch
        if (this.isLoopingAB) {
            this.clearLoopAB();
        }

        // Cleanup old blob URL
        if (this.currentBlobUrl) {
            try {
                URL.revokeObjectURL(this.currentBlobUrl);
            } catch (e) {
                // ignore
            }
            this.currentBlobUrl = null;
        }

        let audioSource = track.url;

        // Check if track has a file object or stored blob in IndexedDB
        if (track.file) {
            this.currentBlobUrl = URL.createObjectURL(track.file);
            audioSource = this.currentBlobUrl;
        } else if (!track.url || track.url.startsWith('blob:')) {
            const blob = await StorageManager.getFileBlob(track.id);
            // Race condition check: if another track was requested while waiting, abort
            if (this.loadRequestId !== requestId) return;

            if (blob) {
                this.currentBlobUrl = URL.createObjectURL(blob);
                audioSource = this.currentBlobUrl;
            }
        }

        // Final race condition verification
        if (this.loadRequestId !== requestId) return;

        // Pause previous audio cleanly before swapping src
        try {
            this.audio.pause();
        } catch (e) {
            // ignore
        }

        // Safely encode relative URLs to handle spaces on hosted web servers
        if (audioSource && typeof audioSource === 'string' && !audioSource.startsWith('blob:') && !audioSource.startsWith('data:')) {
            audioSource = encodeURI(decodeURI(audioSource));
        }

        this.audio.src = audioSource;
        this.audio.playbackRate = this.playbackRate;
        this.updateMediaSession();
        StorageManager.addRecentlyPlayed(track.id);

        if (this.onTrackChange) this.onTrackChange(track, this.currentIndex);

        if (autoPlay) {
            this.play();
        }
    }

    async play() {
        await this.ensureAudioContext();

        if (!this.audio.src && this.queue.length > 0) {
            await this.loadTrack(0, true);
            return;
        }

        try {
            await this.audio.play();
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.warn('Playback request prevented or interrupted:', err);
                this.isPlaying = false;
                if (this.onPlayStateChange) this.onPlayStateChange(false);
                if (this.onError) this.onError(err, this.currentTrack);
            }
        }
    }

    pause() {
        try {
            this.audio.pause();
        } catch (e) {
            // ignore
        }
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

        // If played more than 3 seconds, restart current track first
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
        if (!Number.isFinite(seconds)) return;
        const dur = Number.isFinite(this.audio.duration) && this.audio.duration > 0
            ? this.audio.duration
            : (this.currentTrack?.duration || 0);

        if (dur > 0) {
            const clamped = Math.max(0, Math.min(seconds, dur));
            try {
                this.audio.currentTime = clamped;
            } catch (err) {
                console.warn('Seek error:', err);
            }
        }
    }

    setVolume(value) {
        if (!Number.isFinite(value)) return;
        this.volume = Math.max(0, Math.min(1, value));

        // If user manually turns volume up, auto-unmute
        if (this.isMuted && this.volume > 0) {
            this.isMuted = false;
        }

        this.audio.volume = this.isMuted ? 0 : this.volume;
        StorageManager.setSetting('volume', this.volume);
        if (this.onVolumeChange) this.onVolumeChange(this.volume, this.isMuted);
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        this.audio.volume = this.isMuted ? 0 : this.volume;
        if (this.onVolumeChange) this.onVolumeChange(this.volume, this.isMuted);
        return this.isMuted;
    }

    toggleShuffle() {
        this.isShuffled = !this.isShuffled;
        StorageManager.setSetting('shuffle', this.isShuffled);

        if (this.queue.length <= 1) return this.isShuffled;

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
        return this.isShuffled;
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
        if (!this.eqNodes || this.eqNodes.length === 0 || !Array.isArray(gains)) return;
        gains.forEach((gainVal, idx) => {
            if (this.eqNodes[idx]) {
                this.eqNodes[idx].gain.value = gainVal;
            }
        });
        StorageManager.setSetting('eq_gains', gains);
    }

    // Add track to up next queue
    addToQueue(track) {
        if (!track) return;
        this.queue.push(track);
        this.originalQueue.push(track);
        if (this.onQueueUpdate) this.onQueueUpdate(this.queue, this.currentIndex);
    }

    // Remove from queue
    removeFromQueue(index) {
        if (index === this.currentIndex || index < 0 || index >= this.queue.length) return;
        this.queue.splice(index, 1);
        if (index < this.currentIndex) this.currentIndex--;
        if (this.onQueueUpdate) this.onQueueUpdate(this.queue, this.currentIndex);
    }

    // Playback Speed
    setPlaybackRate(rate) {
        if (!Number.isFinite(rate)) return;
        this.playbackRate = Math.max(0.25, Math.min(3.0, rate));
        this.audio.playbackRate = this.playbackRate;
        StorageManager.setSetting('playback_rate', this.playbackRate);
    }

    // Stereo Spatial Pan
    setStereoPan(pan) {
        if (!Number.isFinite(pan)) return;
        this.stereoPan = Math.max(-1, Math.min(1, pan));
        if (this.pannerNode && this.pannerNode.pan) {
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

        const mins = Number(minutes);
        if (!Number.isFinite(mins) || mins <= 0) return;

        const durationMs = mins * 60 * 1000;
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
