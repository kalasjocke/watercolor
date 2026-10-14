import type { Asset, Project } from './graph';

const request = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('The save was interrupted.')); });

function database(): Promise<IDBDatabase> {
  const open = indexedDB.open('watercolor-studio', 1);
  open.onupgradeneeded = () => { open.result.createObjectStore('project'); open.result.createObjectStore('assets', { keyPath: 'id' }); };
  return request(open);
}
async function withStores<T>(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await database();
  try { const tx = db.transaction(stores, mode); const [result] = await Promise.all([run(tx), done(tx)]); return result; } finally { db.close(); }
}

export const saveAssets = (assets: Asset[]) => withStores(['assets'], 'readwrite', async tx => { assets.forEach(a => tx.objectStore('assets').put(a)); });
export const deleteAssets = (ids: string[]) => withStores(['assets'], 'readwrite', async tx => { ids.forEach(id => tx.objectStore('assets').delete(id)); });
export const saveProject = (project: Project) => withStores(['project'], 'readwrite', async tx => { tx.objectStore('project').put(project, 'current'); });

export async function loadProject(): Promise<{ project?: Project; assets: Asset[] }> {
  const { project, assets } = await withStores(['project', 'assets'], 'readonly', async tx => ({
    project: await request<Project | undefined>(tx.objectStore('project').get('current')),
    assets: await request<Asset[]>(tx.objectStore('assets').getAll()),
  }));
  if (project && project.version !== 1) throw new Error('This project uses an unsupported save format.');
  return { project, assets };
}
