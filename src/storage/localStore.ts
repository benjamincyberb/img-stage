const KEY = 'img-stage/v1';

export interface StoredProject {
  id: string;
  name: string;
  savedAt: string;
  collectionNo: number;
  specJson: string;
  referenceName?: string;
}

interface StoreShape {
  collectionCounter: number;
  recent: StoredProject[];
}

function read(): StoreShape {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { collectionCounter: 1, recent: [] };
    return JSON.parse(raw) as StoreShape;
  } catch {
    return { collectionCounter: 1, recent: [] };
  }
}

function write(data: StoreShape) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function nextCollectionNo(): number {
  const data = read();
  const n = data.collectionCounter;
  data.collectionCounter = (n % 9999) + 1;
  write(data);
  return n;
}

export function saveProject(project: Omit<StoredProject, 'id' | 'savedAt'> & { id?: string }) {
  const data = read();
  const entry: StoredProject = {
    id: project.id ?? crypto.randomUUID(),
    name: project.name,
    savedAt: new Date().toISOString(),
    collectionNo: project.collectionNo,
    specJson: project.specJson,
    referenceName: project.referenceName,
  };
  data.recent = [entry, ...data.recent.filter((p) => p.id !== entry.id)].slice(0, 12);
  write(data);
  return entry;
}

export function listProjects(): StoredProject[] {
  return read().recent;
}
