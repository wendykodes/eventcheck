// Sync mechanism for offline check-ins
// Syncs pending check-ins when connection is restored

import offlineStorage from './offlineStorage.js';
import { api } from '../api/client.js';

class SyncManager {
  constructor() {
    this.isOnline = navigator.onLine;
    this.syncInProgress = false;
    this.listeners = [];
  }

  async init() {
    // Listen for online/offline events
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());

    // Initial check
    this.isOnline = navigator.onLine;

    // Register service worker
    this.registerServiceWorker();

    // Initialize offline storage first (must complete before sync)
    try {
      await offlineStorage.init();
    } catch (err) {
      console.error('Failed to initialize offline storage:', err);
      return;
    }

    // Try to sync any pending check-ins on load
    if (this.isOnline) {
      this.syncPending();
    }
  }

  handleOnline() {
    console.log('[Sync] Connection restored');
    this.isOnline = true;
    this.notifyListeners('online');
    this.syncPending();
  }

  handleOffline() {
    console.log('[Sync] Connection lost');
    this.isOnline = false;
    this.notifyListeners('offline');
  }

  async registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        console.log('[SW] Registered:', registration);
      } catch (err) {
        console.error('[SW] Registration failed:', err);
      }
    }
  }

  async syncPending() {
    if (this.syncInProgress || !this.isOnline) {
      return;
    }

    this.syncInProgress = true;
    this.notifyListeners('sync-start');

    try {
      const pending = await offlineStorage.getPendingCheckins();
      console.log(`[Sync] Syncing ${pending.length} pending check-ins`);

      const results = [];
      for (const checkin of pending) {
        try {
          // Sync the check-in
          const response = await api.post('/checkins', {
            guest_id: checkin.guest_id,
            activity_id: checkin.activity_id,
          });

          // Mark as synced
          await offlineStorage.markSynced(checkin.id);
          results.push({ id: checkin.id, status: 'success' });
        } catch (err) {
          console.error(`[Sync] Failed to sync check-in ${checkin.id}:`, err);
          results.push({ id: checkin.id, status: 'failed', error: err.message });
        }
      }

      // Clean up synced check-ins
      await offlineStorage.clearSynced();

      this.notifyListeners('sync-complete', { results });
      return results;
    } catch (err) {
      console.error('[Sync] Sync failed:', err);
      this.notifyListeners('sync-error', { error: err.message });
      throw err;
    } finally {
      this.syncInProgress = false;
    }
  }

  async queueCheckin(guestId, activityId, eventId) {
    const checkinData = {
      guest_id: guestId,
      activity_id: activityId,
      eventId: eventId,
    };

    const id = await offlineStorage.addCheckin(checkinData);
    console.log(`[Sync] Queued check-in ${id} for offline sync`);

    // Try to sync immediately if online
    if (this.isOnline && !this.syncInProgress) {
      this.syncPending();
    }

    return id;
  }

  getStats() {
    return offlineStorage.getQueueStats();
  }

  addListener(callback) {
    this.listeners.push(callback);
  }

  removeListener(callback) {
    this.listeners = this.listeners.filter(cb => cb !== callback);
  }

  notifyListeners(event, data) {
    this.listeners.forEach(callback => callback(event, data));
  }

  clearCache() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.controller.postMessage('CLEAR_CACHE');
    }
  }
}

// Singleton instance
const syncManager = new SyncManager();

export default syncManager;
