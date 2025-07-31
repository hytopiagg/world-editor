/*
  Tests for the low-level mouse handlers that live in utils/TerrainMouseUtils.tsx.
  These helpers are used by TerrainBuilder during block placement but can be
  exercised in isolation with lightweight mocks so we do not need to mount the
  full React/Three application.
*/

// ---------------------------------------------------------------------------
// Test setup & mocks
// ---------------------------------------------------------------------------

// The handlers rely on Three.js vector classes. We provide extremely thin
// stand-ins that implement only the subset of behaviour required by the tests
// (copy/distanceTo etc.) so that we do not need a real WebGL context.
jest.mock("three", () => {
    class Vector3 {
        constructor(x = 0, y = 0, z = 0) {
            this.x = x;
            this.y = y;
            this.z = z;
        }
        copy(v) {
            this.x = v.x;
            this.y = v.y;
            this.z = v.z;
            return this;
        }
        distanceTo(v) {
            const dx = this.x - v.x;
            const dy = this.y - v.y;
            const dz = this.z - v.z;
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
    }
    class Vector2 extends Vector3 {
        constructor(x = 0, y = 0) {
            super(x, y, 0);
        }
    }
    class Plane {
        constructor() {}
    }
    return { Vector2, Vector3, Plane, MOUSE: { PAN: 0, ROTATE: 1 } };
});

// Mock playPlaceSound so we can assert that it would be called without loading
// the actual audio asset.
jest.mock("../js/Sound", () => ({ playPlaceSound: jest.fn() }));

// Re-import after mocks
const {
    handleTerrainMouseDown,
    handleTerrainMouseUp,
} = require("../js/utils/TerrainMouseUtils");
const { playPlaceSound } = require("../js/Sound");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createMockRefs() {
    return {
        toolManagerRef: {
            current: { getActiveTool: jest.fn().mockReturnValue(null) },
        },
        isPlacingRef: { current: false },
        placedBlockCountRef: { current: 0 },
        placedEnvironmentCountRef: { current: 0 },
        recentlyPlacedBlocksRef: { current: new Set() },
        placementChangesRef: {
            current: {
                terrain: { added: {}, removed: {} },
                environment: { added: [], removed: [] },
            },
        },
        currentPlacingYRef: { current: 0 },
        previewPositionRef: { current: { x: 0, y: 64, z: 0, copy: jest.fn() } },
        rawPlacementAnchorRef: { current: { copy: jest.fn() } },
        isFirstBlockRef: { current: false },
    };
}

// Create a very shallow raycaster stub – we only need the `ray.intersectPlane`
// function that is used when calculating the raw ground anchor.
function createMockRaycaster() {
    return {
        ray: {
            intersectPlane: jest.fn(),
        },
    };
}

// Basic stub that fulfils the API queried by the mouse handlers without pulling
// in the full implementation.
const cameraManager = {
    isPointerUnlockedMode: true,
    isPointerLocked: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TerrainMouseUtils", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("handleTerrainMouseDown", () => {
        it("enters placing mode and plays a sound on left mouse down when no tool is active", () => {
            const refs = createMockRefs();
            const threeRaycaster = createMockRaycaster();

            const mouseEvent = { button: 0, type: "mousedown" };

            handleTerrainMouseDown(
                mouseEvent,
                refs.toolManagerRef,
                refs.isPlacingRef,
                refs.placedBlockCountRef,
                refs.placedEnvironmentCountRef,
                refs.recentlyPlacedBlocksRef,
                refs.placementChangesRef,
                () => null, // getRaycastIntersection stub returns null → fine for this unit test
                refs.currentPlacingYRef,
                refs.previewPositionRef,
                refs.rawPlacementAnchorRef,
                refs.isFirstBlockRef,
                jest.fn(), // updatePreviewPosition
                jest.fn(), // handleBlockPlacement
                playPlaceSound,
                threeRaycaster,
                cameraManager,
                { current: { isComponent: false } } // currentBlockTypeRef
            );

            // The handler should mark that we are now in "placing" mode
            expect(refs.isPlacingRef.current).toBe(true);
            // and play the placement sound exactly once
            expect(playPlaceSound).toHaveBeenCalledTimes(1);
            // The ground-plane raycast should have been attempted
            expect(threeRaycaster.ray.intersectPlane).toHaveBeenCalled();
        });

        it("ignores non-left mouse buttons in unlocked pointer mode", () => {
            const refs = createMockRefs();
            const mouseEvent = { button: 1, type: "mousedown" }; // middle click

            handleTerrainMouseDown(
                mouseEvent,
                refs.toolManagerRef,
                refs.isPlacingRef,
                refs.placedBlockCountRef,
                refs.placedEnvironmentCountRef,
                refs.recentlyPlacedBlocksRef,
                refs.placementChangesRef,
                () => null,
                refs.currentPlacingYRef,
                refs.previewPositionRef,
                refs.rawPlacementAnchorRef,
                refs.isFirstBlockRef,
                jest.fn(),
                jest.fn(),
                playPlaceSound,
                createMockRaycaster(),
                cameraManager,
                { current: { isComponent: false } }
            );

            expect(refs.isPlacingRef.current).toBe(false);
            expect(playPlaceSound).not.toHaveBeenCalled();
        });
    });

    describe("handleTerrainMouseUp", () => {
        it("exits placing mode and resets counters on mouse up", () => {
            const refs = createMockRefs();
            refs.isPlacingRef.current = true; // pretend we are in placing mode already
            refs.placedBlockCountRef.current = 5;
            refs.recentlyPlacedBlocksRef.current.add("0,64,0");

            const mockSpatialGridManager = {
                updateBlocks: jest.fn(),
            };

            const mouseEvent = { button: 0, type: "mouseup" };

            handleTerrainMouseUp(
                mouseEvent,
                refs.toolManagerRef,
                refs.isPlacingRef,
                refs.placedBlockCountRef,
                refs.placedEnvironmentCountRef,
                refs.recentlyPlacedBlocksRef,
                { current: { "0,64,0": 1 } }, // terrainRef stub containing one block
                { current: mockSpatialGridManager },
                { current: { saveUndo: jest.fn() } }, // undoRedoManager stub
                refs.placementChangesRef,
                { current: {} }, // ref stub
                () => null // getRaycastIntersection
            );

            expect(refs.isPlacingRef.current).toBe(false);
            expect(mockSpatialGridManager.updateBlocks).toHaveBeenCalled();
            expect(refs.recentlyPlacedBlocksRef.current.size).toBe(0);
            expect(refs.placedBlockCountRef.current).toBe(0);
        });
    });
});
