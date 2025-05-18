import { DB_VERSION } from "../Constants";
import { loadingManager } from "./LoadingManager";
export const STORES = {
    TERRAIN: "terrain",
    ENVIRONMENT: "environment",
    PREVIEWS: "environment-icons",
    SETTINGS: "settings",
    CUSTOM_BLOCKS: "custom-blocks",
    CUSTOM_MODELS: "custom-models",
    UNDO: "undo-states",
    REDO: "redo-states",
    SCHEMATICS: "ai-schematics",
    ENVIRONMENT_MODEL_SETTINGS: "environment-model-settings",
};
export class DatabaseManager {
    static DB_NAME = "hytopia-world-editor-db-v" + DB_VERSION;
    static dbConnection = null; // Add static property to store connection
    static async openDB() {
        if (this.dbConnection) {
            return Promise.resolve(this.dbConnection);
        }
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, DB_VERSION);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.dbConnection = request.result;
                resolve(request.result);
            };
            request.onupgradeneeded = (event) => {

                const db = (event.target as IDBOpenDBRequest).result;

                Object.values(STORES).forEach((storeName) => {
                    if (!db.objectStoreNames.contains(storeName)) {
                        db.createObjectStore(storeName);
                    }
                });
            };
        });
    }

    static async getConnection() {
        if (!this.dbConnection || this.dbConnection.closed) {
            this.dbConnection = await this.openDB();
        }
        return this.dbConnection;
    }

    static async getDBConnection() {
        return this.getConnection();
    }
    static async saveData(storeName: string, key: string, data: any): Promise<void> {
        console.log("saveData", storeName, key, data);
        const db = await this.getConnection();
        return new Promise((resolve, reject) => {

            if ((storeName === STORES.TERRAIN || storeName === STORES.ENVIRONMENT) && key === "current") {
                try {
                    const transaction = db.transaction(storeName, "readwrite");
                    const store = transaction.objectStore(storeName);


                    const clearRequest = store.clear();

                    clearRequest.onsuccess = async () => {
                        const entries = Object.entries(data);
                        const totalEntries = entries.length;
                        const CHUNK_SIZE = 500000;

                        console.log(`[DB] Cleared ${storeName}. Starting to save ${totalEntries} items in chunks of ${CHUNK_SIZE}...`);

                        try {
                            for (let i = 0; i < totalEntries; i += CHUNK_SIZE) {
                                const chunk = entries.slice(i, i + CHUNK_SIZE);
                                const chunkNum = i / CHUNK_SIZE + 1;
                                const totalChunks = Math.ceil(totalEntries / CHUNK_SIZE);

                                console.log(`[DB] Saving chunk ${chunkNum}/${totalChunks} (${chunk.length} items) for ${storeName}...`);

                                // Start a new transaction for each chunk
                                await new Promise<void>((resolveChunk, rejectChunk) => {
                                    const chunkTransaction = db.transaction(storeName, "readwrite");
                                    const chunkStore = chunkTransaction.objectStore(storeName);
                                    let promisesInChunk: Promise<void>[] = [];

                                    if (storeName === STORES.TERRAIN) {
                                        promisesInChunk = chunk.map(([coordKey, blockId]) => {
                                            return new Promise<void>((resolvePut, rejectPut) => {
                                                const putRequest = chunkStore.put(blockId, coordKey);
                                                // It's often better to rely on transaction completion/error
                                                // rather than individual put success/error within a chunk transaction
                                                // but we can keep them for finer-grained potential error reporting if needed.
                                                putRequest.onsuccess = () => resolvePut();
                                                putRequest.onerror = (e) => rejectPut(putRequest.error);
                                            });
                                        });
                                    } else if (storeName === STORES.ENVIRONMENT) {
                                        promisesInChunk = chunk.map(([key, val]) => {
                                            return new Promise<void>((resolvePut, rejectPut) => {
                                                const putRequest = chunkStore.put(val, key);
                                                putRequest.onsuccess = () => resolvePut();
                                                putRequest.onerror = (e) => rejectPut(putRequest.error);
                                            });
                                        });
                                    }

                                    // Wait for all puts in the chunk *within the context of the transaction*
                                    Promise.all(promisesInChunk).catch(rejectChunk); // Catch potential individual put errors

                                    chunkTransaction.oncomplete = () => {
                                        console.log(`[DB] Chunk ${chunkNum}/${totalChunks} for ${storeName} saved successfully.`);
                                        resolveChunk();
                                    };
                                    chunkTransaction.onerror = (event) => {
                                        console.error(`[DB] Error saving chunk ${chunkNum}/${totalChunks} for ${storeName}:`, event.target.error);
                                        rejectChunk(event.target.error); // Reject the chunk promise
                                    };
                                });
                                // If we reach here, the chunk transaction completed successfully
                            }

                            console.log(`[DB] Successfully saved all ${totalEntries} items to ${storeName} in chunks.`);
                            resolve(); // Resolve the main saveData promise
                        } catch (error) {
                            console.error(`[DB] Error during chunked save process for ${storeName}:`, error);
                            reject(error); // Reject the main saveData promise if any chunk fails
                        }
                    };

                    clearRequest.onerror = (event) => {
                        console.error(
                            `[DB] Error clearing ${storeName} store:`,
                            event.target.error
                        );
                        reject(event.target.error);
                    };
                } catch (error) {
                    console.error(
                        `[DB] Error in ${storeName} saveData transaction:`,
                        error
                    );
                    reject(error);
                }
            } else {

                const transaction = db.transaction(storeName, "readwrite");
                const store = transaction.objectStore(storeName);
                const request = store.put(data, key);

                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve();
            }
        });
    }
    static async getData(storeName, key) {
        const db = await this.getDBConnection();
        return new Promise((resolve, reject) => {
            try {
                // Gracefully handle requests for object stores that do not yet exist in the current DB version.
                // This can happen when users are running an older database version that was created before
                // the store was introduced (e.g. `environment-model-settings`).
                if (!db.objectStoreNames.contains(storeName)) {
                    console.warn(
                        `[DB] Requested store '${storeName}' does not exist on this client. Returning undefined.`
                    );
                    resolve(undefined);
                    return; // Exit early so we don't attempt to start a transaction on a non-existent store.
                }
                const tx = db.transaction(storeName, "readonly");
                const store = tx.objectStore(storeName);

                if ((storeName === STORES.TERRAIN || storeName === STORES.ENVIRONMENT) && key === "current") {
                    console.log(`Checking ${storeName} data size...`);
                    const countRequest = store.count();

                    countRequest.onerror = (event) => {
                        console.error(
                            `[DB] Error counting ${storeName} store:`,
                            event.target.error
                        );
                        reject(event.target.error); // Reject if count fails
                    };

                    countRequest.onsuccess = async (event) => {
                        const count = event.target.result;
                        console.log(
                            `[DB] ${storeName} store contains ${count} items.`
                        );
                        const SIZE_THRESHOLD = 2000000; // Example: Use bulk get below 2 million items



                        const dataTx = db.transaction(storeName, "readonly");
                        const dataStore = dataTx.objectStore(storeName);
                        let data = {};

                        if (count < SIZE_THRESHOLD) {
                            if (loadingManager.isLoading) {
                                loadingManager.updateLoading(
                                    `Loading ${storeName} in memory...`
                                );
                            }
                            try {
                                const keysRequest = dataStore.getAllKeys();
                                const valuesRequest = dataStore.getAll();


                                const [keys, values] = await Promise.all([
                                    new Promise((res, rej) => {
                                        keysRequest.onsuccess = () =>
                                            res(keysRequest.result);
                                        keysRequest.onerror = rej;
                                    }),
                                    new Promise((res, rej) => {
                                        valuesRequest.onsuccess = () =>
                                            res(valuesRequest.result);
                                        valuesRequest.onerror = rej;
                                    }),
                                ]) as [string[], any[]];

                                if (keys.length !== values.length) {
                                    console.error(
                                        "[DB] Mismatch between keys and values count in bulk get!"
                                    );

                                    reject(
                                        new Error(
                                            "Key/Value count mismatch in bulk retrieval"
                                        )
                                    );
                                    return;
                                }

                                for (let i = 0; i < keys.length; i++) {
                                    data[keys[i]] = values[i];
                                }
                                console.log(
                                    `[DB] Reconstructed ${storeName} data with ${keys.length} items using bulk get.`
                                );
                                resolve(data);
                            } catch (error) {
                                console.error(
                                    `[DB] Error during bulk retrieval:`,
                                    error.target ? error.target.error : error
                                );
                                reject(
                                    error.target ? error.target.error : error
                                );
                            }
                        } else {

                            console.log("[DB] Using cursor retrieval.");
                            let index = 0;
                            const cursorRequest = dataStore.openCursor();

                            cursorRequest.onsuccess = (event) => {
                                const cursor = event.target.result;
                                if (cursor) {
                                    data[cursor.key] = cursor.value;
                                    index++;
                                    if (index % 5000 === 0 || index === count) {

                                        loadingManager.updateLoading(
                                            `Loading ${storeName}... ${index}/${count}`
                                        );
                                    }
                                    cursor.continue();
                                } else {
                                    console.log(
                                        `[DB] Reconstructed ${storeName} data with ${index} items using cursor.`
                                    );
                                    resolve(data);
                                }
                            };
                            cursorRequest.onerror = (event) => {
                                console.error(
                                    `[DB] Error reading ${storeName} store with cursor:`,
                                    event.target.error
                                );
                                reject(event.target.error);
                            };
                        }
                    };
                } else {

                    const request = store.get(key);
                    request.onsuccess = () => {
                        resolve(request.result);
                    };
                    request.onerror = (event) => {
                        console.error(
                            `[DB] Error getting data for key '${key}' from store '${storeName}':`,
                            event.target.error
                        );
                        reject(event.target.error);
                    };
                }
            } catch (error) {
                console.error(
                    `[DB] Exception during getData transaction for key '${key}' in store '${storeName}':`,
                    error
                );
                reject(error);
            }
        });
    }
    static async deleteData(storeName: string, key: string): Promise<void> {
        const db = await this.getConnection();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, "readwrite");
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    }
    static async clearStore(storeName: string): Promise<void> {
        try {
            const db = await this.getConnection();

            if (!db.objectStoreNames.contains(storeName)) {
                console.log(
                    `Store ${storeName} does not exist, skipping clear`
                );
                return;
            }
            return new Promise((resolve, reject) => {
                try {
                    const transaction = db.transaction(storeName, "readwrite");
                    const store = transaction.objectStore(storeName);
                    const request = store.clear();
                    request.onerror = (event) => {
                        console.error(
                            `Error clearing store ${storeName}:`,
                            event.target.error
                        );

                        resolve();
                    };
                    request.onsuccess = () => {
                        console.log(`Successfully cleared store: ${storeName}`);
                        resolve();
                    };

                    transaction.onerror = (event) => {
                        console.error(
                            `Transaction error clearing store ${storeName}:`,
                            event.target.error
                        );

                        resolve();
                    };
                } catch (innerError) {
                    console.error(
                        `Exception during transaction setup for ${storeName}:`,
                        innerError
                    );

                    resolve();
                }
            });
        } catch (error) {
            console.error(`Error accessing store ${storeName}:`, error);

            return Promise.resolve();
        }
    }
    static async clearDatabase() {
        const confirmed = window.confirm(
            "Warning: This will clear all data including the terrain, environment, and custom blocks. \n\nAre you sure you want to continue?"
        );
        if (!confirmed) {
            return; // User cancelled the operation
        }
        try {
            console.log("Starting database clearing process...");

            localStorage.setItem("IS_DATABASE_CLEARING", "true");
            let clearedStores = 0;

            for (const storeName of Object.values(STORES)) {
                try {
                    await this.clearStore(storeName);
                    clearedStores++;
                    console.log(
                        `Cleared store ${storeName} (${clearedStores}/${Object.values(STORES).length
                        })`
                    );
                } catch (storeError) {
                    console.error(
                        `Failed to clear store ${storeName}, continuing with others:`,
                        storeError
                    );
                }
            }
            console.log(
                `Database clearing complete. Cleared ${clearedStores}/${Object.values(STORES).length
                } stores.`
            );

            const existingBeforeUnloadHandler = window.onbeforeunload;
            window.onbeforeunload = null;

            setTimeout(() => {
                try {
                    window.location.href = window.location.href;
                } catch (reloadError) {
                    console.error("Error during reload:", reloadError);
                    alert(
                        "Database cleared, but there was an error refreshing the page. Please refresh manually."
                    );
                }
            }, 100);
        } catch (error) {
            localStorage.removeItem("IS_DATABASE_CLEARING"); // Reset the flag
            console.error("Unhandled error during database clearing:", error);
            alert(
                "There was an error clearing the database. Please check the console for details."
            );
        }
    }
}
