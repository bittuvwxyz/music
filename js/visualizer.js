/**
 * Real-time Web Audio API Spectrum Visualizer
 * Renders Spotify-style frequency bars, waveform, and pulsing audio reactions
 */

class AudioVisualizer {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d');
        this.analyser = null;
        this.dataArray = null;
        this.animationId = null;
        this.mode = 'bars'; // 'bars', 'wave', 'circle'
        this.isActive = false;
        this.accentColor = StorageManager.getThemeAccent ? StorageManager.getThemeAccent() : '#1db954';

        this.initResize();
    }

    setThemeColor(color) {
        this.accentColor = color;
    }

    initResize() {
        const resize = () => {
            if (!this.canvas) return;
            const rect = this.canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            this.ctx.scale(dpr, dpr);
            this.width = rect.width;
            this.height = rect.height;
        };
        window.addEventListener('resize', resize);
        // Delay slight tick for layout stabilization
        setTimeout(resize, 100);
    }

    connect(analyserNode) {
        this.analyser = analyserNode;
        this.analyser.fftSize = 256;
        const bufferLength = this.analyser.frequencyBinCount;
        this.dataArray = new Uint8Array(bufferLength);
    }

    start() {
        if (this.isActive) return;
        this.isActive = true;
        this.render();
    }

    stop() {
        this.isActive = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.ctx && this.width) {
            this.ctx.clearRect(0, 0, this.width, this.height);
        }
    }

    setMode(mode) {
        this.mode = mode;
    }

    render() {
        if (!this.isActive) return;

        this.animationId = requestAnimationFrame(() => this.render());
        if (!this.analyser || !this.dataArray || !this.width) return;

        if (this.mode === 'wave') {
            this.analyser.getByteTimeDomainData(this.dataArray);
            this.drawWave();
        } else if (this.mode === 'circle') {
            this.analyser.getByteFrequencyData(this.dataArray);
            this.drawCircle();
        } else {
            this.analyser.getByteFrequencyData(this.dataArray);
            this.drawBars();
        }
    }

    drawBars() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.clearRect(0, 0, w, h);

        const count = 48; // number of bars to draw
        const barWidth = (w / count) - 2.5;
        let x = 0;

        for (let i = 0; i < count; i++) {
            // Pick logarithmic or distributed frequency bins
            const binIdx = Math.floor(Math.pow(i / count, 1.4) * (this.dataArray.length * 0.75));
            const val = this.dataArray[binIdx] || 0;
            const percent = val / 255;
            const barHeight = Math.max(3, percent * (h - 10));

            // Dynamic theme gradient
            const grad = ctx.createLinearGradient(0, h - barHeight, 0, h);
            grad.addColorStop(0, this.accentColor);
            grad.addColorStop(1, '#121212');

            ctx.fillStyle = grad;
            ctx.beginPath();
            // Rounded bar top
            const radius = Math.min(barWidth / 2, 4);
            const y = h - barHeight;

            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + barWidth - radius, y);
            ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
            ctx.lineTo(x + barWidth, h);
            ctx.lineTo(x, h);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
            ctx.closePath();
            ctx.fill();

            // Peak cap dot
            if (percent > 0.1) {
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(x + barWidth / 2, Math.max(2, y - 4), Math.min(2, barWidth / 3), 0, Math.PI * 2);
                ctx.fill();
            }

            x += barWidth + 2.5;
        }
    }

    drawWave() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.clearRect(0, 0, w, h);

        ctx.lineWidth = 3;
        ctx.strokeStyle = this.accentColor;
        ctx.shadowColor = this.accentColor;
        ctx.shadowBlur = 10;
        ctx.beginPath();

        const sliceWidth = w / this.dataArray.length;
        let x = 0;

        for (let i = 0; i < this.dataArray.length; i++) {
            const v = this.dataArray[i] / 128.0;
            const y = (v * h) / 2;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            x += sliceWidth;
        }

        ctx.lineTo(w, h / 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
    }

    drawCircle() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        const centerX = w / 2;
        const centerY = h / 2;
        const baseRadius = Math.min(w, h) * 0.25;

        ctx.clearRect(0, 0, w, h);

        const count = 64;
        ctx.save();
        ctx.translate(centerX, centerY);

        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const binIdx = Math.floor((i / count) * (this.dataArray.length * 0.6));
            const val = this.dataArray[binIdx] || 0;
            const barLen = (val / 255) * (baseRadius * 0.9);

            const x1 = Math.cos(angle) * baseRadius;
            const y1 = Math.sin(angle) * baseRadius;
            const x2 = Math.cos(angle) * (baseRadius + barLen);
            const y2 = Math.sin(angle) * (baseRadius + barLen);

            ctx.strokeStyle = this.accentColor;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }

        // Inner glowing core
        ctx.fillStyle = '#181818';
        ctx.beginPath();
        ctx.arc(0, 0, baseRadius - 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

window.AudioVisualizer = AudioVisualizer;
