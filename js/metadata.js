/**
 * Offline Audio Metadata & ID3 Tag Parser
 * Extracts Title, Artist, Album, Year, and Album Art (APIC) from audio files
 * Completely client-side, zero external dependencies.
 */

const MetadataParser = {
    /**
     * Parse metadata from a File or Blob object
     * @param {File|Blob} file 
     * @returns {Promise<Object>}
     */
    async parse(file) {
        const metadata = {
            title: '',
            artist: '',
            album: '',
            year: '',
            genre: '',
            duration: 0,
            coverArt: null,
            format: file.name ? file.name.split('.').pop().toLowerCase() : 'audio',
            size: file.size,
            filename: file.name || 'Unknown Track'
        };

        // Fallback from filename first
        const filenameFallback = this.parseFilename(metadata.filename);
        metadata.title = filenameFallback.title;
        metadata.artist = filenameFallback.artist;
        metadata.album = filenameFallback.album;

        try {
            // Read first 128KB to parse ID3v2 header and tags (most ID3 tags & images fit here or we read more for images)
            const buffer = await this.readSlice(file, 0, Math.min(file.size, 512 * 1024));
            const id3 = this.parseID3v2(buffer);

            if (id3) {
                if (id3.title) metadata.title = id3.title;
                if (id3.artist) metadata.artist = id3.artist;
                if (id3.album) metadata.album = id3.album;
                if (id3.year) metadata.year = id3.year;
                if (id3.genre) metadata.genre = id3.genre;
                if (id3.coverArt) metadata.coverArt = id3.coverArt;
            } else if (file.size > 128) {
                // Try ID3v1 from end of file
                const endBuffer = await this.readSlice(file, file.size - 128, file.size);
                const id3v1 = this.parseID3v1(endBuffer);
                if (id3v1) {
                    if (id3v1.title) metadata.title = id3v1.title;
                    if (id3v1.artist) metadata.artist = id3v1.artist;
                    if (id3v1.album) metadata.album = id3v1.album;
                    if (id3v1.year) metadata.year = id3v1.year;
                }
            }
        } catch (err) {
            console.warn('ID3 parsing skipped for', file.name, err);
        }

        // Generate synthetic cover art if none found
        if (!metadata.coverArt) {
            metadata.coverArt = this.generateCoverArt(metadata.title, metadata.artist);
        }

        return metadata;
    },

    /**
     * Slice and read array buffer
     */
    readSlice(file, start, end) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(file.slice(start, end));
        });
    },

    /**
     * Fallback title & artist from filename: "Artist - Title.mp3"
     */
    parseFilename(filename) {
        const clean = filename.replace(/\.[^/.]+$/, '').trim();
        const parts = clean.split(/\s*-\s*/);
        if (parts.length >= 2) {
            return {
                artist: parts[0].trim(),
                title: parts.slice(1).join(' - ').trim(),
                album: 'Offline Music'
            };
        }
        return {
            title: clean,
            artist: 'Local Artist',
            album: 'Offline Music'
        };
    },

    /**
     * Parse ID3v2 header and tags
     */
    parseID3v2(buffer) {
        const view = new DataView(buffer);
        if (view.byteLength < 10) return null;

        // Check for "ID3" identifier
        if (view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x33) {
            return null;
        }

        const version = view.getUint8(3); // 3 for 2.3, 4 for 2.4
        // Synchsafe size (7 bits per byte)
        const tagSize = ((view.getUint8(6) & 0x7f) << 21) |
                        ((view.getUint8(7) & 0x7f) << 14) |
                        ((view.getUint8(8) & 0x7f) << 7) |
                        (view.getUint8(9) & 0x7f);

        const tags = {};
        let offset = 10;
        const maxOffset = Math.min(buffer.byteLength, tagSize + 10);

        while (offset < maxOffset - 10) {
            let frameID = '';
            for (let i = 0; i < 4; i++) {
                const charCode = view.getUint8(offset + i);
                if (charCode >= 32 && charCode <= 126) {
                    frameID += String.fromCharCode(charCode);
                }
            }

            if (frameID.length < 4 || frameID.charCodeAt(0) === 0) break;

            let frameSize;
            if (version === 4) {
                // v2.4 synchsafe
                frameSize = ((view.getUint8(offset + 4) & 0x7f) << 21) |
                            ((view.getUint8(offset + 5) & 0x7f) << 14) |
                            ((view.getUint8(offset + 6) & 0x7f) << 7) |
                            (view.getUint8(offset + 7) & 0x7f);
            } else {
                // v2.3 normal 32-bit int
                frameSize = view.getUint32(offset + 4);
            }

            if (frameSize <= 0 || offset + 10 + frameSize > buffer.byteLength) break;

            const frameDataOffset = offset + 10;

            if (frameID === 'TIT2') { // Title
                tags.title = this.decodeTextFrame(view, frameDataOffset, frameSize);
            } else if (frameID === 'TPE1') { // Artist
                tags.artist = this.decodeTextFrame(view, frameDataOffset, frameSize);
            } else if (frameID === 'TALB') { // Album
                tags.album = this.decodeTextFrame(view, frameDataOffset, frameSize);
            } else if (frameID === 'TYER' || frameID === 'TDRC') { // Year
                tags.year = this.decodeTextFrame(view, frameDataOffset, frameSize);
            } else if (frameID === 'TCON') { // Genre
                tags.genre = this.decodeTextFrame(view, frameDataOffset, frameSize);
            } else if (frameID === 'APIC') { // Picture
                tags.coverArt = this.decodePictureFrame(view, frameDataOffset, frameSize);
            }

            offset += 10 + frameSize;
        }

        return tags;
    },

    /**
     * Decode ID3 text frame handling encoding flags
     */
    decodeTextFrame(view, offset, size) {
        if (size <= 1) return '';
        const encoding = view.getUint8(offset);
        const bytes = new Uint8Array(view.buffer, view.byteOffset + offset + 1, size - 1);

        try {
            if (encoding === 0) { // ISO-8859-1
                let str = '';
                for (let i = 0; i < bytes.length; i++) {
                    if (bytes[i] === 0) break;
                    str += String.fromCharCode(bytes[i]);
                }
                return str.trim();
            } else if (encoding === 1 || encoding === 2) { // UTF-16
                const decoder = new TextDecoder(encoding === 1 ? 'utf-16' : 'utf-16be');
                return decoder.decode(bytes).replace(/\0.*$/g, '').trim();
            } else if (encoding === 3) { // UTF-8
                const decoder = new TextDecoder('utf-8');
                return decoder.decode(bytes).replace(/\0.*$/g, '').trim();
            }
        } catch (e) {
            // fallback
        }
        return '';
    },

    /**
     * Decode APIC (Attached Picture) frame to Object URL
     */
    decodePictureFrame(view, offset, size) {
        try {
            const encoding = view.getUint8(offset);
            let ptr = offset + 1;

            // MIME type is null-terminated ASCII string
            let mimeType = '';
            while (ptr < offset + size && view.getUint8(ptr) !== 0) {
                mimeType += String.fromCharCode(view.getUint8(ptr));
                ptr++;
            }
            ptr++; // skip null terminator

            if (!mimeType || mimeType === 'image/') mimeType = 'image/jpeg';

            // Picture type (1 byte)
            const picType = view.getUint8(ptr);
            ptr++;

            // Description is null-terminated according to encoding
            if (encoding === 0 || encoding === 3) {
                while (ptr < offset + size && view.getUint8(ptr) !== 0) ptr++;
                ptr++;
            } else {
                while (ptr < offset + size - 1 && (view.getUint8(ptr) !== 0 || view.getUint8(ptr + 1) !== 0)) ptr += 2;
                ptr += 2;
            }

            // The rest is image binary data
            const imgDataSize = (offset + size) - ptr;
            if (imgDataSize > 0) {
                const imgBytes = new Uint8Array(view.buffer.slice(view.byteOffset + ptr, view.byteOffset + ptr + imgDataSize));
                const blob = new Blob([imgBytes], { type: mimeType });
                return URL.createObjectURL(blob);
            }
        } catch (err) {
            console.warn('Failed to parse APIC frame', err);
        }
        return null;
    },

    /**
     * Parse ID3v1 tags from last 128 bytes
     */
    parseID3v1(buffer) {
        const view = new DataView(buffer);
        if (view.byteLength < 128) return null;
        // Check "TAG"
        if (view.getUint8(0) !== 84 || view.getUint8(1) !== 65 || view.getUint8(2) !== 71) {
            return null;
        }

        const readStr = (start, length) => {
            let str = '';
            for (let i = 0; i < length; i++) {
                const c = view.getUint8(start + i);
                if (c === 0) break;
                str += String.fromCharCode(c);
            }
            return str.trim();
        };

        return {
            title: readStr(3, 30),
            artist: readStr(33, 30),
            album: readStr(63, 30),
            year: readStr(93, 4)
        };
    },

    /**
     * Generate dynamic Spotify-style modern gradient cover with initials
     */
    generateCoverArt(title, artist) {
        const canvas = document.createElement('canvas');
        canvas.width = 300;
        canvas.height = 300;
        const ctx = canvas.getContext('2d');

        // Color palettes
        const gradients = [
            ['#1db954', '#191414'],
            ['#450af5', '#8e8e93'],
            ['#e91429', '#191414'],
            ['#af2896', '#509bf5'],
            ['#ff6437', '#e13300'],
            ['#27856a', '#1e3264'],
            ['#ba5d07', '#2e77d0'],
            ['#006450', '#8400e7']
        ];

        // Seed from string
        const seed = (title + artist).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const palette = gradients[seed % gradients.length];

        const grad = ctx.createLinearGradient(0, 0, 300, 300);
        grad.addColorStop(0, palette[0]);
        grad.addColorStop(1, palette[1]);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 300, 300);

        // Subtle geometric circle overlay
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.arc(260, 40, 140, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(40, 260, 100, 0, Math.PI * 2);
        ctx.fill();

        // Music note icon or initials
        const initial = (title ? title[0] : '♪').toUpperCase();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 96px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
        ctx.shadowBlur = 12;
        ctx.fillText(initial, 150, 140);

        // Subtitle text (artist)
        ctx.font = '600 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.shadowBlur = 6;
        const displayArtist = (artist || 'Offline').length > 20 ? (artist || 'Offline').substring(0, 18) + '...' : (artist || 'Offline');
        ctx.fillText(displayArtist, 150, 220);

        return canvas.toDataURL('image/png');
    }
};

window.MetadataParser = MetadataParser;
