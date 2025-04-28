import { version } from "../Constants";
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
};
export class DatabaseManager {
    static DB_NAME = "hytopia-world-editor-" + version;
    static DB_VERSION = 2; // Incremented version number
    static dbConnection = null; // Add static property to store connection
    static async openDB() {

        if (this.dbConnection) {
            return Promise.resolve(this.dbConnection);
        }
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.dbConnection = request.result;
                resolve(request.result);
            };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;

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
    static async saveData(storeName, key, data) {
        const db = await this.getConnection();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, "readwrite");
            const store = transaction.objectStore(storeName);
            const request = store.put(data, key);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    }
    static async getData(storeName, key) {

        const db = await this.getDBConnection();
        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(storeName, "readonly");
                const store = tx.objectStore(storeName);

                if (storeName === STORES.TERRAIN && key === "current") {
                    const terrainData = {};
                    const cursorRequest = store.openCursor();
                    cursorRequest.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {

                            terrainData[cursor.key] = cursor.value;
                            cursor.continue();
                        } else {

                            console.log(
                                `[DB] Reconstructed terrain data with ${
                                    Object.keys(terrainData).length
                                } blocks from store '${storeName}'`
                            );
                            resolve(terrainData);
                        }
                    };
                    cursorRequest.onerror = (event) => {
                        console.error(
                            `[DB] Error reading terrain store with cursor:`,
                            event.target.error
                        );
                        reject(event.target.error);
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
    static async deleteData(storeName, key) {
        const db = await this.getConnection();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, "readwrite");
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    }
    static async clearStore(storeName) {
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


            window.IS_DATABASE_CLEARING = true;
            let clearedStores = 0;

            for (const storeName of Object.values(STORES)) {
                try {
                    await this.clearStore(storeName);
                    clearedStores++;
                    console.log(
                        `Cleared store ${storeName} (${clearedStores}/${
                            Object.values(STORES).length
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
                `Database clearing complete. Cleared ${clearedStores}/${
                    Object.values(STORES).length
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
            window.IS_DATABASE_CLEARING = false; // Reset the flag
            console.error("Unhandled error during database clearing:", error);
            alert(
                "There was an error clearing the database. Please check the console for details."
            );
        }
    }
}
