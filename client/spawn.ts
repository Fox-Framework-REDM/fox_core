import { sleep, waitFor } from '@overextended/ox_lib';
import { cache, inputDialog } from '@overextended/ox_lib/client';
import { OxPlayer } from './player';
import { applyDirt } from './player/dirt';
import { netEvent } from 'utils';
import {
  CHARACTER_SELECT,
  CHARACTER_SELECT_LOCATION,
  SPAWN_LOCATION,
  SPAWN_MODEL,
  SPAWN_MODEL_FALLBACK,
} from 'config';
import locale from '../common/locales';
import type { Character, NewCharacter } from 'types';

let characterCam: number | undefined;

// Stop the cfx spawnmanager from auto-spawning; fox_core drives spawning via the session.
try {
  (exports as any).spawnmanager.setAutoSpawn(false);
} catch (e) {}

DoScreenFadeOut(0);
NetworkStartSoloTutorialSession();
setTimeout(() => emitNet('ox:playerJoined'));

async function requestModel(model: number) {
  if (!model) return false;

  RequestModel(model);
  await waitFor(() => (HasModelLoaded(model) ? true : undefined), '', 10000).catch(() => {});

  return HasModelLoaded(model);
}

// rdr3 ped natives whose typedef is the gta5 shape (or missing); call by hash.
const setPlayerModel = (playerId: number, model: number) =>
  Citizen.invokeNative('0xED40380076A31506', playerId, model, true);
const setRandomOutfitVariation = (ped: number) => Citizen.invokeNative('0x283978A15512B2FE', ped, true);
const updatePedVariation = (ped: number) =>
  Citizen.invokeNative('0xCC8CA3E88256E58F', ped, false, true, true, true, false);

async function setSpawnModel() {
  let model = SPAWN_MODEL;

  // Fall back to the default rdr3 ped if the configured model fails to load.
  if (!(await requestModel(model))) {
    model = SPAWN_MODEL_FALLBACK;
    if (!(await requestModel(model))) return;
  }

  setPlayerModel(cache.playerId, model);
  SetModelAsNoLongerNeeded(model);

  // rdr3 metapeds (mp_male/player_zero) spawn with no components loaded and render
  // invisible until an outfit variation is applied and the ped variation is updated.
  const ped = PlayerPedId();
  setRandomOutfitVariation(ped);
  updatePedVariation(ped);
  await sleep(300);
}

function createCharacterCam() {
  const ped = PlayerPedId();
  const [ox, oy, oz] = GetOffsetFromEntityInWorldCoords(ped, 0.0, 1.8, 0.2);
  const [cx, cy, cz] = GetEntityCoords(ped, true);

  characterCam = CreateCameraWithParams('DEFAULT_SCRIPTED_CAMERA', ox, oy, oz, 0.0, 0.0, 0.0, 30.0, false, 0);
  SetCamActive(characterCam, true);
  RenderScriptCams(true, false, 0, true, true);
  PointCamAtCoord(characterCam, cx, cy, cz + 0.1);
}

function destroyCharacterCam() {
  if (characterCam === undefined) return;

  RenderScriptCams(false, false, 0, true, true);
  DestroyCam(characterCam, false);
  characterCam = undefined;
}

async function StartSession() {
  if (GetIsLoadingScreenActive()) {
    SendLoadingScreenMessage('{"fullyLoaded": true}');
    ShutdownLoadingScreenNui();
  }

  NetworkStartSoloTutorialSession();
  DoScreenFadeOut(0);
  ShutdownLoadingScreen();
  DisplayRadar(false);
  SetPlayerControl(cache.playerId, false, 0);
  SetPlayerInvincible(cache.playerId, true);

  await setSpawnModel();

  while (!OxPlayer.isLoaded) {
    DisableAllControlActions(0);

    await sleep(0);
  }

  NetworkEndTutorialSession();
  DisplayRadar(true);
  SetPlayerControl(cache.playerId, true, 0);
  SetPlayerInvincible(cache.playerId, false);
  NetworkSetFriendlyFireOption(true);
}

netEvent('ox:startCharacterSelect', async (_userId: number, characters: Character[]) => {
  if (OxPlayer.isLoaded) {
    OxPlayer.isLoaded = false;

    emit('ox:playerLogout');
  }

  StartSession();

  if (!CHARACTER_SELECT) return;

  const [x, y, z, heading] = [
    CHARACTER_SELECT_LOCATION[0],
    CHARACTER_SELECT_LOCATION[1],
    CHARACTER_SELECT_LOCATION[2],
    CHARACTER_SELECT_LOCATION[3],
  ];

  const ped = PlayerPedId();
  RequestCollisionAtCoord(x, y, z);
  FreezeEntityPosition(ped, true);
  SetEntityCoordsNoOffset(ped, x, y, z, false, false, false);
  SetEntityHeading(ped, heading);

  await sleep(500);

  createCharacterCam();
  DoScreenFadeIn(500);

  const character = characters[0];

  if (character) {
    return emitNet('ox:setActiveCharacter', character.charId);
  }

  const input = await inputDialog(
    locale('create_character'),
    [
      {
        type: 'input',
        required: true,
        icon: 'user-pen',
        label: locale('firstname'),
        placeholder: 'John',
      },
      {
        type: 'input',
        required: true,
        icon: 'user-pen',
        label: locale('lastname'),
        placeholder: 'Smith',
      },
      {
        type: 'select',
        required: true,
        icon: 'circle-user',
        label: locale('gender'),
        options: [
          {
            label: locale('male'),
            value: 'male',
          },
          {
            label: locale('female'),
            value: 'female',
          },
          {
            label: locale('non_binary'),
            value: 'non_binary',
          },
        ],
      },
      {
        type: 'date',
        required: true,
        icon: 'calendar-days',
        label: locale('date_of_birth'),
        format: 'YYYY-MM-DD',
        min: '1900-01-01',
        max: '2006-01-01',
        default: '2006-01-01',
      },
    ],
    {
      allowCancel: false,
    },
  );

  if (!input) return;

  emitNet('ox:setActiveCharacter', <NewCharacter>{
    firstName: input[0] as string,
    lastName: input[1] as string,
    gender: input[2] as string,
    date: input[3] as number,
  });
});

netEvent('ox:setActiveCharacter', async (character: Character) => {
  destroyCharacterCam();

  const [x, y, z, heading] = [
    character.x ?? SPAWN_LOCATION[0],
    character.y ?? SPAWN_LOCATION[1],
    character.z ?? SPAWN_LOCATION[2],
    character.heading ?? SPAWN_LOCATION[3],
  ];

  DoScreenFadeOut(CHARACTER_SELECT ? 200 : 0);
  await sleep(CHARACTER_SELECT ? 200 : 0);

  RequestCollisionAtCoord(x, y, z);
  StartPlayerTeleport(cache.playerId, x, y, z, heading, false, true, true);

  while (IsPlayerTeleportActive()) await sleep(0);

  await waitFor(() => (IsScreenFadedOut() || IsScreenFadedIn() ? true : undefined), '', 0).catch(() => {});

  const ped = PlayerPedId();
  SetEntityHealth(ped, character.health ?? GetEntityMaxHealth(ped));
  FreezeEntityPosition(ped, false);
  applyDirt(character.dirt);

  DoScreenFadeIn(500);

  OxPlayer.isLoaded = true;

  emit('playerSpawned');
  emit('ox:playerLoaded', OxPlayer, character.isNew);
});
