import { sleep } from '@overextended/ox_lib';
import { cache, onServerCallback } from '@overextended/ox_lib/client';
import { Vector3 } from '@nativewrappers/fivem';

// Applies replicated health on the owning client (SetEntityHealth is client-only on RDR3).
// health <= 0 spawns the horse dead, like the player.
AddStateBagChangeHandler('health', '', (bagName: string, _key: string, value: number) => {
  if (value === undefined || value === null) return;
  if (bagName.startsWith('player:')) return;

  const entity = GetEntityFromStateBagName(bagName);

  if (!entity || !NetworkGetEntityIsNetworked(entity)) return;
  if (entity === PlayerPedId()) return;
  if (NetworkGetEntityOwner(entity) !== cache.playerId) return;

  SetEntityHealth(entity, value);
});

// Nearby networked wagons/boats (CVehicle pool); horses are peds (CPed) and excluded.
onServerCallback('ox:getNearbyVehicles', (radius: number) => {
  const nearbyEntities: number[] = [];
  const playerCoords = Vector3.fromArray(GetEntityCoords(cache.ped, true));

  (GetGamePool('CVehicle') as number[]).forEach((entityId) => {
    const coords = Vector3.fromArray(GetEntityCoords(entityId, true));
    const distance = coords.distance(playerCoords);

    if (distance <= (radius ?? 2) && NetworkGetEntityIsNetworked(entityId)) nearbyEntities.push(VehToNet(entityId));
  });

  return nearbyEntities;
});

// Current ridden horse as network id (RedM mount is a ped, not CVehicle).
onServerCallback('ox:getCurrentMountNetId', () => {
  const mount = GetMount(cache.ped);

  if (!mount || mount === 0) return 0;
  if (!DoesEntityExist(mount) || !NetworkGetEntityIsNetworked(mount)) return 0;

  return PedToNet(mount);
});

const createHorsePed = (modelHash: number, coords: { x: number; y: number; z: number }, heading: number, isNetworked: boolean, scriptHost: boolean) =>
  (globalThis as any).CreatePed(modelHash, coords.x, coords.y, coords.z, heading, isNetworked, scriptHost, false, false) as number;

const getFallbackHorseSpawn = () => {
  const ped = cache.ped || PlayerPedId();
  const heading = GetEntityHeading(ped);
  const coords = Vector3.fromArray(GetOffsetFromEntityInWorldCoords(ped, 2.2, 0.8, 0.0));

  return { coords: { x: coords.x, y: coords.y, z: coords.z }, heading };
};

const spawnHorsePed = async (modelHash: number, coords: { x: number; y: number; z: number }, heading: number) => {
  const attempts = [
    [true, true],
    [true, false],
  ];

  for (const [isNetworked, scriptHost] of attempts) {
    const horse = createHorsePed(modelHash, coords, heading, isNetworked, scriptHost);
    if (horse && DoesEntityExist(horse)) return horse;
    await sleep(50);
  }

  return 0;
};

onServerCallback('ox:spawnHorse', async (model: string, coords?: { x: number; y: number; z: number }, heading?: number) => {
  const modelHash = GetHashKey(model);

  if (!IsModelValid(modelHash)) return 0;

  RequestModel(modelHash);

  const timeout = GetGameTimer() + 5000;
  while (!HasModelLoaded(modelHash) && GetGameTimer() < timeout) await sleep(10);

  if (!HasModelLoaded(modelHash)) return 0;

  const fallback = getFallbackHorseSpawn();
  const spawn = {
    coords:
      coords && typeof coords.x === 'number' && typeof coords.y === 'number' && typeof coords.z === 'number'
        ? coords
        : fallback.coords,
    heading: typeof heading === 'number' ? heading : fallback.heading,
  };

  RequestCollisionAtCoord(spawn.coords.x, spawn.coords.y, spawn.coords.z);
  let horse = await spawnHorsePed(modelHash, spawn.coords, spawn.heading);

  if (!horse || !DoesEntityExist(horse)) {
    horse = await spawnHorsePed(modelHash, spawn.coords, spawn.heading);
  }

  SetModelAsNoLongerNeeded(modelHash);

  if (!horse || !DoesEntityExist(horse)) return 0;

  if (!NetworkGetEntityIsNetworked(horse)) {
    DeleteEntity(horse);
    return 0;
  }

  SetEntityAsMissionEntity(horse, true, true);
  SetEntityVisible(horse, true, false);
  SetEntityAlpha(horse, 255, false);
  SetEntityCollision(horse, true, true);
  FreezeEntityPosition(horse, false);
  SetEntityInvincible(horse, false);
  (globalThis as any).PlaceEntityOnGroundProperly?.(horse, true);
  (globalThis as any).SetRandomOutfitVariation?.(horse, true);
  (globalThis as any).UpdatePedVariation?.(horse, false, true, true, true, false);

  const netId = PedToNet(horse);
  if (!netId || netId <= 0) return 0;

  SetNetworkIdExistsOnAllMachines(netId, true);

  return netId;
});
