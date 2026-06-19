export * from '../common/config';

export const DEATH_SYSTEM = GetConvarInt('ox:deathSystem', 1) === 1;
export const CHARACTER_SELECT = GetConvarInt('ox:characterSelect', 1) === 1;
export const SPAWN_LOCATION = JSON.parse(GetConvar('ox:spawnLocation', '[-279.0, 803.0, 119.0, 0.0]'));
export const CHARACTER_SELECT_LOCATION = JSON.parse(
  GetConvar('ox:characterSelectLocation', '[-558.3258, -3781.111, 237.6, 93.2]'),
);
export const SPAWN_MODEL = GetHashKey(GetConvar('ox:spawnModel', 'player_zero'));
// Default rdr3 ped used when the configured spawn model fails to load.
export const SPAWN_MODEL_FALLBACK = GetHashKey(GetConvar('ox:spawnModelFallback', 'mp_male'));
export const HOSPITAL_BLIPS = GetConvarInt('ox:hospitalBlips', 1) === 1;
