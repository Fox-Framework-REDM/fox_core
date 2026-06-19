import { cache, sleep } from '@overextended/ox_lib/client';
import { Vector3, Vector4 } from '@nativewrappers/fivem';
import { OxPlayer } from 'player';
import { DEATH_SYSTEM, DEBUG, HOSPITAL_BLIPS } from 'config';
import { LoadDataFile } from '../common';

const BlipAddForCoords = (hash: number, x: number, y: number, z: number) =>
  Citizen.invokeNative<number>('0x554D9D53F696D002', hash, x, y, z);
const DOCTOR_BLIP = GetHashKey('blip_ambient_doctor');

const hospitals: Vector4[] = LoadDataFile('hospitals').map((vec: number[]) => {
  const hospital = Vector4.fromArray(vec);

  if (HOSPITAL_BLIPS) {
    BlipAddForCoords(DOCTOR_BLIP, hospital.x, hospital.y, hospital.z);
  }

  return hospital;
});

let playerIsDead = false;

function forceDowned(ped: number) {
  if (!IsPedRagdoll(ped)) SetPedToRagdoll(ped, 60000, 60000, 0, false, false, false);

  DisableOnFootFirstPersonViewThisUpdate();
  DisableAllControlActions(0);
}

async function ClearDeath(tickId: number, bleedOut: boolean) {
  clearTick(tickId);

  const ped = PlayerPedId();

  if (bleedOut) {
    const coords = Vector3.fromArray(GetEntityCoords(ped, true));
    let distance = Infinity;
    const hospital = hospitals.reduce((closest, hospital) => {
      const hospitalDistance = coords.distance(hospital);

      if (hospitalDistance > distance) return closest;

      distance = hospitalDistance;
      return hospital;
    });

    DoScreenFadeOut(500);
    RequestCollisionAtCoord(hospital.x, hospital.y, hospital.z);

    while (!IsScreenFadedOut()) await sleep(0);

    NetworkResurrectLocalPlayer(hospital.x, hospital.y, hospital.z, hospital.w, 0, false);
    SetEntityCoordsNoOffset(ped, hospital.x, hospital.y, hospital.z, false, false, false);
    SetEntityHeading(ped, hospital.w);

    await sleep(500);

    DoScreenFadeIn(500);

    while (!IsScreenFadedIn()) await sleep(0);
  }

  ClearPedTasksImmediately(ped);
  ClearPedBloodDamage(ped);
  SetEntityHealth(ped, GetEntityMaxHealth(ped));
  SetEveryoneIgnorePlayer(cache.playerId, false);
  SetPlayerInvincible(cache.playerId, false);
  SetPlayerControl(cache.playerId, true, 0);

  emit('ox:playerRevived');
}

const bleedOutTime = DEBUG ? 100 : 1000;

async function OnPlayerDeath() {
  emitNet('ox:playerDeath');
  emit('ox_inventory:disarm');
  emit('ox:playerDeath');

  if (!DEATH_SYSTEM) return;

  const ped = PlayerPedId();
  const coords = GetEntityCoords(ped, true);
  const health = Math.floor(Math.max(100, GetEntityMaxHealth(ped) * 0.8));

  NetworkResurrectLocalPlayer(coords[0], coords[1], coords[2], GetEntityHeading(ped), 0, false);

  SetEntityInvincible(ped, true);
  SetEntityHealth(ped, health);
  SetEveryoneIgnorePlayer(cache.playerId, true);
  SetPlayerControl(cache.playerId, false, 0);
  SetPedToRagdoll(ped, 60000, 60000, 0, false, false, false);

  let bleedOut = 0;
  const tickId = setTick(() => {
    forceDowned(PlayerPedId());

    bleedOut++;

    if (bleedOut > bleedOutTime) ClearDeath(tickId, true);
  });
}

AddStateBagChangeHandler('isDead', `player:${cache.serverId}`, async (_bagName: string, _key: string, value: any) => {
  playerIsDead = value;
});

function ResetDeathState() {
  emitNet('ox:playerRevived');
}

on('ox:playerLogout', ResetDeathState);
on('ox:playerRevived', ResetDeathState);

on('ox:playerLoaded', () => {
  const id: CitizenTimer = setInterval(() => {
    if (!OxPlayer.isLoaded) return clearInterval(id);

    if (!playerIsDead && IsPedDeadOrDying(PlayerPedId(), true)) OnPlayerDeath();
  }, 200);
});
