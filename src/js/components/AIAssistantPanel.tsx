import React, { useState, useCallback, useRef, useEffect } from "react";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import "../../css/AIAssistantPanel.css";

// Helper to generate unique IDs
export const generateUniqueId = (): string => {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

// Type for the raw schematic data from the backend (block coordinates to block ID)
export type RawSchematicType = Record<string, number>;

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
                if (cleanSchematic.timestamp !== undefined) {
                    delete cleanSchematic.timestamp;
                }
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

const AIAssistantPanel = ({
    getAvailableBlocks,
    loadAISchematic,
    isVisible,
}) => {
    const [prompt, setPrompt] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [generationHistory, setGenerationHistory] = useState<
        SchematicHistoryEntry[]
    >([]);
    const [hCaptchaToken, setHCaptchaToken] = useState<string | null>(null);
    const [captchaError, setCaptchaError] = useState<string | null>(null);
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
                    } else {
                        if (loadedHistory.length > 0) {
                            loadedHistory.sort(
                                (a, b) => b.timestamp - a.timestamp
                            );
                            setGenerationHistory(loadedHistory);
                            console.log(
                                `[AI Panel] Loaded ${loadedHistory.length} V2 schematics.`
                            );
                        }
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

    const handleGenerate = useCallback(async () => {
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
            const response = await fetch(
                `${process.env.REACT_APP_API_URL}/generate_building`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        prompt,
                        availableBlocks,
                        hCaptchaToken: hCaptchaToken,
                    }),
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

                const newHistoryEntry: SchematicHistoryEntry = {
                    id: newId,
                    ...newSchematicValue,
                };

                setGenerationHistory((prevHistory) => [
                    newHistoryEntry,
                    ...prevHistory,
                ]);
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
    }, [prompt, isLoading, getAvailableBlocks, loadAISchematic, hCaptchaToken]);

    if (!isVisible) {
        return null;
    }

    return (
        <div className="ai-assistant-panel">
            <h4>AI Building Assistant</h4>
            <textarea
                className="ai-assistant-textarea"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe what you want to build (e.g., 'a small stone hut', 'a 5 block high brick tower')"
                disabled={isLoading}
            />
            <button
                className="ai-assistant-button"
                onClick={handleGenerate}
                disabled={isLoading || !prompt.trim()}
            >
                {isLoading ? "Generating..." : "Generate Structure"}
            </button>
            {error && <div className="ai-assistant-error">{error}</div>}
            <HCaptcha
                ref={hCaptchaRef}
                sitekey={
                    process.env.REACT_APP_HCAPTCHA_SITE_KEY ||
                    "10000000-ffff-ffff-ffff-000000000001"
                } // Fallback for local dev if .env is missing
                size="compact"
                theme="dark"
                onVerify={(token) => {
                    setHCaptchaToken(token);
                    setCaptchaError(null);
                }}
                onExpire={() => {
                    setHCaptchaToken(null);
                    setCaptchaError("CAPTCHA expired. Please verify again.");
                }}
                onError={(err) => {
                    setHCaptchaToken(null);
                    setCaptchaError(`CAPTCHA error: ${err}`);
                }}
            />
            {captchaError && (
                <div className="ai-assistant-error">{captchaError}</div>
            )}
            {generationHistory.length > 0 && (
                <div
                    onWheel={(e) => {
                        e.stopPropagation(); // Prevent page scroll while scrolling history
                    }}
                    className="ai-assistant-history-list"
                >
                    <h5>History:</h5>
                    {generationHistory.map((entry) => (
                        <div
                            key={entry.id} // Use unique ID for key
                            className="ai-assistant-history-item"
                            onClick={() => loadAISchematic(entry.schematic)}
                            title={`Load: ${entry.prompt}`}
                        >
                            {entry.prompt}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
export default AIAssistantPanel;
