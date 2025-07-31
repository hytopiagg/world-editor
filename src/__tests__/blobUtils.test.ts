import { dataURLtoBlob, createPlaceholderBlob } from "../js/utils/blobUtils";

// A minimal 1×1 PNG data‐URL (base64 encoded)
const ONE_BY_ONE_PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";

describe("blobUtils", () => {
    describe("dataURLtoBlob", () => {
        it("returns null when passed an invalid data URL", () => {
            expect(dataURLtoBlob("not-a-data-url")).toBeNull();
            expect(dataURLtoBlob(undefined)).toBeNull();
            expect(dataURLtoBlob(null)).toBeNull();
        });

        it("creates a Blob with the correct MIME type when given a valid data URL", () => {
            const blob = dataURLtoBlob(ONE_BY_ONE_PNG);
            expect(blob).not.toBeNull();
            expect(blob).toBeInstanceOf(Blob);
            expect(blob?.type).toBe("image/png");
        });
    });

    describe("createPlaceholderBlob", () => {
        it("creates a non-empty PNG Blob", async () => {
            const blob = await createPlaceholderBlob();
            expect(blob).not.toBeNull();
            expect(blob).toBeInstanceOf(Blob);
            expect(blob?.type).toBe("image/png");
            // Size should be > 0 (arbitrary sanity check)
            expect(blob?.size).toBeGreaterThan(0);
        });
    });
});
