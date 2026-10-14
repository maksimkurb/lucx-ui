import { HappRoutingProfileSchema, type HappRoutingProfile } from '@/schemas/happRouting';
import { toBase64Utf8 } from './happPresets';
import { isRemoteRoutingSource } from './subscriptionShared';

export type HappRoutingMode = 'add' | 'onadd';
// Incy reads the Happ profile JSON unchanged; only the deeplink scheme differs.
export type RoutingScheme = 'happ' | 'incy';
export type HappRoutingListKey =
  | 'DirectSites'
  | 'DirectIp'
  | 'ProxySites'
  | 'ProxyIp'
  | 'BlockSites'
  | 'BlockIp';

export type HappRoutingLoadResult =
  | { success: true; profile: HappRoutingProfile; mode: HappRoutingMode; isNew: boolean }
  | { success: false; error: 'off' | 'remote' | 'invalid' };

export function parseHappRoutingJson(input: string): HappRoutingProfile | null {
  try {
    const value: unknown = JSON.parse(input);
    const result = HappRoutingProfileSchema.safeParse(value);
    // Keep the validated input object; schema output can discard some unknown extension keys.
    return result.success ? (value as HappRoutingProfile) : null;
  } catch {
    return null;
  }
}

export function loadHappRouting(
  input: string,
  scheme: RoutingScheme = 'happ',
): HappRoutingLoadResult {
  const source = input.trim();
  if (!source) {
    return {
      success: true,
      profile: {
        Name: 'Custom Rules',
        GlobalProxy: 'true',
        DirectSites: [],
        DirectIp: [],
        ProxySites: [],
        ProxyIp: [],
        BlockSites: [],
        BlockIp: [],
        DomainStrategy: 'IPIfNonMatch',
      },
      mode: 'onadd',
      isNew: true,
    };
  }
  if (source === `${scheme}://routing/off`) return { success: false, error: 'off' };
  if (isRemoteRoutingSource(source)) return { success: false, error: 'remote' };

  if (source.startsWith('{')) {
    const profile = parseHappRoutingJson(source);
    return profile
      ? { success: true, profile, mode: 'onadd', isNew: false }
      : { success: false, error: 'invalid' };
  }

  const prefix = `${scheme}://routing/`;
  const match = source.startsWith(prefix)
    ? /^(onadd|add)\/([A-Za-z0-9+/_-]+={0,2})$/.exec(source.slice(prefix.length))
    : null;
  if (!match) return { success: false, error: 'invalid' };

  try {
    const binary = atob(match[2].replace(/-/g, '+').replace(/_/g, '/'));
    // Decode UTF-8 strictly so malformed bytes cannot silently change profile names or rules.
    const json = new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
    const profile = parseHappRoutingJson(json);
    return profile
      ? { success: true, profile, mode: match[1] as HappRoutingMode, isNew: false }
      : { success: false, error: 'invalid' };
  } catch {
    return { success: false, error: 'invalid' };
  }
}

export function buildHappRoutingDeeplink(
  profile: HappRoutingProfile,
  mode: HappRoutingMode = 'onadd',
  scheme: RoutingScheme = 'happ',
): string {
  return `${scheme}://routing/${mode}/` + toBase64Utf8(JSON.stringify(profile));
}

export function parseHappRoutingList(input: string): string[] {
  // Commas can belong to regexp rules, so the editor uses one rule per line.
  return input
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export type RoutingGeoKind = 'site' | 'ip';
export interface RoutingGeoSource {
  url: string;
  file: string;
}

const GEO_TOKEN = /^(?:geosite|geoip|ext(?:-[a-z]+)?):/i;

export function routingGeoKind(file: string): RoutingGeoKind {
  return /geoip/i.test(file) ? 'ip' : 'site';
}

// The client resolves categories against the one database its profile downloads,
// so a category is always written in the short form, never Xray's ext:file:tag.
export function clientGeoToken(_file: string, code: string, kind: string): string {
  return kind === 'ip' ? `geoip:${code}` : `geosite:${code}`;
}

export function geoTokensOf(buffer: string): string[] {
  return parseHappRoutingList(buffer).filter((entry) => GEO_TOKEN.test(entry));
}

export function applyGeoSelection(buffer: string, selection: string[]): string {
  const kept = parseHappRoutingList(buffer).filter((entry) => !GEO_TOKEN.test(entry));
  return [...kept, ...selection].join('\n');
}

export function routingGeoSources(payload: unknown): RoutingGeoSource[] {
  const record = (payload ?? {}) as Record<string, unknown>;
  const template = (record.xraySetting ?? {}) as Record<string, unknown>;
  const geodata = (template.geodata ?? {}) as Record<string, unknown>;
  const configured = Array.isArray(geodata.assets) ? geodata.assets : [];
  const fallback = Array.isArray(record.geodataSources) ? record.geodataSources : [];
  const seen = new Set<string>();
  const sources: RoutingGeoSource[] = [];
  for (const item of configured.length > 0 ? configured : fallback) {
    if (!item || typeof item !== 'object') continue;
    const url = String((item as Record<string, unknown>).url ?? '').trim();
    const file = String((item as Record<string, unknown>).file ?? '').trim();
    if (!/^https?:\/\//i.test(url) || !file || seen.has(file)) continue;
    seen.add(file);
    sources.push({ url, file });
  }
  return sources;
}
