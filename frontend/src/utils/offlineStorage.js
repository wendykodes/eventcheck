// IndexedDB wrapper for offline check-in queue
// Stores check-ins when offline, syncs when connection restored

const DB_NAME = 'EventCheckOffline';
const DB_VERSION = 1;
const STORE_NAME = 'checkinQueue';

class OfflineStorage {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('eventId', 'eventId', { unique: false });
          store.createIndex('synced', 'synced', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  async addCheckin(checkinData) {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const record = {
        ...checkinData,
        synced: false,
        timestamp: new Date().toISOString(),
        retryCount: 0,
      };

      const request = store.add(record);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getPendingCheckins(eventId = null) {
    if (!this.db) {
      return [];
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.getAll();
      request.onsuccess = () => {
        let pending = request.result.filter(c => !c.synced);
        if (eventId) {
          pending = pending.filter(c => c.eventId === eventId);
        }
        resolve(pending);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async markSynced(id) {
    if (!this.db) {
      return;
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.get(id);
      request.onsuccess = () => {
        const record = request.result;
        if (record) {
          record.synced = true;
          record.syncedAt = new Date().toISOString();
          store.put(record);
        }
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteCheckin(id) {
    if (!this.db) {
      return;
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clearSynced() {
    if (!this.db) {
      return 0;
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.getAll();
      request.onsuccess = () => {
        const all = request.result;
        const synced = all.filter(r => r.synced === true);
        synced.forEach(record => {
          store.delete(record.id);
        });
        resolve(synced.length);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getQueueStats() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.getAll();
      request.onsuccess = () => {
        const all = request.result;
        const pending = all.filter(c => !c.synced);
        const synced = all.filter(c => c.synced);
        resolve({
          total: all.length,
          pending: pending.length,
          synced: synced.length,
        });
      };
      request.onerror = () => reject(request.error);
    });
  }
}

// Singleton instance
const offlineStorage = new OfflineStorage();

export default offlineStorage;
