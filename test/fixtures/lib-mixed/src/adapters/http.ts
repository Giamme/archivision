import type { Source } from '../core/engine';
import { VERSION } from '../core/util';

export function httpSource(url: string): Source {
  return { read: async () => (await fetch(url, { headers: { 'user-agent': `lib/${VERSION}` } })).text() };
}
