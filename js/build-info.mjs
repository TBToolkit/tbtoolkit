export const APP_BUILD = '222';
export const ARMY_DATABASE_BUILD = 'ARMY9-v72';
export const COMBAT_MECHANICS_BUILD = '197';
export const EPIC_MECHANICS_BUILD = '197';
export const BATTLE_SIMULATOR_BUILD = '192';
export const PVP_ENGINE_BUILD = '197';
export const WORKSPACE_MODEL_BUILD = '191';
export const EPIC_COMBAT_ENGINE_BUILD = '2.5-deterministic-top-up';
export const EPIC_OPTIMIZER_BUILD = '2.13-capacity-top-up';
export const EPIC_REVIEW_BUILD = '0.5-tier-replacement-coverage';

export const EPIC_EXPLORE_BUILD = '1.2-canonical-origin';

export const OPTIMIZER_CACHE_BUILD = [
  EPIC_OPTIMIZER_BUILD,
  EPIC_EXPLORE_BUILD,
  EPIC_COMBAT_ENGINE_BUILD,
  BATTLE_SIMULATOR_BUILD,
  ARMY_DATABASE_BUILD,
].join(':');
