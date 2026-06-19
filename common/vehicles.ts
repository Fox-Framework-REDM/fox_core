import { LoadDataFile } from './';
import type { Dict, VehicleData, Vehicles } from 'types';

const vehicles: Dict<VehicleData> = LoadDataFile('vehicles');

export function GetVehicleData(): Vehicles;
export function GetVehicleData<T extends string>(filter: T): VehicleData;
export function GetVehicleData<T extends string[]>(
  filter: T,
): {
  [K in T[number]]: VehicleData;
};

export function GetVehicleData(filter?: void | string | string[]) {
  if (!filter) return vehicles;

  if (typeof filter === 'string') return vehicles[filter];

  if (Array.isArray(filter)) {
    const obj: Record<string, any> = {};

    filter.forEach((name) => {
      const vehicle = vehicles[name];

      if (vehicle) obj[name] = vehicle;
    });

    return obj;
  }
}

/**
 * Remap vehicle types to their net types.
 * https://github.com/citizenfx/fivem/commit/1e266a2ca5c04eb96c090de67508a3475d35d6da
 */
export function GetVehicleNetworkType(modelName: string) {
  const vehicleType = vehicles[modelName]?.type;

  switch (vehicleType) {
    case 'bicycle':
      return 'bike';
    case 'blimp':
      return 'heli';
    case 'quadbike':
    case 'amphibious_quadbike':
    case 'amphibious_automobile':
    case 'submarinecar':
    // RDR3 draft vehicles (wagons, carts, carriages, handcar) are networked as automobiles.
    case 'draft':
    case 'cart':
    case 'wagon':
    case 'handcar':
      return 'automobile';
    default:
      return vehicleType;
  }
}

exports('GetVehicleData', GetVehicleData);
exports('GetVehicleNetworkType', GetVehicleNetworkType);
