import type { QuoteSegment } from "./quotePricing";
import type { UploadBillingMode } from "./uploadBilling";

const DB_NAME = "record-client-pending-upload";
const STORE_NAME = "snapshots";
const SNAPSHOT_KEY = "current";

export type PendingUploadSnapshot = {
  files: File[];
  uploadProjectMode: "existing" | "new";
  selectedUploadProjectId: string;
  newProjectTitle: string;
  billingEntries: Array<{
    key: string;
    mode: UploadBillingMode;
    segments: QuoteSegment[];
  }>;
  savedAt: number;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error ?? new Error("보류 업로드 저장소를 열지 못했습니다."));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      Promise.resolve(run(store)).then(resolve).catch(reject);
      tx.onerror = () => reject(tx.error ?? new Error("보류 업로드 저장소 처리에 실패했습니다."));
    });
  } finally {
    db.close();
  }
}

export async function savePendingUploadSnapshot(snapshot: PendingUploadSnapshot): Promise<void> {
  await withStore("readwrite", (store) => {
    store.put(snapshot, SNAPSHOT_KEY);
  });
}

export async function restorePendingUploadSnapshot(): Promise<PendingUploadSnapshot | null> {
  return withStore("readonly", (store) => {
    return new Promise<PendingUploadSnapshot | null>((resolve, reject) => {
      const request = store.get(SNAPSHOT_KEY);
      request.onerror = () => reject(request.error ?? new Error("보류 업로드 정보를 읽지 못했습니다."));
      request.onsuccess = () => resolve((request.result as PendingUploadSnapshot | undefined) ?? null);
    });
  });
}

export async function clearPendingUploadSnapshot(): Promise<void> {
  await withStore("readwrite", (store) => {
    store.delete(SNAPSHOT_KEY);
  });
}
