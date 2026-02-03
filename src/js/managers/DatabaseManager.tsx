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
    PROJECTS: "projects",
    BLOCK_OVERRIDES: "block-overrides",
    ZONES: "zones",
    PROJECT_SETTINGS: "project-settings", // For per-project settings like liquid blocks, etc.
    SCREENSHOTS: "screenshots",
};
// Migration status for UI feedback
export interface MigrationStatus {
    inProgress: boolean;
    currentStore: string;
    currentStoreIndex: number;
    totalStores: number;
    itemsProcessed: number;
    totalItems: number;
    message: string;
}

export class DatabaseManager {
    static DB_NAME = "hytopia-world-editor-db-v" + DB_VERSION;
    static dbConnection = null; // Add static property to store connection
    static currentProjectId: string | null = null;
    static migrationStatus: MigrationStatus = {
        inProgress: false,
        currentStore: "",
        currentStoreIndex: 0,
        totalStores: 0,
        itemsProcessed: 0,
        totalItems: 0,
        message: "",
    };
    static migrationListeners: Set<(status: MigrationStatus) => void> = new Set();

    static addMigrationListener(callback: (status: MigrationStatus) => void) {
        this.migrationListeners.add(callback);
    }

    static removeMigrationListener(callback: (status: MigrationStatus) => void) {
        this.migrationListeners.delete(callback);
    }

    private static notifyMigrationListeners() {
        this.migrationListeners.forEach(cb => {
            try { cb({ ...this.migrationStatus }); } catch (_) { }
        });
        // Also dispatch a global event
        window.dispatchEvent(new CustomEvent("db-migration-progress", { detail: { ...this.migrationStatus } }));
    }

    private static updateMigrationStatus(updates: Partial<MigrationStatus>) {
        this.migrationStatus = { ...this.migrationStatus, ...updates };
        this.notifyMigrationListeners();
    }

    static isMigrating(): boolean {
        return this.migrationStatus.inProgress;
    }

    static getMigrationStatus(): MigrationStatus {
        return { ...this.migrationStatus };
    }

    // ---------- Project helpers ----------
    static getCurrentProjectId(): string {
        if (this.currentProjectId) return this.currentProjectId;
        try {
            const stored = localStorage.getItem("CURRENT_PROJECT_ID");
            if (stored && typeof stored === "string" && stored !== "null") {
                this.currentProjectId = stored;
                return stored;
            }
        } catch (_) { }
        // No active project
        return "";
    }
    static setCurrentProjectId(projectId: string | null) {
        this.currentProjectId = projectId || null;
        try {
            if (projectId) {
                localStorage.setItem("CURRENT_PROJECT_ID", projectId);
            } else {
                localStorage.removeItem("CURRENT_PROJECT_ID");
            }
        } catch (_) { }
    }
    static composeKey(localKey: string, projectId?: string) {
        const pid = projectId || this.getCurrentProjectId();
        return `${pid}::${localKey}`;
    }
    static prefixForProject(projectId?: string) {
        const pid = projectId || this.getCurrentProjectId();
        return `${pid}::`;
    }
    static makePrefixRange(prefix: string) {
        const upper = `${prefix}\uffff`;
        return IDBKeyRange.bound(prefix, upper);
    }
    static async openDB() {
        if (this.dbConnection) {
            return Promise.resolve(this.dbConnection);
        }

        // First, check if we need to migrate from an older versioned database
        await this.migrateFromOlderVersionedDB();

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, DB_VERSION);
            request.onerror = () => {
                reject(request.error);
            };
            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                const oldVersion = event.oldVersion;
                console.log(`[DB] Upgrading from version ${oldVersion} to ${DB_VERSION}`);

                // Create any missing stores
                Object.values(STORES).forEach((storeName) => {
                    if (!db.objectStoreNames.contains(storeName)) {
                        console.log(`[DB] Creating store: ${storeName}`);
                        db.createObjectStore(storeName);
                    }
                });
            };
            request.onsuccess = async () => {
                this.dbConnection = request.result;

                // Check if all required stores exist (roll-forward fix for v3->v4)
                // This handles the case where the DB was created before ZONES store was added
                const missingStores = Object.values(STORES).filter(
                    storeName => !this.dbConnection.objectStoreNames.contains(storeName)
                );

                if (missingStores.length > 0) {
                    console.log(`[DB] Missing stores detected: ${missingStores.join(', ')}. Triggering roll-forward upgrade...`);
                    const currentVersion = this.dbConnection.version;
                    this.dbConnection.close();
                    this.dbConnection = null;

                    // Reopen with a higher version to trigger onupgradeneeded
                    const newVersion = currentVersion + 1;
                    console.log(`[DB] Reopening DB at version ${newVersion} to create missing stores`);

                    try {
                        await new Promise<void>((resolveUpgrade, rejectUpgrade) => {
                            const upgradeRequest = indexedDB.open(this.DB_NAME, newVersion);
                            upgradeRequest.onerror = () => rejectUpgrade(upgradeRequest.error);
                            upgradeRequest.onupgradeneeded = (event) => {
                                const db = (event.target as IDBOpenDBRequest).result;
                                console.log(`[DB] Roll-forward upgrade: Creating missing stores from version ${event.oldVersion} to ${newVersion}`);

                                // Create any missing stores
                                Object.values(STORES).forEach((storeName) => {
                                    if (!db.objectStoreNames.contains(storeName)) {
                                        console.log(`[DB] Creating missing store: ${storeName}`);
                                        db.createObjectStore(storeName);
                                    }
                                });
                            };
                            upgradeRequest.onsuccess = () => {
                                this.dbConnection = upgradeRequest.result;
                                console.log(`[DB] Roll-forward upgrade complete. All stores now exist at version ${newVersion}.`);
                                resolveUpgrade();
                            };
                        });
                    } catch (upgradeError) {
                        console.error("[DB] Error during roll-forward upgrade:", upgradeError);
                        reject(upgradeError);
                        return;
                    }
                }

                try {
                    await this.migrateLegacyIfNeeded(this.dbConnection);
                } catch (e) {
                    console.warn("[DB] Migration check failed:", e);
                }
                resolve(this.dbConnection);
            };
        });
    }

    /**
     * Migrate data from older versioned databases (v3 -> v4)
     * This handles the case where DB_NAME includes version number
     */
    static async migrateFromOlderVersionedDB(): Promise<void> {
        // Check if migration is needed by looking for old databases
        const oldDbNames = [
            "hytopia-world-editor-db-v3",
            "hytopia-world-editor-db-v2",
            "hytopia-world-editor-db-v1",
        ];

        // Skip if we're already on current version
        if (this.DB_NAME === oldDbNames[0]) {
            return; // We're still on v3, no migration needed
        }

        // Check localStorage to see if we've already migrated
        const migrationKey = `db-migration-to-${DB_VERSION}-complete`;
        try {
            if (localStorage.getItem(migrationKey) === "true") {
                return; // Already migrated
            }
        } catch (_) { }

        for (const oldDbName of oldDbNames) {
            if (oldDbName === this.DB_NAME) continue; // Skip current DB

            try {
                // Check if old DB exists by trying to open it
                const oldDbExists = await new Promise<boolean>((resolve) => {
                    const checkRequest = indexedDB.open(oldDbName);
                    checkRequest.onsuccess = () => {
                        const db = checkRequest.result;
                        const hasData = db.objectStoreNames.length > 0;
                        db.close();
                        resolve(hasData);
                    };
                    checkRequest.onerror = () => resolve(false);
                });

                if (!oldDbExists) continue;

                console.log(`[DB] Found old database: ${oldDbName}, migrating to ${this.DB_NAME}...`);

                // Start migration - notify UI
                this.updateMigrationStatus({
                    inProgress: true,
                    message: `Found previous database, preparing migration...`,
                    currentStore: "",
                    currentStoreIndex: 0,
                    totalStores: 0,
                    itemsProcessed: 0,
                    totalItems: 0,
                });

                // Open old DB to read data
                const oldDb = await new Promise<IDBDatabase>((resolve, reject) => {
                    const req = indexedDB.open(oldDbName);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });

                // Open/create new DB
                const newDb = await new Promise<IDBDatabase>((resolve, reject) => {
                    const req = indexedDB.open(this.DB_NAME, DB_VERSION);
                    req.onupgradeneeded = (event) => {
                        const db = (event.target as IDBOpenDBRequest).result;
                        Object.values(STORES).forEach((storeName) => {
                            if (!db.objectStoreNames.contains(storeName)) {
                                db.createObjectStore(storeName);
                            }
                        });
                    };
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });

                // Copy data from each store
                const storeNames = Array.from(oldDb.objectStoreNames);

                // First pass: identify stores that have data and count their items
                const storesWithData: Array<{ name: string; itemCount: number }> = [];
                for (const storeName of storeNames) {
                    if (!newDb.objectStoreNames.contains(storeName)) {
                        console.warn(`[DB] Store ${storeName} not in new DB, skipping`);
                        continue;
                    }
                    const itemCount = await new Promise<number>((resolve) => {
                        const tx = oldDb.transaction(storeName, "readonly");
                        const store = tx.objectStore(storeName);
                        const countReq = store.count();
                        countReq.onsuccess = () => resolve(countReq.result);
                        countReq.onerror = () => resolve(0);
                    });
                    if (itemCount > 0) {
                        storesWithData.push({ name: storeName, itemCount });
                    }
                }

                const totalStores = storesWithData.length;

                this.updateMigrationStatus({
                    totalStores,
                    message: `Found ${totalStores} data store${totalStores === 1 ? '' : 's'} to migrate...`,
                });

                for (let storeIndex = 0; storeIndex < storesWithData.length; storeIndex++) {
                    const { name: storeName, itemCount } = storesWithData[storeIndex];

                    // Update status - preparing to migrate
                    this.updateMigrationStatus({
                        currentStore: storeName,
                        currentStoreIndex: storeIndex + 1,
                        message: `Preparing to migrate ${storeName}...`,
                        itemsProcessed: 0,
                        totalItems: itemCount,
                    });

                    this.updateMigrationStatus({
                        totalItems: itemCount,
                        message: `Reading ${itemCount.toLocaleString()} item${itemCount === 1 ? '' : 's'} from ${storeName}...`,
                    });

                    // Phase 1: Read ALL data from old store first (no awaits in cursor callback)
                    const allData = await new Promise<Array<{ key: IDBValidKey, value: any }>>((resolve) => {
                        const readTx = oldDb.transaction(storeName, "readonly");
                        const readStore = readTx.objectStore(storeName);
                        const items: Array<{ key: IDBValidKey, value: any }> = [];
                        let readCount = 0;

                        const cursorReq = readStore.openCursor();
                        cursorReq.onsuccess = (e) => {
                            const cursor = (e.target as any).result as IDBCursorWithValue;
                            if (cursor) {
                                items.push({ key: cursor.key, value: cursor.value });
                                readCount++;

                                // Update read progress periodically
                                if (readCount % 10000 === 0) {
                                    this.updateMigrationStatus({
                                        itemsProcessed: readCount,
                                        message: `Reading ${storeName}: ${readCount.toLocaleString()} / ${itemCount.toLocaleString()} items`,
                                        currentStoreIndex: storeIndex + 1,
                                    });
                                }

                                cursor.continue();
                            } else {
                                resolve(items);
                            }
                        };
                        cursorReq.onerror = () => resolve(items);
                    });

                    if (allData.length === 0) continue;

                    // Phase 2: Write data in batches to new store
                    const BATCH_SIZE = 5000;
                    let processedCount = 0;

                    this.updateMigrationStatus({
                        itemsProcessed: 0,
                        totalItems: allData.length,
                        message: `Writing ${allData.length.toLocaleString()} item${allData.length === 1 ? '' : 's'} to ${storeName}...`,
                    });

                    for (let i = 0; i < allData.length; i += BATCH_SIZE) {
                        const batch = allData.slice(i, i + BATCH_SIZE);

                        await new Promise<void>((resolve, reject) => {
                            const writeTx = newDb.transaction(storeName, "readwrite");
                            const writeStore = writeTx.objectStore(storeName);
                            batch.forEach(({ key, value }) => {
                                writeStore.put(value, key);
                            });
                            writeTx.oncomplete = () => resolve();
                            writeTx.onerror = () => reject(writeTx.error);
                        });

                        processedCount += batch.length;

                        // Update progress
                        this.updateMigrationStatus({
                            itemsProcessed: processedCount,
                            totalItems: allData.length,
                            message: `Writing ${storeName}: ${processedCount.toLocaleString()} / ${allData.length.toLocaleString()} items`,
                            currentStoreIndex: storeIndex + 1,
                        });
                    }

                    console.log(`[DB] Migrated ${processedCount} items from ${storeName}`);
                }

                oldDb.close();
                newDb.close();

                console.log(`[DB] Migration from ${oldDbName} complete`);

                // Migration complete
                this.updateMigrationStatus({
                    inProgress: false,
                    message: "Migration complete!",
                    currentStore: "",
                    itemsProcessed: 0,
                    totalItems: 0,
                });

                // Mark migration as complete
                try {
                    localStorage.setItem(migrationKey, "true");
                } catch (_) { }

                // Only migrate from the most recent old DB
                break;
            } catch (e) {
                console.warn(`[DB] Error checking/migrating from ${oldDbName}:`, e);
            }
        }
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
        const db = await this.getConnection();

        // Check if store exists
        if (!db.objectStoreNames.contains(storeName)) {
            console.error(`[DB] ERROR: Store '${storeName}' does not exist, cannot save data`);
            console.error(`[DB] Available stores:`, Array.from(db.objectStoreNames));
            console.error(`[DB] This indicates a roll-forward migration issue. The store should have been created.`);
            return Promise.resolve();
        }

        console.log(`[DB] saveData: Store '${storeName}' exists, saving key '${key}'`);

        return new Promise((resolve, reject) => {
            if ((storeName === STORES.TERRAIN || storeName === STORES.ENVIRONMENT) && key === "current") {
                try {
                    // Delete only this project's records, then write project-prefixed entries
                    const projectId = this.getCurrentProjectId();
                    if (!projectId) {
                        // No active project; ignore writes silently
                        return resolve();
                    }
                    const prefix = this.prefixForProject(projectId);
                    const range = this.makePrefixRange(prefix);
                    const deleteTx = db.transaction(storeName, "readwrite");
                    const deleteStore = deleteTx.objectStore(storeName);
                    const deleteCursor = deleteStore.openKeyCursor(range);
                    deleteCursor.onsuccess = async (ev) => {
                        const cursor = (ev.target as any).result as IDBCursor | null;
                        if (cursor) {
                            deleteStore.delete(cursor.key as IDBValidKey);
                            cursor.continue();
                        } else {
                            // After deletions, write new data in chunks
                            const entries = Array.isArray(data) ? (data as any[]).map((v, i) => [String(i), v]) : Object.entries(data);
                            const totalEntries = entries.length;
                            const CHUNK_SIZE = 500000;
                            try {
                                for (let i = 0; i < totalEntries; i += CHUNK_SIZE) {
                                    const chunk = entries.slice(i, i + CHUNK_SIZE);
                                    const chunkNum = i / CHUNK_SIZE + 1;
                                    const totalChunks = Math.ceil(totalEntries / CHUNK_SIZE);
                                    console.log(`[DB] Saving chunk ${chunkNum}/${totalChunks} (${chunk.length} items) for ${storeName} -> project ${projectId}`);
                                    await new Promise<void>((resolveChunk, rejectChunk) => {
                                        const chunkTx = db.transaction(storeName, "readwrite");
                                        const chunkStore = chunkTx.objectStore(storeName);
                                        const promises: Promise<void>[] = [];
                                        if (storeName === STORES.TERRAIN) {
                                            chunk.forEach(([coordKey, blockId]) => {
                                                promises.push(new Promise<void>((res, rej) => {
                                                    const composed = DatabaseManager.composeKey(String(coordKey), projectId);
                                                    const putReq = chunkStore.put(blockId, composed);
                                                    putReq.onsuccess = () => res();
                                                    putReq.onerror = () => rej(putReq.error);
                                                }));
                                            });
                                        } else {
                                            // ENVIRONMENT: index or key is arbitrary; store per-project
                                            chunk.forEach(([k, val], idx) => {
                                                promises.push(new Promise<void>((res, rej) => {
                                                    const local = `env:${k}`;
                                                    const composed = DatabaseManager.composeKey(local, projectId);
                                                    const putReq = chunkStore.put(val, composed);
                                                    putReq.onsuccess = () => res();
                                                    putReq.onerror = () => rej(putReq.error);
                                                }));
                                            });
                                        }
                                        Promise.all(promises).catch(rejectChunk);
                                        chunkTx.oncomplete = () => resolveChunk();
                                        chunkTx.onerror = (e) => rejectChunk((e.target as any).error);
                                    });
                                }
                                resolve();
                            } catch (err) {
                                console.error("[DB] Error during chunked project save:", err);
                                reject(err);
                            }
                        }
                    };
                    deleteCursor.onerror = (e) => {
                        console.error("[DB] Error deleting project prefix keys:", (e.target as any).error);
                        reject((e.target as any).error);
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
                let targetKey: string = key;
                if (!this.getCurrentProjectId()) {
                    // Avoid writing per-project stacks when no active project
                    if ((storeName === STORES.UNDO || storeName === STORES.REDO) && key === "states") {
                        return resolve();
                    }
                }
                // Route specific keys to project-aware names
                if ((storeName === STORES.UNDO || storeName === STORES.REDO) && key === "states") {
                    targetKey = `project:${this.getCurrentProjectId()}:states`;
                }
                const request = store.put(data, targetKey);

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
                    console.error(
                        `[DB] ERROR: Requested store '${storeName}' does not exist on this client. Returning undefined.`
                    );
                    console.error(`[DB] Available stores:`, Array.from(db.objectStoreNames));
                    console.error(`[DB] This indicates a roll-forward migration issue. The store should have been created.`);
                    resolve(undefined);
                    return; // Exit early so we don't attempt to start a transaction on a non-existent store.
                }

                console.log(`[DB] getData: Store '${storeName}' exists, getting key '${key}'`);
                const tx = db.transaction(storeName, "readonly");
                const store = tx.objectStore(storeName);

                if ((storeName === STORES.TERRAIN || storeName === STORES.ENVIRONMENT) && key === "current") {
                    const projectId = this.getCurrentProjectId();
                    if (!projectId) {
                        // No active project: return empty result
                        return resolve(storeName === STORES.TERRAIN ? {} : []);
                    }
                    const logKey = `DatabaseManager.getData(${storeName})`;
                    const prefix = this.prefixForProject(projectId);
                    const range = this.makePrefixRange(prefix);

                    // Fast-path: Try to count first to detect empty queries quickly
                    // Use count() if available, otherwise fall back to cursor
                    const countReq = store.count(range);
                    countReq.onsuccess = () => {
                        const count = countReq.result;
                        if (count === 0) {
                            // Empty query - return immediately without cursor iteration
                            resolve(storeName === STORES.TERRAIN ? {} : []);
                            return;
                        }

                        // Non-empty: proceed with cursor iteration
                        const data: any = storeName === STORES.TERRAIN ? {} : [];
                        const cursorReq = store.openCursor(range);
                        let processedCount = 0;
                        cursorReq.onsuccess = (e) => {
                            const cursor = (e.target as any).result as IDBCursorWithValue | null;
                            if (cursor) {
                                const fullKey = String(cursor.key);
                                const localKey = fullKey.substring(prefix.length);
                                if (storeName === STORES.TERRAIN) {
                                    (data as any)[localKey] = cursor.value;
                                } else {
                                    (data as any[]).push(cursor.value);
                                }
                                processedCount++;
                                if (processedCount % 10000 === 0 && loadingManager.isLoading) {
                                    loadingManager.updateLoading(`Loading ${storeName}... ${processedCount}`);
                                }
                                cursor.continue();
                            } else {
                                resolve(data);
                            }
                        };
                        cursorReq.onerror = (e) => {
                            reject((e.target as any).error);
                        };
                    };
                    countReq.onerror = () => {
                        // count() not supported or failed - fall back to cursor method
                        const data: any = storeName === STORES.TERRAIN ? {} : [];
                        const cursorReq = store.openCursor(range);
                        let count = 0;
                        cursorReq.onsuccess = (e) => {
                            const cursor = (e.target as any).result as IDBCursorWithValue | null;
                            if (cursor) {
                                const fullKey = String(cursor.key);
                                const localKey = fullKey.substring(prefix.length);
                                if (storeName === STORES.TERRAIN) {
                                    data[localKey] = cursor.value;
                                } else {
                                    data.push(cursor.value);
                                }
                                count++;
                                if (count % 10000 === 0 && loadingManager.isLoading) {
                                    loadingManager.updateLoading(`Loading ${storeName}... ${count}`);
                                }
                                cursor.continue();
                            } else {
                                resolve(data);
                            }
                        };
                        cursorReq.onerror = (e) => {
                            reject((e.target as any).error);
                        };
                    };
                } else {
                    let targetKey: string = key;
                    if ((storeName === STORES.UNDO || storeName === STORES.REDO) && key === "states") {
                        targetKey = `project:${this.getCurrentProjectId()}:states`;
                    }
                    const request = store.get(targetKey);
                    request.onsuccess = () => {
                        resolve(request.result);
                    };
                    request.onerror = (event) => {
                        console.error(
                            `[DB] Error getting data for key '${targetKey}' from store '${storeName}':`,
                            (event.target as any).error
                        );
                        reject((event.target as any).error);
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
    // Delete all keys for a given project prefix in a store
    static async deleteAllByPrefix(storeName: string, projectId?: string, localPrefix: string = ""): Promise<void> {
        const db = await this.getConnection();
        const prefix = this.prefixForProject(projectId) + localPrefix;
        const range = this.makePrefixRange(prefix);
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readwrite");
            const store = tx.objectStore(storeName);
            const req = store.openKeyCursor(range);
            req.onsuccess = (e) => {
                const cursor = (e.target as any).result as IDBCursor | null;
                if (cursor) {
                    store.delete(cursor.key as IDBValidKey);
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            req.onerror = (e) => reject((e.target as any).error);
        });
    }
    // Projects CRUD (minimal set)
    static async createProject(name: string): Promise<{ id: string; name: string; createdAt: number; updatedAt: number; } | null> {
        try {
            const id = this.uuidv4();
            const now = Date.now();
            const meta = { id, name: name || "Untitled Project", createdAt: now, updatedAt: now, lastOpenedAt: now, type: 'project', folderId: null } as any;
            const db = await this.getConnection();
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(STORES.PROJECTS, "readwrite");
                const store = tx.objectStore(STORES.PROJECTS);
                const req = store.put(meta, id);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
            // Do not set current project here; caller will choose when to open
            return meta;
        } catch (e) {
            console.error("[DB] createProject failed", e);
            return null;
        }
    }
    static async createFolder(name: string): Promise<{ id: string; name: string; createdAt: number; updatedAt: number; type: string; } | null> {
        try {
            const id = this.uuidv4();
            const now = Date.now();
            const meta = { id, name: name || "New Folder", createdAt: now, updatedAt: now, type: 'folder' } as any;
            const db = await this.getConnection();
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(STORES.PROJECTS, "readwrite");
                const store = tx.objectStore(STORES.PROJECTS);
                const req = store.put(meta, id);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
            return meta;
        } catch (e) {
            console.error("[DB] createFolder failed", e);
            return null;
        }
    }
    static async updateProjectFolder(projectId: string, folderId: string | null): Promise<void> {
        try {
            const db = await this.getConnection();
            const meta = await new Promise<any>((resolve) => {
                const tx = db.transaction(STORES.PROJECTS, "readonly");
                const store = tx.objectStore(STORES.PROJECTS);
                const req = store.get(projectId);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            });
            if (!meta) return;
            meta.folderId = folderId || null;
            meta.updatedAt = Date.now();
            await new Promise<void>((resolve) => {
                const tx = db.transaction(STORES.PROJECTS, "readwrite");
                const store = tx.objectStore(STORES.PROJECTS);
                const req = store.put(meta, projectId);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
            });
        } catch (e) {
            console.error("[DB] updateProjectFolder failed", e);
        }
    }
    static async listProjects(): Promise<any[]> {
        const db = await this.getConnection();
        return new Promise((resolve) => {
            if (!db.objectStoreNames.contains(STORES.PROJECTS)) return resolve([]);
            const tx = db.transaction(STORES.PROJECTS, "readonly");
            const store = tx.objectStore(STORES.PROJECTS);
            const req = store.getAll();
            req.onsuccess = () => {
                const list = (req.result || []).map((p: any) => ({ ...p }));
                resolve(list);
            };
            req.onerror = () => resolve([]);
        });
    }
    static async deleteProject(projectId: string): Promise<void> {
        const db = await this.getConnection();
        const deletions = [
            this.deleteAllByPrefix(STORES.TERRAIN, projectId),
            this.deleteAllByPrefix(STORES.ENVIRONMENT, projectId),
            // Delete zones for this project
            this.deleteData(STORES.ZONES, `project:${projectId}:zones`).catch(() => { }),
            // Delete all project settings for this project
            this.deleteAllProjectSettings(projectId).catch(() => { }),
            // Delete the project metadata
            new Promise<void>((resolve) => {
                const tx = db.transaction(STORES.PROJECTS, "readwrite");
                const store = tx.objectStore(STORES.PROJECTS);
                const req = store.delete(projectId);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
            }),
        ];
        await Promise.all(deletions);
    }

    /**
     * Delete all settings for a project
     */
    static async deleteAllProjectSettings(projectId: string): Promise<void> {
        const db = await this.getConnection();
        if (!db.objectStoreNames.contains(STORES.PROJECT_SETTINGS)) {
            return;
        }

        const prefix = `project:${projectId}:`;
        return new Promise((resolve) => {
            const tx = db.transaction(STORES.PROJECT_SETTINGS, "readwrite");
            const store = tx.objectStore(STORES.PROJECT_SETTINGS);
            const req = store.openKeyCursor();

            req.onsuccess = (e) => {
                const cursor = (e.target as any).result as IDBCursor;
                if (cursor) {
                    const key = String(cursor.key);
                    if (key.startsWith(prefix)) {
                        store.delete(cursor.key as IDBValidKey);
                    }
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            req.onerror = () => resolve();
        });
    }
    static async deleteFolder(folderId: string): Promise<void> {
        try {
            const db = await this.getConnection();
            const all = await this.listProjects();
            const inFolder = all.filter((p: any) => p && p.folderId === folderId && p.type !== 'folder');
            for (const p of inFolder) {
                await this.updateProjectFolder(p.id, null);
            }
            await new Promise<void>((resolve) => {
                const tx = db.transaction(STORES.PROJECTS, "readwrite");
                const store = tx.objectStore(STORES.PROJECTS);
                const req = store.delete(folderId);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
            });
        } catch (e) {
            console.error('[DB] deleteFolder failed', e);
        }
    }
    static async setProjectsArchived(ids: string[], archived: boolean): Promise<void> {
        try {
            const db = await this.getConnection();
            await Promise.all(ids.map((id) => new Promise<void>((resolve) => {
                const tx = db.transaction(STORES.PROJECTS, 'readwrite');
                const store = tx.objectStore(STORES.PROJECTS);
                const req = store.get(id);
                req.onsuccess = () => {
                    const meta = req.result;
                    if (!meta) return resolve();
                    meta.archived = archived;
                    meta.updatedAt = Date.now();
                    const put = store.put(meta, id);
                    put.onsuccess = () => resolve();
                    put.onerror = () => resolve();
                };
                req.onerror = () => resolve();
            })));
        } catch (e) {
            console.error('[DB] setProjectsArchived failed', e);
        }
    }
    static async touchProject(projectId: string): Promise<void> {
        try {
            const db = await this.getConnection();
            const meta = await new Promise<any>((resolve) => {
                const tx = db.transaction(STORES.PROJECTS, "readonly");
                const store = tx.objectStore(STORES.PROJECTS);
                const req = store.get(projectId);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            });
            if (!meta) return;
            meta.updatedAt = Date.now();
            meta.lastOpenedAt = Date.now();
            await new Promise<void>((resolve) => {
                const tx = db.transaction(STORES.PROJECTS, "readwrite");
                const store = tx.objectStore(STORES.PROJECTS);
                const req = store.put(meta, projectId);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
            });
        } catch (_) { }
    }
    static async saveProjectThumbnail(projectId: string, dataUrl: string): Promise<void> {
        try {
            const db = await this.getConnection();
            const meta = await new Promise<any>((resolve) => {
                const tx = db.transaction(STORES.PROJECTS, "readonly");
                const store = tx.objectStore(STORES.PROJECTS);
                const req = store.get(projectId);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            });
            if (!meta) return;
            meta.thumbnailDataUrl = dataUrl;
            meta.updatedAt = Date.now();
            await new Promise<void>((resolve) => {
                const tx = db.transaction(STORES.PROJECTS, "readwrite");
                const store = tx.objectStore(STORES.PROJECTS);
                const req = store.put(meta, projectId);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
            });
        } catch (_) { }
    }
    // ---------- Migration ----------
    static async migrateLegacyIfNeeded(db: IDBDatabase) {
        // If any terrain/environment key already includes '::', assume migrated
        try {
            const check = async (storeName: string) => {
                if (!db.objectStoreNames.contains(storeName)) return false;
                return await new Promise<boolean>((resolve) => {
                    const tx = db.transaction(storeName, "readonly");
                    const store = tx.objectStore(storeName);
                    const req = store.openKeyCursor();
                    req.onsuccess = (e) => {
                        const cursor = (e.target as any).result as IDBCursor | null;
                        if (!cursor) return resolve(false);
                        const keyStr = String(cursor.key);
                        resolve(keyStr.includes("::"));
                    };
                    req.onerror = () => resolve(false);
                });
            };
            const terrainHasPrefix = await check(STORES.TERRAIN);
            const environmentHasPrefix = await check(STORES.ENVIRONMENT);
            if (terrainHasPrefix || environmentHasPrefix) {
                // Ensure a current project id exists; do not change keys
                this.getCurrentProjectId();
                return;
            }
            // Detect if there is any legacy data to migrate
            const hasLegacyTerrain = await new Promise<boolean>((resolve) => {
                if (!db.objectStoreNames.contains(STORES.TERRAIN)) return resolve(false);
                const tx = db.transaction(STORES.TERRAIN, "readonly");
                const store = tx.objectStore(STORES.TERRAIN);
                const req = store.openKeyCursor();
                req.onsuccess = (e) => resolve(!!(e.target as any).result);
                req.onerror = () => resolve(false);
            });
            const hasLegacyEnv = await new Promise<boolean>((resolve) => {
                if (!db.objectStoreNames.contains(STORES.ENVIRONMENT)) return resolve(false);
                const tx = db.transaction(STORES.ENVIRONMENT, "readonly");
                const store = tx.objectStore(STORES.ENVIRONMENT);
                const req = store.openKeyCursor();
                req.onsuccess = (e) => resolve(!!(e.target as any).result);
                req.onerror = () => resolve(false);
            });
            if (!hasLegacyTerrain && !hasLegacyEnv) {
                // No legacy data present. Do not auto-create a project here.
                // Project creation should be an explicit user action from Project Home.
                return;
            }
            const proj = await this.createProject("My World");
            const projectId = proj?.id || this.getCurrentProjectId();
            console.log("[DB] Migrating legacy single-world data into project:", projectId);
            // Migrate terrain: move each key -> `${projectId}::${key}`
            await new Promise<void>((resolve) => {
                if (!db.objectStoreNames.contains(STORES.TERRAIN)) return resolve();
                const tx = db.transaction(STORES.TERRAIN, "readwrite");
                const store = tx.objectStore(STORES.TERRAIN);
                const req = store.openCursor();
                req.onsuccess = (e) => {
                    const cursor = (e.target as any).result as IDBCursorWithValue | null;
                    if (cursor) {
                        const oldKey = String(cursor.key);
                        if (!oldKey.includes("::")) {
                            const newKey = `${projectId}::${oldKey}`;
                            store.put(cursor.value, newKey);
                            store.delete(cursor.key as any);
                        }
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
                req.onerror = () => resolve();
            });
            // Migrate environment
            await new Promise<void>((resolve) => {
                if (!db.objectStoreNames.contains(STORES.ENVIRONMENT)) return resolve();
                const tx = db.transaction(STORES.ENVIRONMENT, "readwrite");
                const store = tx.objectStore(STORES.ENVIRONMENT);
                const req = store.openCursor();
                req.onsuccess = (e) => {
                    const cursor = (e.target as any).result as IDBCursorWithValue | null;
                    if (cursor) {
                        const oldKey = String(cursor.key);
                        if (!oldKey.includes("::")) {
                            const newKey = `${projectId}::env:${oldKey}`;
                            store.put(cursor.value, newKey);
                            store.delete(cursor.key as any);
                        }
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
                req.onerror = () => resolve();
            });
            // Migrate project-specific settings if present
            await new Promise<void>((resolve) => {
                if (!db.objectStoreNames.contains(STORES.SETTINGS)) return resolve();
                const keys = ["selectedSkybox", "ambientLight", "directionalLight"];
                const tx = db.transaction(STORES.SETTINGS, "readwrite");
                const store = tx.objectStore(STORES.SETTINGS);
                let pending = keys.length;
                if (pending === 0) return resolve();
                keys.forEach((k) => {
                    const getReq = store.get(k);
                    getReq.onsuccess = () => {
                        const val = getReq.result;
                        if (val !== undefined) {
                            store.put(val, `project:${projectId}:${k}`);
                            store.delete(k);
                        }
                        if (--pending === 0) resolve();
                    };
                    getReq.onerror = () => { if (--pending === 0) resolve(); };
                });
            });
            console.log("[DB] Migration complete");
        } catch (e) {
            console.warn("[DB] migrateLegacyIfNeeded error:", e);
        }
    }
    private static uuidv4(): string {
        // RFC4122 version 4 compliant
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 0xf) >> 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }
    // ---------- Project Settings ----------
    /**
     * Save a project-specific setting (e.g., liquid blocks, zone visibility, etc.)
     */
    static async saveProjectSetting(settingKey: string, value: any, projectId?: string): Promise<void> {
        const pid = projectId || this.getCurrentProjectId();
        if (!pid) {
            console.warn("[DB] Cannot save project setting without a project ID");
            return;
        }
        const key = `project:${pid}:${settingKey}`;
        await this.saveData(STORES.PROJECT_SETTINGS, key, value);
    }

    /**
     * Load a project-specific setting
     */
    static async getProjectSetting(settingKey: string, projectId?: string): Promise<any> {
        const pid = projectId || this.getCurrentProjectId();
        if (!pid) {
            return undefined;
        }
        const key = `project:${pid}:${settingKey}`;
        return this.getData(STORES.PROJECT_SETTINGS, key);
    }

    /**
     * Get all data items whose keys start with a given prefix
     */
    static async getAllDataWithPrefix(storeName: string, prefix: string): Promise<any[]> {
        const db = await this.getConnection();
        if (!db.objectStoreNames.contains(storeName)) {
            return [];
        }
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const range = this.makePrefixRange(prefix);
            const request = store.openCursor(range);
            const results: any[] = [];

            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete a project-specific setting
     */
    static async deleteProjectSetting(settingKey: string, projectId?: string): Promise<void> {
        const pid = projectId || this.getCurrentProjectId();
        if (!pid) {
            return;
        }
        const key = `project:${pid}:${settingKey}`;
        await this.deleteData(STORES.PROJECT_SETTINGS, key);
    }

    /**
     * Get all project settings for the current project
     */
    static async getAllProjectSettings(projectId?: string): Promise<Record<string, any>> {
        const pid = projectId || this.getCurrentProjectId();
        if (!pid) {
            return {};
        }

        const db = await this.getConnection();
        if (!db.objectStoreNames.contains(STORES.PROJECT_SETTINGS)) {
            return {};
        }

        const prefix = `project:${pid}:`;
        const settings: Record<string, any> = {};

        return new Promise((resolve) => {
            const tx = db.transaction(STORES.PROJECT_SETTINGS, "readonly");
            const store = tx.objectStore(STORES.PROJECT_SETTINGS);
            const req = store.openCursor();

            req.onsuccess = (e) => {
                const cursor = (e.target as any).result as IDBCursorWithValue;
                if (cursor) {
                    const key = String(cursor.key);
                    if (key.startsWith(prefix)) {
                        const settingKey = key.substring(prefix.length);
                        settings[settingKey] = cursor.value;
                    }
                    cursor.continue();
                } else {
                    resolve(settings);
                }
            };
            req.onerror = () => resolve({});
        });
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
