export const APP_BUILD = '194';
export const ARMY_DATABASE_BUILD = 'ARMY9-v72';
export const COMBAT_MECHANICS_BUILD = '191';
export const EPIC_MECHANICS_BUILD = '191';
export const BATTLE_SIMULATOR_BUILD = '192';
export const PVP_ENGINE_BUILD = '191';
export const WORKSPACE_MODEL_BUILD = '191';
export const EPIC_COMBAT_ENGINE_BUILD = '2.3-opening-coin-toss';
export const EPIC_OPTIMIZER_BUILD = '2.6-shared-core';
export const EPIC_REVIEW_BUILD = '0.3-interruptible';

export const OPTIMIZER_CACHE_BUILD = [
  EPIC_OPTIMIZER_BUILD,
  EPIC_COMBAT_ENGINE_BUILD,
  BATTLE_SIMULATOR_BUILD,
  ARMY_DATABASE_BUILD,
].join(':');
