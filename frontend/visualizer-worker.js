let canvas = null;
let ctx = null;
let barCount = 64;
let height = 120;
let maxFill = 0.82;
let minHeight = 2;
let peak = 72;
let canvasWidth = 0;
let smoothedHeights = new Array(barCount).fill(0);

self.onmessage = (event) => {
    const msg = event.data || {};

    if (msg.type === "init") {
        canvas = msg.canvas;
        ctx = canvas.getContext("2d");
        barCount = msg.barCount || barCount;
        height = msg.height || height;
        maxFill = msg.maxFill || maxFill;
        minHeight = msg.minHeight || minHeight;
        smoothedHeights = new Array(barCount).fill(0);
        return;
    }

    if (!ctx || !canvas) return;

    if (msg.type === "clear") {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    if (msg.type !== "frame") return;

    drawFrame(msg);
    self.postMessage({ type: "frame-done" });
};

function drawFrame(msg) {
    const data = new Uint8Array(msg.data);
    const width = Math.max(1, msg.width || canvasWidth || 1);
    const minIndex = msg.minIndex || 0;
    const maxIndex = msg.maxIndex || data.length;

    if (canvasWidth !== width || canvas.height !== height) {
        canvasWidth = width;
        canvas.width = canvasWidth;
        canvas.height = height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const barWidth = canvas.width / barCount;
    const range = Math.max(1, maxIndex - minIndex);
    const rawBands = new Array(barCount);
    let framePeak = 0;

    for (let i = 0; i < barCount; i++) {
        const bandStart = Math.floor(minIndex + (i / barCount) * range);
        const bandEnd = Math.max(bandStart + 1, Math.floor(minIndex + ((i + 1) / barCount) * range));
        let sum = 0;
        let count = 0;

        for (let idx = bandStart; idx < bandEnd && idx < data.length; idx++) {
            sum += data[idx] || 0;
            count++;
        }

        const trebleLift = 1 + (i / Math.max(1, barCount - 1)) * 0.55;
        const value = (count ? sum / count : 0) * trebleLift;
        rawBands[i] = value;
        if (value > framePeak) framePeak = value;
    }

    peak = Math.max(framePeak, peak * 0.965, 48);
    const usableHeight = canvas.height * maxFill;
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "rgba(80, 255, 165, 0.92)");
    gradient.addColorStop(1, "rgba(30, 215, 96, 0.35)");
    ctx.fillStyle = gradient;

    for (let i = 0; i < barCount; i++) {
        const normalized = Math.min(1, rawBands[i] / peak);
        const shaped = Math.pow(normalized, 0.62);
        const targetHeight = Math.max(minHeight, shaped * usableHeight);
        const smoothing = targetHeight > smoothedHeights[i] ? 0.42 : 0.16;
        smoothedHeights[i] = smoothedHeights[i] * (1 - smoothing) + targetHeight * smoothing;

        const barHeight = Math.min(usableHeight, smoothedHeights[i]);
        ctx.fillRect(
            i * barWidth + 1,
            canvas.height - barHeight,
            Math.max(1, barWidth - 2),
            barHeight
        );
    }
}
