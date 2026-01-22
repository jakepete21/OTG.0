/**
 * State Lookup Service
 * Looks up State from Master Data using OTG Comp Billing item
 */

import { MasterRecord } from '../types';

/**
 * Normalizes billing item for matching
 */
const normalizeBillingItem = (item: string): string => {
  return String(item || '').trim().toUpperCase();
};

/**
 * Builds a cache map of billing item -> state from Master Data
 */
let stateCache: Map<string, string> | null = null;
let masterDataHash: string = '';

/**
 * Builds state lookup cache from Master Data
 */
const buildStateCache = (masterData: MasterRecord[]): Map<string, string> => {
  const cache = new Map<string, string>();
  
  masterData.forEach(record => {
    const billingItem = record['OTG Comp Billing item'] || 
                       record['OTG Comp Billing Item'] ||
                       record['otgCompBillingItem'] ||
                       record.serviceType || '';
    
    if (!billingItem) return;
    
    const key = normalizeBillingItem(billingItem);
    
    // Get State from ST column or State column
    const state = record['ST'] || 
                  record['State'] || 
                  record['state'] || 
                  '';
    
    if (state && /^[A-Z]{2}$/.test(String(state).trim().toUpperCase())) {
      // Only cache if we don't have a value yet, or prefer non-empty values
      if (!cache.has(key) || cache.get(key) === '') {
        cache.set(key, String(state).trim().toUpperCase());
      }
    }
  });
  
  return cache;
};

/**
 * Gets state for billing item from Master Data
 * Uses caching for performance
 */
export const getStateForBillingItem = (
  billingItem: string,
  masterData: MasterRecord[]
): string => {
  if (!billingItem || !masterData || masterData.length === 0) {
    return '';
  }
  
  // Create a simple hash of master data to detect changes
  const currentHash = JSON.stringify(masterData.map(r => r.id)).slice(0, 100);
  
  // Rebuild cache if master data changed
  if (!stateCache || masterDataHash !== currentHash) {
    stateCache = buildStateCache(masterData);
    masterDataHash = currentHash;
  }
  
  const key = normalizeBillingItem(billingItem);
  return stateCache.get(key) || '';
};
