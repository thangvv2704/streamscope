// Reusable message templates, persisted locally (shared across connections).
// A template stores the composed key / value / headers so you can produce the
// same shape of message again without retyping.

export interface MessageTemplate {
  id: string;
  name: string;
  key: string;
  value: string;
  headers: [string, string][];
  createdAt: number;
}

const KEY = "streamscope.templates";

export function loadTemplates(): MessageTemplate[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as MessageTemplate[];
  } catch {
    // ignore
  }
  return [];
}

function persist(list: MessageTemplate[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function saveTemplate(
  t: Omit<MessageTemplate, "id" | "createdAt">
): MessageTemplate {
  const list = loadTemplates();
  const created: MessageTemplate = {
    ...t,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  persist([created, ...list]);
  return created;
}

export function deleteTemplate(id: string): MessageTemplate[] {
  const list = loadTemplates().filter((t) => t.id !== id);
  persist(list);
  return list;
}
