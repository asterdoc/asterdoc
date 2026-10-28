/**
 * Registry-related schemas for Asterdoc CLI
 *
 * These schemas define the structure for:
 * - Global user config (~/.asterdoc/config.json)
 * - Lock files (.asterdoc/lock.json)
 * - Registry manifest (registry.json), and the releases it lists
 * - Registry items (r/{name}.json)
 */

export * from './registry-entry';
export * from './global-config';
export * from './lock';
export * from './registry-index';
export * from './release';
export * from './registry-item';
