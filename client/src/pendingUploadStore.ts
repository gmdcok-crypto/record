import type { QuoteSegment } from "./quotePricing";
import type { UploadBillingMode } from "./uploadBilling";

const DB_NAME = "record-client-pending-upload";
const STORE_NAME = "snapshots";
const SNAPSHOT_KEY = "current";
const DB_VERSION = 2;

export type PendingUploadSnapshot = {
  files: File[];
  uploadProjectMode: "existing" | "new";
  selectedUploadProjectId: string;
  newProjectTitle: string;
  billingEntries: Array<{
    key: string;
    mode: UploadBillingMode;
    segments: QuoteSegment[];
    durationMs?: number | null;
  }>;
  savedAt: number;
};

type StoredFileSnapshot = {
  name: string;
  type: string;
  lastModified: number;
  data: ArrayBuffer;
};

type StoredPendingUploadSnapshot = Omit<PendingUploadSnapshot, "files"> & {
  files: StoredFileSnapshot[];
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
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

async function serializeSnapshot(snapshot: PendingUploadSnapshot): Promise<StoredPendingUploadSnapshot> {
  const files = await Promise.all(
    snapshot.files.map(async (file) => ({
      name: file.name,
      type: file.type || "application/octet-stream",
      lastModified: file.lastModified,
      data: await file.arrayBuffer(),
    })),
  );
  return {
    ...snapshot,
    files,
  };
}

function deserializeSnapshot(snapshot: StoredPendingUploadSnapshot): PendingUploadSnapshot {
  return {
    ...snapshot,
    files: snapshot.files.map(
      (file) =>
        new File([file.data], file.name, {
          type: file.type || "application/octet-stream",
          lastModified: file.lastModified,
        }),
    ),
  };
}

export async function savePendingUploadSnapshot(snapshot: PendingUploadSnapshot): Promise<void> {
  const stored = await serializeSnapshot(snapshot);
  await withStore("readwrite", (store) => {
    store.put(stored, SNAPSHOT_KEY);
  });
}

export async function restorePendingUploadSnapshot(): Promise<PendingUploadSnapshot | null> {
  const stored = await withStore("readonly", (store) => {
    return new Promise<StoredPendingUploadSnapshot | PendingUploadSnapshot | null>((resolve, reject) => {
      const request = store.get(SNAPSHOT_KEY);
      request.onerror = () => reject(request.error ?? new Error("보류 업로드 정보를 읽지 못했습니다."));
      request.onsuccess = () => resolve((request.result as StoredPendingUploadSnapshot | PendingUploadSnapshot | undefined) ?? null);
    });
  });
  if (!stored) return null;
  if (Array.isArray(stored.files) && stored.files[0] instanceof File) {
    return stored as PendingUploadSnapshot;
  }
  return deserializeSnapshot(stored as StoredPendingUploadSnapshot);
}

export async function clearPendingUploadSnapshot(): Promise<void> {
  await withStore("readwrite", (store) => {
    store.delete(SNAPSHOT_KEY);
  });
}
