import type { QuestPlannerData } from './questLogic'

const DB_NAME = 'questplanner-quasar'
const DB_VERSION = 1
const STORE_NAME = 'json'
const DATA_KEY = 'questplanner-data'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function loadStoredQuestPlannerData(): Promise<QuestPlannerData | null> {
  const database = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(DATA_KEY)

    request.onsuccess = () => resolve((request.result as QuestPlannerData | undefined) || null)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => database.close()
  })
}

export async function saveStoredQuestPlannerData(data: QuestPlannerData): Promise<void> {
  const database = await openDatabase()

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const request = transaction.objectStore(STORE_NAME).put(data, DATA_KEY)

    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => {
      database.close()
      resolve()
    }
    transaction.onerror = () => reject(transaction.error)
  })
}
