// All localStorage access goes through here so every key gets the `maxp_` prefix.
// localStorage is shared across kylegmaxwell.github.io, so unprefixed keys can collide.
const PREFIX = 'maxp_';

export function save<T>(key: string, value: T): void {
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
}

export function load<T>(key: string): T | null {
  const raw = localStorage.getItem(PREFIX + key);
  return raw === null ? null : (JSON.parse(raw) as T);
}

export function remove(key: string): void {
  localStorage.removeItem(PREFIX + key);
}

