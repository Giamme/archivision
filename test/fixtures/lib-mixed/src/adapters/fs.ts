import type { Source } from '../core/engine';

export function fileSource(path: string): Source {
  return { read: async () => `file:${path}` };
}
