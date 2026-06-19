import { addCommand, triggerClientCallback } from '@overextended/ox_lib/server';
import { OxVehicle } from './class';
import { sleep } from '@overextended/ox_lib';
import { CreateVehicle } from 'vehicle';
import { OxPlayer } from 'player/class';
import { GetVehicleData } from '../../common/vehicles';

async function dismountIfNeeded(ped: number, mount: number) {
  if (!mount || mount === 0) return;
  if (!IsPedOnMount(ped) || GetMount(ped) !== mount) return;

  ClearPedTasksImmediately(ped);

  for (let i = 0; i < 20; i++) {
    await sleep(50);
    if (!IsPedOnMount(ped) || GetMount(ped) !== mount) break;
  }
}

export async function DeleteCurrentVehicle(ped: number) {
  // On RDR3 a ridden horse is a mount (ped), not a vehicle, so check both.
  const entity = GetVehiclePedIsIn(ped, false) || GetMount(ped);

  if (!entity) return false;

  await dismountIfNeeded(ped, GetMount(ped));

  const vehicle = OxVehicle.getFromEntity(entity);

  if (!vehicle) {
    if (DoesEntityExist(entity)) DeleteEntity(entity);
    return true;
  }

  vehicle.setStored('impound', true);
  vehicle.remove();
  return true;
}

addCommand<{ model: string; owner?: number }>(
  'car',
  async (playerId, args, raw) => {
    const ped = playerId && GetPlayerPed(playerId as any);

    if (!ped) return;

    const player = args.owner ? OxPlayer.get(args.owner) : null;
    const data = {
      model: args.model,
      owner: player?.charId || undefined,
    };

    const vehicle = await CreateVehicle(data, GetEntityCoords(ped), GetEntityHeading(ped));

    if (!vehicle.entity) return vehicle.remove();

    await DeleteCurrentVehicle(ped);
    await sleep(200);

    // Horses are mounts (peds) and can't be seated server-side; they spawn beside the player.
    if (GetVehicleData(args.model)?.type !== 'horse') SetPedIntoVehicle(ped, vehicle.entity, -1);
  },
  {
    help: 'Spawn a horse, wagon, cart, coach or boat with the given model.',
    params: [
      { name: 'model', type: 'string', help: 'The vehicle/horse archetype.' },
      {
        name: 'owner',
        type: 'playerId',
        help: "Create a persistent vehicle owned by the target's active character.",
        optional: true,
      },
    ],
    restricted: 'group.admin',
  },
);

addCommand(
  'dv',
  async (playerId) => {
    const ped = GetPlayerPed(playerId as any);

    const deleted = await DeleteCurrentVehicle(ped);
    if (deleted) return;

    // Fallback: resolve mount from the owning client and delete by netId.
    const mountNetId = await triggerClientCallback<number>('ox:getCurrentMountNetId', playerId);
    if (!mountNetId || mountNetId <= 0) return;

    const mountEntity = NetworkGetEntityFromNetworkId(mountNetId);
    if (mountEntity && mountEntity !== 0 && DoesEntityExist(mountEntity)) DeleteEntity(mountEntity);
  },
  {
    help: 'Deletes the vehicle or horse you are currently using.',
    restricted: 'group.admin',
  },
);
