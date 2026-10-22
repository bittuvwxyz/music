# 🎵 Song Player - Local & Offline Music Player

A full-featured music player built with **HTML5, CSS3, and modern Vanilla JavaScript**. Play music directly from your dedicated folder or any folder on your computer with zero setup, zero latency, and no internet connection required.

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)

---

## ✨ Features & Capabilities

- **Song Player Interface**:
  - Clean and modern dark theme with sleek typography and smooth transitions.
  - Dynamic time-based greeting (*"Good morning"*, *"Good afternoon"*, *"Good evening"*).
  - Quick-picks grid with hover play.
  - Playlist and collection views with dynamic hero gradients.
  - Persistent bottom player bar with seek scrubber and volume slider.
- **Dedicated Songs Folder & Local Ingestion**:
  - Keep music files in [`d:\musicplayer\songs\`](file:///d:/musicplayer/songs/).
  - Click **"Open Music Folder"** to load any directory on your computer using the HTML5 Directory Picker.
  - Drag-and-drop any audio files or folders directly into the player window.
  - Supports `.mp3`, `.wav`, `.flac`, `.ogg`, `.m4a`, and `.aac`.
- **Theme Color Customizer**:
  - 8 vibrant theme accent colors (Emerald Glow, Electric Blue, Neon Purple, Sunset Amber, Cyber Rose, Crimson, Cyan, Gold).
- **Sleep Timer with Smooth Volume Fade**:
  - Automatic sleep timer with options for 5, 15, 30, 45, 60 minutes, or End of Current Song.
  - Live countdown badge in top navigation.
  - Smoothly fades volume to zero during the last 20 seconds.
- **Playback Speed Controller**:
  - Cycle playback speed: `0.5x`, `0.75x`, `1.0x`, `1.25x`, `1.5x`, `2.0x`.
- **A-B Section Looper**:
  - Click `A-B` to set Point A, click again to set Point B, and loop that exact segment!
- **Song Details & Lyrics Editor**:
  - Edit track Title, Artist, and Album with permanent local persistence.
  - Paste custom plain text or synchronized timestamped lyrics (`[mm:ss] lyric text`).
  - Synced lyrics auto-scroll and highlight during playback; click any lyric line to jump to that timestamp!
- **Studio Equalizer & Audio Enhancers**:
  - 5-band EQ (60Hz, 250Hz, 1kHz, 4kHz, 14kHz) with presets (*Flat*, *Bass Boost*, *Vocal Boost*, *Electronic*, *Rock*, *Acoustic*).
  - One-click **Bass Booster** toggle.
  - **Stereo Spatial Pan slider** (Left <-> Center <-> Right).
- **Sorting & Quick Search in Collection**:
  - Filter tracks in real-time within your collection or playlists.
  - Sort by Title (A-Z), Artist (A-Z), Longest duration, or Shortest duration.
- **Backup & Restore**:
  - Export your playlists, favorites, custom lyrics, and tags into a JSON backup.
  - Import JSON to restore your library anytime.
- **Live Spectrum Visualizer**:
  - 3 switchable visualizer modes: **Neon Bars**, **Waveform Oscilloscope**, and **Circular Pulsing Spectrum**.
- **Fullscreen Experience**:
  - Fullscreen view with ambient blurred album backdrop, large cover art, and lyrics.
- **Media Session API**:
  - Integrates with Windows notifications, lock screen media widget, and hardware keyboard media keys (Play, Pause, Skip, Prev).

---

## 🚀 How to Run

### Method 1: One-Click Launch (Recommended)
Double-click **`start-player.bat`** in `d:\musicplayer`.
It starts a local server and opens your browser at `http://localhost:8000`.

### Method 2: Direct File Open
Double-click **`index.html`** in any modern browser (Chrome, Edge, Firefox, Brave, Opera).

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| <kbd>Space</kbd> | Play / Pause |
| <kbd>→</kbd> / <kbd>←</kbd> | Seek forward / backward 5s |
| <kbd>Shift</kbd> + <kbd>→</kbd> / <kbd>←</kbd> | Next / Previous track |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Volume Up / Down |
| <kbd>M</kbd> | Mute / Unmute |
| <kbd>L</kbd> | Like / Unlike current track |
| <kbd>S</kbd> | Toggle Shuffle |
| <kbd>R</kbd> | Toggle Repeat mode (*Off* / *All* / *One*) |
| <kbd>F</kbd> | Toggle Fullscreen mode |

---

## 📁 Project Structure

```
d:\musicplayer\
├── index.html           # Main Song Player interface
├── start-player.bat     # 1-click launcher
├── scan-songs.bat       # Auto-indexes songs in songs/ folder
├── scan-songs.ps1       # PowerShell indexing script
├── README.md            # Documentation
├── css\
│   └── style.css        # Themes, controls, and responsive styling
├── js\
│   ├── app.js           # UI routing, sleep timer, looper, lyrics & tags
│   ├── player.js        # Web Audio API engine, speed, panning & EQ
│   ├── metadata.js      # ID3 tag & embedded cover art parser
│   ├── visualizer.js    # Multi-mode audio spectrum visualizer
│   └── storage.js       # IndexedDB & LocalStorage manager
└── songs\               # Dedicated local music folder
    ├── songs.json       # Generated track manifest
    ├── master.mp3       # Audio track
    └── *.wav            # Sample audio tracks
```
