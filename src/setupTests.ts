// Jest setup file for global test configurations
// Adds jest-dom assertions and mocks necessary browser APIs like Canvas

import "@testing-library/jest-dom";

// -----------------------------------------------------------------------------
// Canvas API mocks
// -----------------------------------------------------------------------------
// Some utility functions (e.g. createPlaceholderBlob) rely on basic Canvas APIs
// such as getContext() and toBlob(). JSDOM provides a minimal canvas element
// but does not implement these methods, so we provide lightweight mocks that are
// sufficient for our unit–test purposes.

// Override CanvasRenderingContext stub regardless of whether jsdom provides one.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – jsdom types do not list getContext for canvas
HTMLCanvasElement.prototype.getContext = () => {
    return {
        // Color & style properties
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 0,
        // Drawing API stubs
        fillRect: jest.fn(),
        beginPath: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        stroke: jest.fn(),
    } as unknown as CanvasRenderingContext2D;
};

// Stub out webpack's require.context which isn't available in Jest environments.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
if (typeof (require as any).context === "undefined") {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    (require as any).context = () => {
        const keys = () => [] as string[];
        (keys as any).keys = keys;
        return keys;
    };
}

// Provide our own toBlob implementation to avoid jsdom "Not implemented" error.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – jsdom provides toBlob but it throws; we replace it.
HTMLCanvasElement.prototype.toBlob = function (
    callback: (blob: Blob | null) => void,
    type?: string
) {
    const data = atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg=="
    );
    const array = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
        array[i] = data.charCodeAt(i);
    }
    callback(new Blob([array], { type: type || "image/png" }));
};
