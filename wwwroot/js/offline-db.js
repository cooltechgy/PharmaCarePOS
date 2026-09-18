/*
 PURPOSE:
 Provides a tiny IndexedDB wrapper for offline products, batches, customers, suppliers and sales waiting to sync.
 REFERENCE:
 IndexedDB persists structured browser data across page refreshes and internet outages.
*/
window.PharmaOffline = (() => {
  const DB_NAME = 'PharmaCarePOS';
  const DB_VERSION = 2;
  const stores = ['products', 'batches', 'customers', 'suppliers', 'pendingSales', 'meta'];

  /*
   PURPOSE:
   Opens the browser database and creates object stores on first use.
   REFERENCE:
   Every store uses a string key supplied by the helper methods below.
  */
  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of stores) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /*
   PURPOSE:
   Saves one JSON-compatible value into a named store.
   REFERENCE:
   Used by snapshot refresh and pending-sale creation.
  */
  async function put(storeName, key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /*
   PURPOSE:
   Reads one value by key from IndexedDB.
   REFERENCE:
   Returns undefined when the requested key does not exist.
  */
  async function get(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /*
   PURPOSE:
   Replaces a store with an array keyed by each item's id.
   REFERENCE:
   Server snapshots use this to refresh offline catalogue data atomically enough for this demo.
  */
  async function replaceAll(storeName, items) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.clear();
      for (const item of items) store.put(item, String(item.id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /*
   PURPOSE:
   Reads all values from one store.
   REFERENCE:
   POS and management screens use this when the network is unavailable.
  */
  async function all(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /*
   PURPOSE:
   Deletes one queued record after the server confirms synchronization.
   REFERENCE:
   Failed/conflicted sales remain in the queue for user review and retry.
  */
  async function remove(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return { put, get, replaceAll, all, remove };
})();
