
const DATABASEPUP = "puppy-yoga-db";
const STORENAME = "keyval";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASEPUP, 1);

    //izvrsava se pri pokretanju baze s vecom verzijom nego trenutnom
    request.onupgradeneeded = () => {
      const db = request.result;

      //kreiraj object store
      if (!db.objectStoreNames.contains(STORENAME)) {
        db.createObjectStore(STORENAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

//funkcija za spremanje stvari u offline modeu
//kako bi se poslije moglo syncati kad se vratimo u online mode
export async function set(key, value) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORENAME, "readwrite");
    const store = tx.objectStore(STORENAME);

    store.put(value, key);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

//funkcija koja brise item nakon syncanja u online modeu
export async function del(key) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORENAME, "readwrite");
    const store = tx.objectStore(STORENAME);

    store.delete(key);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

//funkcija kojom se zeli dobiti polje key valuea
export async function entries() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORENAME, "readonly"); //readonly jer se nista ne mijenja
    const store = tx.objectStore(STORENAME);

    
    const keysReq = store.getAllKeys();

    keysReq.onsuccess = async () => {
      const keys = keysReq.result || [];

    
      const vals = await Promise.all(
        keys.map(
          (k) =>
            new Promise((res, rej) => {
              const r = store.get(k);
              r.onsuccess = () => res(r.result);
              r.onerror = () => rej(r.error);
            })
        )
      );

      resolve(keys.map((k, i) => [k, vals[i]]));
    };

    keysReq.onerror = () => reject(keysReq.error);
  });
}
