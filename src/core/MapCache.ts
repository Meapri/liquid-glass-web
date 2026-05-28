/**
 * Shared LRU-ish cache for generated displacement + specular textures. Two
 * glass elements at the same size/radius/thickness reuse the same data URL —
 * the pixel loops only run once. Bounded to keep memory predictable.
 */

import {
  generateDisplacementMap,
  type DisplacementMapParams,
  type DisplacementMapResult,
} from './DisplacementMap';
import { generateSpecularMap, type SpecularMapParams } from './SpecularMap';

const MAX_ENTRIES = 64;
const displacementCache = new Map<string, DisplacementMapResult>();
const specularCache = new Map<string, string>();

function trim<V>(map: Map<string, V>): void {
  while (map.size > MAX_ENTRIES) {
    const firstKey = map.keys().next().value;
    if (firstKey === undefined) break;
    map.delete(firstKey);
  }
}

function bump<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
}

function dispKey(p: DisplacementMapParams): string {
  return `d:${p.width | 0}x${p.height | 0}_r${p.radius | 0}_t${p.thickness | 0}_p${p.pixelRatio}_f${p.refraction | 0}`;
}

function specKey(p: SpecularMapParams): string {
  return `s:${p.width | 0}x${p.height | 0}_r${p.radius | 0}_t${p.thickness | 0}_p${p.pixelRatio}_i${p.intensity.toFixed(2)}`;
}

export function getDisplacementMap(params: DisplacementMapParams): DisplacementMapResult {
  const key = dispKey(params);
  const cached = displacementCache.get(key);
  if (cached !== undefined) {
    bump(displacementCache, key, cached);
    return cached;
  }
  const value = generateDisplacementMap(params);
  displacementCache.set(key, value);
  trim(displacementCache);
  return value;
}

export function getSpecularMap(params: SpecularMapParams): string {
  const key = specKey(params);
  const cached = specularCache.get(key);
  if (cached !== undefined) {
    bump(specularCache, key, cached);
    return cached;
  }
  const value = generateSpecularMap(params);
  specularCache.set(key, value);
  trim(specularCache);
  return value;
}

export function clearMapCache(): void {
  displacementCache.clear();
  specularCache.clear();
}
