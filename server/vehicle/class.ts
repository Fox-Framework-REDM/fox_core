import { ClassInterface } from 'classInterface';
import { DeleteVehicle, IsPlateAvailable, IsVinAvailable, SaveVehicleData, SetVehicleColumn } from './db';
import {
  getRandomString,
  getRandomAlphanumeric,
  getRandomChar,
  getRandomInt,
  sleep,
  type VehicleProperties,
} from '@overextended/ox_lib';
import { PLATE_PATTERN } from '../../common/config';
import type { Dict, VehicleData } from 'types';
import { GetVehicleData, GetVehicleNetworkType } from '../../common/vehicles';
import { Vector3 } from '@nativewrappers/server';
import { SpawnVehicle } from 'vehicle';
import { triggerClientCallback } from '@overextended/ox_lib/server';
import { OxPlayer } from 'player/class';

export type Vec3 = number[] | { x: number; y: number; z: number } | { buffer: any };

const setEntityOrphanMode = typeof SetEntityOrphanMode !== 'undefined' ? SetEntityOrphanMode : () => {};
const setEntityHealth = (entity: number, health: number) => {
  const native = (globalThis as { SetEntityHealth?: (entity: number, healthAmount: number, entityKilledBy?: number) => void })
    .SetEntityHealth;
  if (native) native(entity, health, 0);
};
function getHorseSpawnPlayer(owner?: number) {
  if (owner) {
    const player = OxPlayer.getFromCharId(owner);
    if (player?.source) return Number(player.source);
  }

  // GetPlayers is a Lua-runtime helper and does not exist in the fxserver node runtime;
  // enumerate the OxPlayer registry (maintained by join/exit events) instead.
  const players = OxPlayer.getAll(undefined, true);
  const first = players.find((p) => p.source);
  return first ? Number(first.source) : 0;
}

export class OxVehicle extends ClassInterface {
  script: string;
  plate: string;
  model: string;
  make: string;
  id?: number;
  vin: string;
  owner?: number;
  group?: string;
  entity?: number;
  netId?: number;
  #metadata: Dict<any>;
  #properties: Partial<VehicleProperties>;
  #stored: string | null;
  /** Entity health, persisted so horses/wagons keep their condition across spawns. */
  #health: number | null;
  /** Horse identity / breeding (NULL for wagons/boats). Tack/components live in `data` JSON. */
  nickname: string | null;
  gender: string | null;
  bonding: number | null;
  fertile: number | null;

  protected static members: Dict<OxVehicle> = {};
  protected static keys: Dict<Dict<OxVehicle>> = {
    id: {},
    netId: {},
    entity: {},
  };

  static async spawn(model: string, coords: Vector3, heading?: number, owner?: number) {
    const modelHash = GetHashKey(model);
    const vehicleType = GetVehicleData(model)?.type;

    if (vehicleType === 'horse') {
      const playerId = getHorseSpawnPlayer(owner);
      if (!playerId) throw new Error(`Failed to spawn '${model}' (no client available)`);

      const netId = await triggerClientCallback<number>('ox:spawnHorse', playerId, model, { x: coords.x, y: coords.y, z: coords.z }, heading ?? 0);
      let entity = netId && NetworkGetEntityFromNetworkId(netId);

      for (let i = 0; netId && (!entity || !DoesEntityExist(entity)) && i < 20; i++) {
        await sleep(50);
        entity = NetworkGetEntityFromNetworkId(netId);
      }

      if (!entity || !DoesEntityExist(entity)) {
        throw new Error(`Failed to spawn '${model}' at ${coords.x}, ${coords.y}, ${coords.z}`);
      }

      return entity;
    }

    const entityId = CreateVehicleServerSetter(
      modelHash,
      GetVehicleNetworkType(model),
      coords.x,
      coords.y,
      coords.z,
      heading || 0,
    );

    if (!entityId || !DoesEntityExist(entityId)) {
      throw new Error(`Failed to spawn '${model}' at ${coords.x}, ${coords.y}, ${coords.z}`);
    }

    setEntityOrphanMode(entityId, 2);

    return entityId;
  }

  static get(vin: string) {
    const vehicle = this.members[vin];

    if (vehicle) return vehicle;

    return SpawnVehicle(vin);
  }

  static getFromVehicleId(vehicleId: number) {
    return this.keys.id[vehicleId];
  }

  static getFromNetId(id: number) {
    return this.keys.netId[id];
  }

  static getFromEntity(entityId: number) {
    return this.keys.entity[entityId];
  }

  private filter(criteria: Dict<any>) {
    for (const key in criteria) {
      const value = criteria[key];

      if (this[key as keyof OxVehicle] !== value && this.#metadata[key] !== value) return;
    }

    return this;
  }

  static getFromFilter(filter: Dict<any>) {
    for (const id in this.members) {
      const vehicle = this.members[id].filter(filter);
      if (vehicle) return vehicle;
    }
  }

  static getAll(filter?: Dict<any>, asArray?: false): Dict<OxVehicle>;
  static getAll(filter?: Dict<any>, asArray?: true): OxVehicle[];
  static getAll(filter?: Dict<any>, asArray = false): Dict<OxVehicle> | OxVehicle[] {
    if (!filter) return asArray ? Object.values(this.members) : this.members;

    const obj: Dict<OxVehicle> = {};

    for (const id in this.members) {
      const vehicle = this.members[id].filter(filter);
      if (vehicle) obj[id] = vehicle;
    }

    return asArray ? Object.values(obj) : obj;
  }

  static async generateVin({ make, name }: VehicleData, isOwned = true) {
    if (!name) throw new Error('generateVin received invalid VehicleData (invalid model)');

    const arr = [
      getRandomInt(),
      make ? make.slice(0, 2).toUpperCase() : 'OX',
      name.slice(0, 2).toUpperCase(),
      null,
      null,
      Math.floor(Date.now() / 1000),
    ];

    let vin: string;

    while (true) {
      arr[3] = getRandomAlphanumeric();
      arr[4] = getRandomChar();
      vin = arr.join('');

      if (!isOwned || (await IsVinAvailable(vin))) break;
    }

    return isOwned ? vin : `T${vin}`;
  }

  static async generatePlate(pattern: string = PLATE_PATTERN) {
    while (true) {
      const plate = getRandomString(pattern);

      if (await IsPlateAvailable(plate)) return plate;
    }
  }

  static saveAll(resource?: string) {
    if (resource === 'fox_core') resource = '';

    const parameters = [];

    for (const id in this.members) {
      const vehicle = this.members[id];

      if (!resource || resource === vehicle.script) {
        if (vehicle.owner || vehicle.group) {
          vehicle.#stored = 'impound';
          parameters.push(vehicle.#getSaveData());
        }

        vehicle.remove();
      }
    }

    DEV: console.info(`Saving ${parameters.length} vehicles to the database.`);

    if (parameters.length > 0) {
      SaveVehicleData(parameters, true);
      emit('ox:savedVehicles', parameters.length);
    }
  }

  constructor(
    vin: string,
    script: string,
    plate: string,
    model: string,
    make: string,
    stored: string | null,
    metadata: Dict<any>,
    properties: Partial<VehicleProperties>,
    id?: number,
    owner?: number,
    group?: string,
    health?: number | null,
  ) {
    super();
    this.script = script;
    this.plate = plate;
    this.model = model;
    this.make = make;
    this.id = id;
    this.vin = vin;
    this.owner = owner;
    this.group = group;
    this.#properties = properties;
    this.#metadata = metadata || {};
    this.#stored = stored;
    this.#health = health ?? null;
    this.nickname = null;
    this.gender = null;
    this.bonding = null;
    this.fertile = null;

    OxVehicle.add(this.vin, this);
  }

  setHorseData(data: { nickname?: string; gender?: string; bonding?: number; fertile?: number }) {
    if (data.nickname !== undefined) this.nickname = data.nickname ?? null;
    if (data.gender !== undefined) this.gender = data.gender ?? null;
    if (data.bonding !== undefined) this.bonding = data.bonding ?? null;
    if (data.fertile !== undefined) this.fertile = data.fertile ?? null;
  }

  setNickname(value: string | null) {
    this.nickname = value;
    SetVehicleColumn(this.id, 'nickname', value);
  }

  setGender(value: string | null) {
    this.gender = value;
    SetVehicleColumn(this.id, 'gender', value);
  }

  setBonding(value: number | null) {
    this.bonding = value;
    SetVehicleColumn(this.id, 'bonding', value);
  }

  setFertile(value: boolean | number | null) {
    this.fertile = value == null ? null : value ? 1 : 0;
    SetVehicleColumn(this.id, 'fertile', this.fertile);
  }

  getHealth() {
    if (this.entity && DoesEntityExist(this.entity)) this.#health = GetEntityHealth(this.entity);

    return this.#health;
  }

  setHealth(value: number) {
    this.#health = value;

    if (this.entity && DoesEntityExist(this.entity)) setEntityHealth(this.entity, value);

    const state = this.getState();
    if (state) state.set('health', value, true);
  }

  set(key: string, value: any) {
    this.#metadata[key] = value;
  }

  get(key: string) {
    return this.#metadata[key];
  }

  getState() {
    return this.entity ? Entity(this.entity).state : null;
  }

  getStored() {
    return this.#stored;
  }

  getProperties() {
    return this.#properties;
  }

  #getSaveData() {
    if (!this.id) return;

    return [
      this.#stored,
      JSON.stringify({ ...this.#metadata, properties: this.#properties }),
      this.getHealth(),
      this.id,
    ];
  }

  save() {
    const saveData = this.#getSaveData();
    return saveData && SaveVehicleData(saveData);
  }

  despawn(save?: boolean) {
    if (!this.entity) return;

    emit('ox:despawnVehicle', this.entity, this.id);

    const saveData = save && this.#getSaveData();
    if (saveData) SaveVehicleData(saveData);
    if (DoesEntityExist(this.entity)) DeleteEntity(this.entity);
  }

  delete() {
    if (this.id) DeleteVehicle(this.id);

    this.despawn(false);
    OxVehicle.remove(this.vin);
  }

  remove() {
    this.despawn(true);
    OxVehicle.remove(this.vin);
  }

  setStored(value: string | null, despawn?: boolean) {
    this.#stored = value;

    if (despawn) return this.remove();

    SetVehicleColumn(this.id, 'stored', value);
  }

  setOwner(charId?: number) {
    if (this.owner === charId) return;

    charId ? (this.owner = charId) : delete this.owner;

    SetVehicleColumn(this.id, 'owner', this.owner);
  }

  setGroup(group?: string) {
    if (this.group === group) return;

    group ? (this.group = group) : delete this.group;

    SetVehicleColumn(this.id, 'group', this.group);
  }

  setPlate(plate: string) {
    if (this.plate === plate) return;

    this.plate = plate.length > 8 ? plate.substring(0, 8) : plate.padEnd(8);

    SetVehicleColumn(this.id, 'plate', this.plate);
  }

  setProperties(properties: Partial<VehicleProperties>, _apply?: boolean) {
    if (!this.entity) return;

    this.#properties = typeof properties === 'string' ? JSON.parse(properties) : properties;
  }

  async respawn(coords?: Vec3, rotation: Vector3 | number = 0): Promise<number | null> {
    const hasEntity = !!this.entity && DoesEntityExist(this.entity);

    if (!coords && hasEntity) {
      coords = GetEntityCoords(this.entity as number);
    } else if (coords) {
      coords = Vector3.fromObject(coords);
    }

    if (!coords) return null;

    rotation =
      typeof rotation === 'number'
        ? rotation
        : Vector3.fromObject(rotation || hasEntity ? GetEntityRotation(this.entity as number) : null);

    if (hasEntity) {
      emit('ox:despawnVehicle', this.entity, this.id);
      DeleteEntity(this.entity as number);
    }

    OxVehicle.remove(this.vin);

    this.entity = await OxVehicle.spawn(this.model, coords as Vector3, typeof rotation === 'number' ? rotation : 0, this.owner);
    if (!this.entity || !DoesEntityExist(this.entity)) return null;

    this.netId = NetworkGetNetworkIdFromEntity(this.entity);

    if (typeof rotation !== 'number') SetEntityRotation(this.entity, rotation.x, rotation.y, rotation.z, 2, false);

    OxVehicle.add(this.vin, this);

    // Plates/vehicle properties are GTA-only; horses (peds) and RDR3 vehicles skip them.
    if (this.#health != null) setEntityHealth(this.entity, this.#health);

    emit('ox:spawnedVehicle', this.entity, this.id);

    const state = this.getState();

    if (state) {
      if (GetVehicleData(this.model)?.type !== 'horse') state.set('ox_entity_setonground', true, true);
      if (this.#health != null) state.set('health', this.#health, true);
    }

    return this.entity;
  }
}

OxVehicle.init();

exports('SaveAllVehicles', (arg: any) => OxVehicle.saveAll(arg));
exports('GetVehicleFromNetId', (arg: any) => OxVehicle.getFromNetId(arg));
exports('GetVehicleFromVin', (arg: any) => OxVehicle.get(arg));
exports('GetVehicleFromEntity', (arg: any) => OxVehicle.getFromEntity(arg));
exports('GetVehicleFromFilter', (arg: any) => OxVehicle.getFromFilter(arg));
exports('GetVehicles', (arg: any) => OxVehicle.getAll(arg, true));
exports('GenerateVehicleVin', (model: string) => OxVehicle.generateVin(GetVehicleData(model)));
exports('GenerateVehiclePlate', (pattern?: string) => OxVehicle.generatePlate(pattern));
