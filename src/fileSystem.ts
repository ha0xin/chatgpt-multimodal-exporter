// idb-keyval replaced by manual implementation
// Handles cannot be stored in localStorage. They must be in IndexedDB.
// Since I don't have idb-keyval, I'll implement a minimal IDB helper for the handle.

const DB_NAME = 'ChatGPTExporterDB';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'root_dir_handle';

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getHandleFromDB(): Promise<FileSystemDirectoryHandle | undefined> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(HANDLE_KEY);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveHandleToDB(handle: FileSystemDirectoryHandle): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(handle, HANDLE_KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export async function getRootHandle(): Promise<FileSystemDirectoryHandle | null> {
    try {
        const handle = await getHandleFromDB();
        return handle || null;
    } catch (e) {
        console.warn('Failed to get handle from DB', e);
        return null;
    }
}

export async function pickAndSaveRootHandle(): Promise<FileSystemDirectoryHandle> {
    // @ts-ignore
    const handle = await window.showDirectoryPicker();
    await saveHandleToDB(handle);
    return handle;
}

export async function verifyPermission(handle: FileSystemDirectoryHandle, readWrite = false): Promise<boolean> {
    const options: any = {};
    if (readWrite) {
        options.mode = 'readwrite';
    }
    // @ts-ignore
    if ((await handle.queryPermission(options)) === 'granted') {
        return true;
    }
    // @ts-ignore
    if ((await handle.requestPermission(options)) === 'granted') {
        return true;
    }
    return false;
}

export async function ensureFolder(parent: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle> {
    // @ts-ignore
    return await parent.getDirectoryHandle(name, { create: true });
}

export async function writeFile(parent: FileSystemDirectoryHandle, name: string, content: string | Blob | BufferSource) {
    // @ts-ignore
    const fileHandle = await parent.getFileHandle(name, { create: true });
    // @ts-ignore
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
}

export async function fileExists(parent: FileSystemDirectoryHandle, name: string): Promise<boolean> {
    try {
        // @ts-ignore
        await parent.getFileHandle(name);
        return true;
    } catch (e) {
        return false;
    }
}
