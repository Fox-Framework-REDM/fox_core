import { OxPlayer } from 'player';
import type { PedDirt } from 'types';

// ePedAttribute indices for rdr3 body dirtiness.
const SA_DIRTINESS = 16;
const SA_DIRTINESS_HAT = 17;
const SA_DIRTINESS_SKIN = 22;

// rdr3-only attribute natives (not in the JS typedef, called by hash).
const getRank = (ped: number, index: number) => Citizen.invokeNative<number>('0x147149F2E909323C', ped, index);
const setRank = (ped: number, index: number, value: number) =>
  Citizen.invokeNative('0x5DA12E025D47D4E5', ped, index, value);

export function applyDirt(dirt?: PedDirt) {
  if (!dirt) return;

  const ped = PlayerPedId();
  if (dirt.body != null) setRank(ped, SA_DIRTINESS, dirt.body);
  if (dirt.hat != null) setRank(ped, SA_DIRTINESS_HAT, dirt.hat);
  if (dirt.skin != null) setRank(ped, SA_DIRTINESS_SKIN, dirt.skin);
}

function readDirt(): PedDirt {
  const ped = PlayerPedId();

  return {
    body: getRank(ped, SA_DIRTINESS),
    hat: getRank(ped, SA_DIRTINESS_HAT),
    skin: getRank(ped, SA_DIRTINESS_SKIN),
  };
}

on('ox:playerLoaded', () => {
  const id: CitizenTimer = setInterval(() => {
    if (!OxPlayer.isLoaded) return clearInterval(id);

    emitNet('ox:setDirt', readDirt());
  }, 60000);
});

// Washes the ped; the server triggers this for a future reset-character command.
onNet('ox:clearDirt', () => {
  const ped = PlayerPedId();

  setRank(ped, SA_DIRTINESS, 0);
  setRank(ped, SA_DIRTINESS_HAT, 0);
  setRank(ped, SA_DIRTINESS_SKIN, 0);
  ClearPedEnvDirt(ped);
  Citizen.invokeNative('0xE3144B932DFDFF65', ped, 0.0, -1, true, true); // SetPedDirtCleaned
});
