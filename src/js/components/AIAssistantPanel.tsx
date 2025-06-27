import React, { useState, useCallback, useRef, useEffect } from "react";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import "../../css/AIAssistantPanel.css";

// Helper to generate unique IDs
export const generateUniqueId = (): string => {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

// Type for the raw schematic data from the backend (block coordinates to block ID)
export type RawSchematicType = {
    blocks: Record<string, number>;
    entities?: Array<{
        position: [number, number, number];
        entityName: string;
        rotation?: [number, number, number];
    }>;
};

// Type for the value stored in IndexedDB against a unique ID
export interface SchematicValue {
    prompt: string;
    schematic: RawSchematicType;
    timestamp: number;
}

// Type for items in the generationHistory state, including their DB key as 'id'
export interface SchematicHistoryEntry extends SchematicValue {
    id: string;
}

const MIGRATION_MARKER_V2 = "schematicStoreMigrated_to_id_key_v2";

async function migrateSchematicStoreV2IfNeeded(
    db: IDBDatabase,
    STORES: { SCHEMATICS: string }
): Promise<void> {
    if (localStorage.getItem(MIGRATION_MARKER_V2) === "true") {
        console.log(
            "[AI Panel] Schematic store (V2) already migrated or up-to-date."
        );
        return;
    }

    console.log("[AI Panel] Checking for V2 schematic store migration...");

    // Wrap the transaction logic in a promise to await its completion
    return new Promise(async (resolveMigration, rejectMigration) => {
        const tx = db.transaction(STORES.SCHEMATICS, "readwrite");
        const store = tx.objectStore(STORES.SCHEMATICS);
        const itemsToMigrate: {
            oldKey: string; // This was the prompt
            valueToConvert: RawSchematicType & { timestamp?: number }; // Old schematic might have ad-hoc timestamp
        }[] = [];
        let migrationActuallyNeeded = false;

        // Phase 1: Collect items to migrate (read-only part within the readwrite transaction)
        const cursorRequest = store.openCursor();
        await new Promise<void>((resolveCursor, rejectCursor) => {
            cursorRequest.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest<IDBCursorWithValue>)
                    .result;
                if (cursor) {
                    const val = cursor.value;
                    if (
                        typeof cursor.key === "string" &&
                        typeof val === "object" &&
                        val !== null &&
                        val.prompt === undefined
                    ) {
                        migrationActuallyNeeded = true;
                        itemsToMigrate.push({
                            oldKey: cursor.key,
                            valueToConvert: val as RawSchematicType & {
                                timestamp?: number;
                            },
                        });
                    }
                    cursor.continue();
                } else {
                    resolveCursor(); // Cursor exhausted
                }
            };
            cursorRequest.onerror = (event) => {
                console.error(
                    "[AI Panel] Error during V2 migration check (cursor phase):",
                    (event.target as IDBRequest).error
                );
                rejectCursor((event.target as IDBRequest).error);
            };
        }).catch((error) => {
            // If cursor phase fails, reject the main migration promise and don't proceed.
            tx.abort(); // Abort the transaction
            rejectMigration(error);
            return; // Stop further execution in this path
        });

        // If cursor phase failed and rejected, the lines below won't run.

        // Phase 2: Perform writes if needed
        if (migrationActuallyNeeded && itemsToMigrate.length > 0) {
            console.log(
                `[AI Panel] Migrating ${itemsToMigrate.length} old V1 schematic entries to V2 format...`
            );
            for (const item of itemsToMigrate) {
                const newId = generateUniqueId();
                const oldSchematicData = item.valueToConvert;
                const timestamp = oldSchematicData.timestamp || Date.now();
                const cleanSchematic: RawSchematicType = {
                    ...oldSchematicData,
                };
                const newSchematicValue: SchematicValue = {
                    prompt: item.oldKey,
                    schematic: cleanSchematic,
                    timestamp: timestamp,
                };
                try {
                    store.delete(item.oldKey);
                    store.add(newSchematicValue, newId);
                } catch (e) {
                    console.error(
                        `[AI Panel] Error queueing migration operation for prompt "${item.oldKey}":`,
                        e
                    );
                    // This error is for store operation call itself, not transaction error yet.
                    // Depending on error, tx might already be unusable.
                }
            }
            console.log(
                "[AI Panel] V2 schematic store migration operations queued..."
            );
        } else {
            console.log(
                "[AI Panel] No V1 entries found requiring V2 migration."
            );
        }

        tx.oncomplete = () => {
            console.log(
                "[AI Panel] V2 migration transaction completed successfully."
            );
            localStorage.setItem(MIGRATION_MARKER_V2, "true");
            resolveMigration();
        };

        tx.onerror = (event) => {
            console.error(
                "[AI Panel] V2 migration transaction error:",
                (event.target as IDBTransaction).error // tx.error can be used here
            );
            rejectMigration((event.target as IDBTransaction).error);
        };

        // If no migration operations were queued, and we reached here, the transaction will auto-commit (if no errors).
        // If migration ops were queued, they will now execute.
    });
}

interface AIAssistantPanelProps {
    getAvailableBlocks: () => Promise<any> | any;
    getAvailableEntities?: () => Promise<any[]> | any[];
    loadAISchematic: (schematic: any) => void;
    isVisible: boolean;
    isEmbedded?: boolean;
}

const AIAssistantPanel = ({
    getAvailableBlocks,
    getAvailableEntities,
    loadAISchematic,
    isVisible,
    isEmbedded = false,
}: AIAssistantPanelProps) => {
    const [prompt, setPrompt] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hCaptchaToken, setHCaptchaToken] = useState<string | null>(null);
    const [captchaError, setCaptchaError] = useState<string | null>(null);
    const [enableEntities, setEnableEntities] = useState(false);
    const hCaptchaRef = useRef<HCaptcha>(null);

    useEffect(() => {
        const loadAndMigrateSchematics = async () => {
            try {
                const { DatabaseManager, STORES } = await import(
                    "../managers/DatabaseManager"
                );
                const db = await DatabaseManager.getDBConnection();

                // Run migration if needed
                await migrateSchematicStoreV2IfNeeded(db, STORES);

                // Proceed with loading data (now expected to be in V2 format)
                const tx = db.transaction(STORES.SCHEMATICS, "readonly");
                const store = tx.objectStore(STORES.SCHEMATICS);
                const cursorRequest = store.openCursor();
                const loadedHistory: SchematicHistoryEntry[] = [];

                cursorRequest.onsuccess = (event) => {
                    const cursor = (
                        event.target as IDBRequest<IDBCursorWithValue>
                    ).result;
                    if (cursor) {
                        const dbKey = cursor.key as string;
                        const dbValue = cursor.value as SchematicValue;

                        if (
                            dbValue &&
                            typeof dbValue.prompt === "string" &&
                            dbValue.schematic &&
                            typeof dbValue.timestamp === "number"
                        ) {
                            loadedHistory.push({
                                id: dbKey,
                                prompt: dbValue.prompt,
                                schematic: dbValue.schematic,
                                timestamp: dbValue.timestamp,
                            });
                        } else {
                            console.warn(
                                `[AI Panel] Skipping malformed V2 schematic entry (key: ${dbKey}):`,
                                dbValue
                            );
                        }
                        cursor.continue();
                    }
                };
                cursorRequest.onerror = (event) => {
                    console.error(
                        "[AI Panel] Error reading V2 schematics store:",
                        (event.target as IDBRequest).error
                    );
                };
            } catch (err) {
                console.error(
                    "[AI Panel] Error loading/migrating schematics:",
                    err
                );
            }
        };
        if (isVisible) {
            loadAndMigrateSchematics();
        }
    }, [isVisible]);

    const generateStructure = useCallback(async () => {
        if (!prompt.trim() || isLoading) return;
        setIsLoading(true);
        setError(null);
        setCaptchaError(null);

        if (!hCaptchaToken) {
            setCaptchaError("Please complete the CAPTCHA verification.");
            setIsLoading(false);
            return;
        }

        try {
            const availableBlocks = await getAvailableBlocks();
            if (!availableBlocks || availableBlocks.length === 0) {
                throw new Error("Could not retrieve available block types.");
            }

            // Build request body
            const requestBody: any = {
                prompt,
                availableBlocks,
                hCaptchaToken: hCaptchaToken,
            };

            // Add entities if enabled and available
            if (enableEntities && getAvailableEntities) {
                const availableEntities = await getAvailableEntities();
                if (availableEntities && availableEntities.length > 0) {
                    requestBody.availableEntities = availableEntities;
                    requestBody.enableEntities = true;
                }
            }

            const response = await fetch(
                `${process.env.REACT_APP_API_URL}/generate_building`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(requestBody),
                }
            );

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(
                    errorData.error || "Failed to generate building"
                );
            }

            const schematicData: RawSchematicType = await response.json();
            if (schematicData && Object.keys(schematicData).length > 0) {
                const newId = generateUniqueId();
                const newSchematicValue: SchematicValue = {
                    prompt,
                    schematic: schematicData,
                    timestamp: Date.now(),
                };
                loadAISchematic(schematicData); // loadAISchematic expects the raw schematic

                try {
                    const { DatabaseManager, STORES } = await import(
                        "../managers/DatabaseManager"
                    );
                    await DatabaseManager.saveData(
                        STORES.SCHEMATICS,
                        newId, // Unique ID as key
                        newSchematicValue // The object { prompt, schematic, timestamp } as value
                    );
                    console.log(
                        `[AI Panel] Saved V2 schematic with ID: "${newId}" for prompt: "${prompt}"`
                    );
                    window.dispatchEvent(
                        new CustomEvent("schematicsDbUpdated")
                    ); // Notify sidebar
                } catch (dbError) {
                    console.error(
                        "[AI Panel] Error saving V2 schematic to DB:",
                        dbError
                    );
                }
            } else {
                setError("AI could not generate a structure for this prompt.");
            }
        } catch (err: any) {
            console.error("Error generating AI structure:", err);
            setError(err.message || "An unexpected error occurred.");
        } finally {
            setIsLoading(false);
            setHCaptchaToken(null);
            if (hCaptchaRef.current) {
                hCaptchaRef.current.resetCaptcha();
            }
        }
    }, [
        prompt,
        isLoading,
        getAvailableBlocks,
        getAvailableEntities,
        loadAISchematic,
        hCaptchaToken,
        enableEntities,
    ]);

    const handleGenerateClick = () => {
        if (!prompt.trim() || isLoading) return;

        if (hCaptchaToken) {
            generateStructure();
            return;
        }

        setCaptchaError(null);
        // Execute the captcha verification programmatically
        if (hCaptchaRef.current) {
            try {
                hCaptchaRef.current.execute();
            } catch (error) {
                console.error("Failed to execute hCaptcha:", error);
                setCaptchaError(
                    "Failed to initiate CAPTCHA. Please try again."
                );
            }
        } else {
            setCaptchaError("CAPTCHA component not ready. Please try again.");
        }
    };

    useEffect(() => {
        if (hCaptchaToken) {
            generateStructure();
        }
    }, [hCaptchaToken, generateStructure]);

    if (!isVisible) {
        return null;
    }

    return (
        <div className={`ai-assistant-panel ${isEmbedded ? "embedded" : ""}`}>
            {/* Prevent inputs triggering keyboard shortcuts in the main app */}
            <textarea
                onKeyDown={(e) => e.stopPropagation()}
                className="text-xs bg-transparent rounded-md h-20 p-2 ring-0 outline-none border border-white/10 resize-none focus:border-white hover:border-white/20 transition-all duration-200"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe what you want to build (e.g., 'a small stone hut', 'a 5 block high brick tower')"
                disabled={isLoading}
            />
            <label className="flex items-center gap-2 text-xs text-white/80 cursor-pointer hover:text-white transition-colors">
                <input
                    type="checkbox"
                    checked={enableEntities}
                    onChange={(e) => setEnableEntities(e.target.checked)}
                    disabled={isLoading}
                    className="w-3.5 h-3.5 rounded border-white/30 bg-transparent focus:ring-1 focus:ring-white/50"
                />
                Include Models
            </label>
            <button
                className="ai-assistant-button"
                onClick={handleGenerateClick}
                disabled={isLoading || !prompt.trim()}
            >
                {isLoading ? (
                    <div className="flex items-center gap-1.5 justify-center">
                        Generating{" "}
                        <div className="w-3.5 h-3.5 border-2 border-black/30 border-t-black/80 rounded-full animate-spin" />{" "}
                    </div>
                ) : (
                    "Generate Structure"
                )}
            </button>
            {error && <div className="ai-assistant-error">{error}</div>}

            {/* Invisible hCaptcha - always in DOM but hidden */}
            <div
                style={{
                    position: "fixed",
                    visibility: "hidden",
                    bottom: 0,
                    right: 0,
                }}
            >
                <HCaptcha
                    ref={hCaptchaRef}
                    sitekey={
                        process.env.REACT_APP_HCAPTCHA_SITE_KEY ||
                        "10000000-ffff-ffff-ffff-000000000001"
                    } // Fallback for local dev if .env is missing
                    size="invisible"
                    theme="light"
                    onVerify={(token) => {
                        setHCaptchaToken(token);
                        setCaptchaError(null);
                    }}
                    onExpire={() => {
                        setHCaptchaToken(null);
                        setCaptchaError("CAPTCHA expired. Please try again.");
                    }}
                    onError={(err) => {
                        setHCaptchaToken(null);
                        setCaptchaError(`CAPTCHA error: ${err}`);
                    }}
                />
            </div>

            {captchaError && (
                <div className="ai-assistant-error">{captchaError}</div>
            )}
        </div>
    );
};
export default AIAssistantPanel;
