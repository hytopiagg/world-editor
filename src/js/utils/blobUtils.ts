export const dataURLtoBlob = (
    dataurl: string | null | undefined
): Blob | null => {
    if (!dataurl || !dataurl.startsWith("data:image")) return null;
    try {
        const arr = dataurl.split(",");
        if (arr.length < 2) return null; // Ensure there are two parts
        const mimeMatch = arr[0].match(/:(.*?);/);
        if (!mimeMatch || mimeMatch.length < 2) return null; // Ensure match and group exist
        const mime = mimeMatch[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    } catch (e) {
        console.error("Error converting data URL to Blob:", e);
        return null;
    }
};

export const createPlaceholderBlob = (): Promise<Blob | null> => {
    const canvas = document.createElement("canvas");
    canvas.width = 16; // Or your default texture size
    canvas.height = 16;
    const ctx = canvas.getContext("2d");
    if (ctx) {
        ctx.fillStyle = "#FF00FF"; // Magenta for obvious placeholder
        ctx.fillRect(0, 0, 16, 16);
        // Draw a cross to indicate placeholder
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(16, 16);
        ctx.moveTo(16, 0);
        ctx.lineTo(0, 16);
        ctx.stroke();

        return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    }
    console.error("Could not get 2D context for placeholder canvas");
    return Promise.resolve(null); // Fallback
};
