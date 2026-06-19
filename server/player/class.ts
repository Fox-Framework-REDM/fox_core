import { ClassInterface } from 'classInterface';
import {
  AddCharacterLicense,
  CreateCharacter,
  DeleteCharacter,
  GetCharacterLicenses,
  GetCharacterMetadata,
  GetCharacters,
  IsStateIdAvailable,
  RemoveCharacterLicense,
  SaveCharacterData,
  UpdateCharacterLicense,
} from './db';
import { getRandomChar, getRandomInt } from '@overextended/ox_lib';
import { GetGroup, GetGroupsByType } from 'groups';
import { GenerateTelegramId } from './telegram';
import { Statuses } from './status';
import { addPrincipal, removePrincipal } from '@overextended/ox_lib/server';
import {
  AddCharacterGroup,
  GetCharacterGroups,
  RemoveCharacterGroup,
  UpdateCharacterGroup,
  SetActiveGroup,
} from 'groups/db';
import { PayAccountInvoice } from 'accounts';
import type {
  Character,
  Dict,
  NewCharacter,
  PlayerMetadata,
  OxGroup,
  CharacterLicense,
  BanDetails,
  PedDirt,
  SpawnOverride,
} from 'types';
import { GetGroupPermissions } from '../../common';
import { Licenses } from './license';
import { CHARACTER_SLOTS } from 'config';
import locales from '../../common/locales';

export class OxPlayer extends ClassInterface {
  source: number | string;
  userId: number;
  charId?: number;
  stateId?: string;
  username: string;
  identifier: string;
  ped: number;
  #characters: Character[];
  #metadata: Dict<any>;
  #statuses: Dict<number>;
  #groups: Dict<number>;
  #licenses: Dict<CharacterLicense>;
  #dirt: PedDirt | null;
  #health: number | null = null;
  #isDead = false;

  protected static members: Dict<OxPlayer> = {};
  protected static keys: Dict<Dict<OxPlayer>> = {
    userId: {},
    charId: {},
  };

  // Player(source) can already be invalid by the time `playerDropped` fires (same issue as the
  // stale ped handle worked around in #getSaveData), which silently breaks save() right when a
  // player disconnects. Cache health/isDead from the statebag as they change instead of reading
  // them live — this also fires for local server-side `.state.set()` calls, not just
  // client-replicated updates, so it stays in sync with every existing call site for free.
  static {
    AddStateBagChangeHandler('health', '', (bagName: string, _key: string, value: number | null) => {
      if (!bagName.startsWith('player:')) return;

      const player = OxPlayer.get(bagName.slice(7));
      if (player) player.#health = typeof value === 'number' && value > 0 ? Math.floor(value) : null;
    });

    AddStateBagChangeHandler('isDead', '', (bagName: string, _key: string, value: boolean) => {
      if (!bagName.startsWith('player:')) return;

      const player = OxPlayer.get(bagName.slice(7));
      if (player) player.#isDead = !!value;
    });
  }

  static get(id: string | number) {
    return this.members[id];
  }

  static getFromUserId(id: number) {
    return this.keys.userId[id];
  }

  static getFromCharId(id: number) {
    return this.keys.charId[id];
  }

  static formatBanReason(ban: BanDetails) {
    const unbanTime = ban.unban_at ? new Date(ban.unban_at) : null;
    let timeRemainingMessage;

    if (unbanTime) {
      const timeRemaining = +unbanTime - Date.now();
      const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
      const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);

      timeRemainingMessage = locales('ban_expires_in', hours, minutes, seconds);
    } else timeRemainingMessage = locales('ban_indefinite');

    return locales('ban_notice', new Date(ban.banned_at).toLocaleString(), ban.reason, timeRemainingMessage);
  }

  private filter(criteria: Dict<any>) {
    const { groups, ...filter } = criteria;

    if (groups && !this.getGroup(groups)) return;

    for (const key in filter) {
      const value = filter[key];

      if (this[key as keyof OxPlayer] !== value && this.#metadata[key] !== value) return;
    }

    return this;
  }

  static getFromFilter(filter: Dict<any>) {
    for (const id in this.members) {
      const player = this.members[id].filter(filter);
      if (player) return player;
    }
  }

  static getAll(filter?: Dict<any>, asArray?: false): Dict<OxPlayer>;
  static getAll(filter?: Dict<any>, asArray?: true): OxPlayer[];
  static getAll(filter?: Dict<any>, asArray = false): Dict<OxPlayer> | OxPlayer[] {
    if (!filter) return asArray ? Object.values(this.members) : this.members;

    const obj: Dict<OxPlayer> = {};

    for (const id in this.members) {
      const player = this.members[id].filter(filter);
      if (player) obj[id] = player;
    }

    return asArray ? Object.values(obj) : obj;
  }

  static saveAll(kickWithReason?: string) {
    const parameters = [];

    for (const id in this.members) {
      const player = this.members[id];

      if (player.charId) {
        parameters.push(player.#getSaveData());
      }

      if (kickWithReason) {
        delete player.charId;
        DropPlayer(player.source as string, kickWithReason);
      }
    }

    DEV: console.info(`Saving ${parameters.length} players to the database.`);

    if (parameters.length > 0) {
      SaveCharacterData(parameters, true);
      emit('ox:savedPlayers', parameters.length);
    }
  }

  constructor(source: number) {
    super();
    this.source = source;
    this.#characters = [];
    this.#metadata = {};
    this.#statuses = {};
    this.#groups = {};
    this.#licenses = {};
    this.#dirt = null;
  }

  emit(eventName: string, ...args: any[]) {
    emitNet(eventName, this.source, ...args);
  }

  set<K extends string>(
    key: K | keyof PlayerMetadata,
    value: K extends keyof PlayerMetadata ? PlayerMetadata[K] : any,
    replicated?: boolean,
  ): void;
  set(key: string, value: any, replicated?: boolean) {
    this.#metadata[key] = value;

    if (replicated) this.emit('ox:setPlayerData', key, value);
  }

  get<K extends string>(key: K | keyof PlayerMetadata): K extends keyof PlayerMetadata ? PlayerMetadata[K] : any {
    return this.#metadata[key];
  }

  async payInvoice(invoiceId: number) {
    if (!this.charId) return;
    return await PayAccountInvoice(invoiceId, this.charId);
  }

  setActiveGroup(groupName?: string, temp?: boolean) {
    if (!this.charId || (groupName && !(groupName in this.#groups))) return false;

    const currentActiveGroup = this.get('activeGroup');

    if (currentActiveGroup) {
      GlobalState[`${currentActiveGroup}:activeCount`] -= 1;

      const group = GetGroup(currentActiveGroup);
      group.activePlayers.delete(+this.source);
    }

    if (groupName) {
      GlobalState[`${groupName}:activeCount`] += 1;

      const group = GetGroup(groupName);
      group.activePlayers.add(+this.source);
    }

    SetActiveGroup(this.charId, temp ? undefined : groupName);
    this.set('activeGroup', groupName, true);
    emit('ox:setActiveGroup', this.source, groupName, currentActiveGroup);

    return true;
  }

  /** Sets the active character's grade in a group. If the grade is 0 they will be removed from the group. */
  async setGroup(groupName: string, grade = 0, force = false) {
    if (!this.charId) return false;

    const group = GetGroup(groupName);

    if (!group) return console.warn(`Failed to set OxPlayer<${this.userId}> ${groupName}:${grade} (invalid group)`);

    const currentGrade = this.#groups[groupName];

    if (currentGrade === grade) return;

    if (!grade) {
      if (!currentGrade) return;
      if (!force && !(await RemoveCharacterGroup(this.charId, group.name))) return;

      this.#removeGroup(group, currentGrade, true);

      if (this.get('activeGroup') === groupName) this.set('activeGroup', undefined, true);
    } else {
      if (!group.grades[grade] && grade > 0)
        return console.warn(`Failed to set OxPlayer<${this.userId}> ${group.name}:${grade} (invalid grade)`);

      if (currentGrade) {
        if (!(await UpdateCharacterGroup(this.charId, group.name, grade))) return;

        this.#removeGroup(group, currentGrade, false);
        this.#addGroup(group, grade);
      } else {
        const relatedGroups = group.type && GetGroupsByType(group.type);

        if (
          relatedGroups &&
          relatedGroups.some((name) => {
            return name in this.#groups;
          })
        )
          return console.warn(
            `Failed to set OxPlayer<${this.userId}> ${group.name}:${grade} (already has group of type '${group.type}')`,
          );

        if (!(await AddCharacterGroup(this.charId, group.name, grade))) return;

        this.#addGroup(group, grade);
      }
    }

    emit('ox:setGroup', this.source, group.name, grade ? grade : null);
    this.emit('ox:setGroup', group.name, grade ? grade : null);

    return true;
  }

  getGroup(filter: string): number;
  getGroup(filter: string[] | Record<string, number>): [string, number] | [];
  getGroup(filter: string | string[] | Record<string, number>) {
    if (typeof filter === 'string') {
      return this.#groups[filter];
    }

    if (Array.isArray(filter)) {
      for (const name of filter) {
        const grade = this.#groups[name];
        if (grade) return [name, grade];
      }
    } else if (typeof filter === 'object') {
      for (const [name, requiredGrade] of Object.entries(filter)) {
        const grade = this.#groups[name];
        if (grade && (requiredGrade as number) <= grade) {
          return [name, grade];
        }
      }
    }
  }

  getGroupByType(type: string) {
    return this.getGroup(GetGroupsByType(type));
  }

  getGroups() {
    return this.#groups;
  }

  hasPermission(permission: string): boolean {
    const matchResult = permission.match(/^group\.([^.]+)\.(.*)/);
    const groupName = matchResult?.[1];
    permission = matchResult?.[2] ?? permission;

    if (groupName) {
      const grade = this.#groups[groupName];

      if (!grade) return false;

      const permissions = GetGroupPermissions(groupName);

      for (let g = grade; g > 0; g--) {
        const value = permissions[g] && permissions[g][permission];

        if (value !== undefined) return value;
      }
    }

    return false;
  }

  setStatus(statusName: string, value = Statuses[statusName].default) {
    if (Statuses[statusName] === undefined) return;

    const newValue = value < 0 ? 0 : value > 100 ? 100 : Number.parseFloat(value.toPrecision(8));
    this.#statuses[statusName] = newValue;

    this.emit('ox:setPlayerStatus', statusName, newValue, true);

    return true;
  }

  getStatus(statusName: string) {
    return this.#statuses[statusName];
  }

  getStatuses() {
    return this.#statuses;
  }

  /** Cached body dirtiness, reported by the client and persisted on save. */
  getDirt() {
    return this.#dirt;
  }

  /** Updates the cached body dirtiness (called from the client `ox:setDirt` event). */
  setDirt(dirt: PedDirt | null) {
    this.#dirt = dirt;
  }

  /** Clears stored dirtiness and tells the client to wash the ped. For a future reset command. */
  clearDirt() {
    this.#dirt = null;
    this.emit('ox:clearDirt');
  }

  /**
   * Live entity health, replicated by the client through the `health` statebag (server-side
   * GetEntityHealth is unreliable for player peds in rdr3) and cached via the class' statebag
   * handler — null until reported.
   */
  getHealth(): number | null {
    return this.#health;
  }

  addStatus(statusName: string, value: number) {
    if (this.#statuses[statusName] === undefined) return;

    let newValue = this.#statuses[statusName] + value;
    newValue = newValue < 0 ? 0 : newValue > 100 ? 100 : Number.parseFloat(newValue.toPrecision(8));

    this.#statuses[statusName] = newValue;
    this.emit('ox:setPlayerStatus', statusName, newValue);

    return true;
  }

  removeStatus(statusName: string, value: number) {
    if (this.#statuses[statusName] === undefined) return;

    let newValue = this.#statuses[statusName] - value;
    newValue = newValue < 0 ? 0 : newValue > 100 ? 100 : Number.parseFloat(newValue.toPrecision(8));

    this.#statuses[statusName] = newValue;
    this.emit('ox:setPlayerStatus', statusName, newValue);

    return true;
  }

  getLicense(licenseName: string) {
    return this.#licenses[licenseName];
  }

  getLicenses() {
    return this.#licenses;
  }

  async addLicense(licenseName: string) {
    if (!this.charId || this.#licenses[licenseName] || !Licenses[licenseName]) return false;

    const license = {
      issued: Date.now(),
    };

    if (!(await AddCharacterLicense(this.charId, licenseName, license))) return false;

    this.#licenses[licenseName] = license;

    emit('ox:licenseAdded', this.source, licenseName);
    this.emit('ox:licenseAdded', licenseName);

    return true;
  }

  async removeLicense(licenseName: string) {
    if (!this.charId || !(await RemoveCharacterLicense(this.charId, licenseName))) return false;

    delete this.#licenses[licenseName];

    emit('ox:licenseRemoved', this.source, licenseName);
    this.emit('ox:licenseRemoved', licenseName);

    return true;
  }

  async updateLicense(licenseName: string, key: string, value: any) {
    if (!this.charId) return false;

    const license = this.#licenses[licenseName];

    if (!license || key === 'issued') return false;

    if (!(await UpdateCharacterLicense(this.charId, licenseName, key, value))) return false;

    value == null ? delete license[key] : (license[key] = value);

    return true;
  }

  #getSaveData() {
    // Re-fetch the live ped: the cached handle goes stale when the ped is recreated
    // (model change on spawn, death/respawn) and stale handles read 0 for coords.
    const ped = GetPlayerPed(this.source as string) || this.ped;
    const isDead = this.#isDead;

    return [
      ...GetEntityCoords(ped),
      GetEntityHeading(ped),
      isDead,
      // Health is replicated by the client via statebag (server-side GetEntityHealth is unreliable in rdr3).
      isDead ? 0 : this.getHealth(),
      JSON.stringify(this.#statuses || {}),
      this.#dirt ? JSON.stringify(this.#dirt) : null,
      this.charId,
    ];
  }

  #addGroup(group: string | OxGroup, grade: number) {
    const groupName = typeof group === 'string' ? group : group.name;
    group = GetGroup(groupName);

    if (!group) return console.warn(`Failed to add group '${groupName}' to OxPlayer<${this.userId}> (invalid group)`);

    addPrincipal(this.source as string, `${group.principal}:${grade}`);
    DEV: console.info(`Added OxPlayer<${this.userId}> to group '${group.name}' as grade ${grade}.`);

    this.#groups[group.name] = grade;
    GlobalState[`${group.name}:count`] += 1;
  }

  #removeGroup(group: string | OxGroup, grade: number, canRemoveActiveCount = false) {
    const groupName = typeof group === 'string' ? group : group.name;
    group = GetGroup(groupName);

    if (!group)
      return console.warn(`Failed to remove group '${groupName}' from OxPlayer<${this.userId}> (invalid group)`);

    removePrincipal(this.source as string, `${group.principal}:${grade}`);
    DEV: console.info(`Removed OxPlayer<${this.userId}> from group '${group.name}'.`);

    delete this.#groups[group.name];
    GlobalState[`${group.name}:count`] -= 1;

    if (canRemoveActiveCount && group.name === this.get('activeGroup')) {
      GlobalState[`${group.name}:activeCount`] -= 1;
      group.activePlayers.delete(+this.source);
    }
  }

  save() {
    if (!this.charId) return;

    const result = SaveCharacterData(this.#getSaveData());

    if (result && typeof (result as any).then === 'function') {
      (result as Promise<any>).catch((err) => console.error(`Failed to save OxPlayer<${this.userId}>:`, err));
    }

    return result;
  }

  async setAsJoined() {
    if (!OxPlayer.getFromUserId(this.userId)) {
      OxPlayer.add(this.source, this);
      Player(this.source).state.set('userId', this.userId, true);
    }

    DEV: console.info(`Starting character selection for OxPlayer<${this.userId}>`);

    this.emit('ox:startCharacterSelect', this.userId, await this.#getCharacters());
  }

  /** Returns an array of all characters owned by the player, excluding soft-deleted characters. */
  async #getCharacters() {
    this.#characters = await GetCharacters(this.userId);
    return this.#characters;
  }

  async logout(save = true, dropped = false) {
    if (!this.charId) return;

    for (const name in this.#groups) this.#removeGroup(name, this.#groups[name], true);

    emit('ox:playerLogout', this.source, this.userId, this.charId);

    if (save) await this.save();

    if (dropped) return;

    delete OxPlayer.keys.charId[this.charId];
    delete this.charId;

    this.emit('ox:startCharacterSelect', this.userId, await this.#getCharacters());
  }

  async #generateStateId() {
    const arr = [];

    while (true) {
      for (let i = 0; i < 2; i++) arr[i] = getRandomChar();
      for (let i = 2; i < 6; i++) arr[i] = getRandomInt();

      const stateId = arr.join('');

      if (await IsStateIdAvailable(stateId)) return stateId;
    }
  }

  async createCharacter(data: NewCharacter) {
    if (this.charId || this.#characters.length >= CHARACTER_SLOTS) return;

    const stateId = await this.#generateStateId();
    const telegramId = GenerateTelegramId();

    const character: Character = {
      firstName: data.firstName,
      lastName: data.lastName,
      stateId: stateId,
      charId: await CreateCharacter(
        this.userId,
        stateId,
        data.firstName,
        data.lastName,
        data.gender,
        data.date,
        telegramId,
      ),
      isNew: true,
      gender: data.gender,
    };

    this.#characters.push(character);
    emit('ox:createdCharacter', this.source, this.userId, character.charId);

    return this.#characters.length - 1;
  }

  #getCharacterSlotFromId(charId: number) {
    if (this.charId) return -1;

    return this.#characters.findIndex((character) => {
      return character.charId === charId;
    });
  }

  async setActiveCharacter(data: number | NewCharacter, spawn?: SpawnOverride) {
    if (this.charId) return;

    const characterSlot =
      typeof data === 'object' ? await this.createCharacter(data) : this.#getCharacterSlotFromId(data);

    if (characterSlot == null) return;

    const character = this.#characters[characterSlot];

    this.#characters.length = 0;
    this.charId = character.charId;
    this.stateId = character.stateId;
    this.ped = GetPlayerPed(this.source as string);

    const metadata = await GetCharacterMetadata(character.charId);

    if (!metadata) return;

    const statuses = metadata.statuses || this.#statuses;
    const { isDead, gender, dateOfBirth, telegramId, origin, health, dirt } = metadata;

    if (spawn) {
      character.x = spawn.x;
      character.y = spawn.y;
      character.z = spawn.z;
      character.heading = spawn.heading;
    }
    const groups = await GetCharacterGroups(this.charId);
    const licenses = await GetCharacterLicenses(this.charId);
    const activeGroup = groups.find((group) => group.isActive)?.name;

    const spawnDead = isDead === 1;
    const spawnHealth = typeof health === 'number' && health > 0 ? health : undefined;

    character.health = spawnDead ? 0 : spawnHealth;

    // Seed the health statebag with the stored value until the client replicates the live health,
    // so a crash in the first moments after load still persists the loaded value rather than null.
    Player(this.source).state.set('health', spawnDead ? null : (spawnHealth ?? null), true);
    this.#dirt = dirt || null;
    character.dirt = this.#dirt ?? undefined;

    groups.forEach(({ name, grade }) => this.#addGroup(name, grade));
    licenses.forEach(({ name, data }) => (this.#licenses[name] = data));

    for (const name in Statuses) this.setStatus(name, statuses[name]);

    this.emit('ox:setActiveCharacter', character, this.#groups);

    this.set('name', `${character.firstName} ${character.lastName}`, true);
    this.set('firstName', character.firstName, true);
    this.set('lastName', character.lastName, true);
    this.set('gender', gender, true);
    this.set('dateOfBirth', dateOfBirth, true);
    this.set('telegramId', telegramId, true);
    this.set('origin', origin ?? undefined, true);
    this.set('activeGroup', activeGroup, true);

    if (activeGroup) {
      GlobalState[`${activeGroup}:activeCount`] += 1;

      const group = GetGroup(activeGroup);
      group.activePlayers.add(+this.source);
    }

    DEV: console.info(`Restored OxPlayer<${this.userId}> previous active group: ${activeGroup}`);

    OxPlayer.keys.charId[character.charId] = this;

    /**
     * @todo Player metadata can ideally be handled with statebags, but requires security features.
     * Rejection of client-set values is a must-have.
     * "Private" states only visible to the owner would be :chefskiss:
     * https://github.com/citizenfx/fivem/pull/2257 - state bag filters
     * https://github.com/citizenfx/fivem/pull/2257 - state bag write policies
     */
    const state = Player(this.source).state;
    state.set('isDead', spawnDead, true);

    DEV: console.info(`OxPlayer<${this.userId}> loaded character ${this.get('name')} (${this.charId})`);

    emit('ox:playerLoaded', this.source, this.userId, character.charId);

    return character;
  }

  async deleteCharacter(charId: number) {
    const isActive = this.charId === charId;

    if (this.charId && !isActive) return;

    const characterSlot = isActive ? 0 : this.#getCharacterSlotFromId(charId);

    if (characterSlot === -1) return;

    if (await DeleteCharacter(charId)) {
      if (isActive) this.logout(false);
      else this.#characters.splice(characterSlot, 1);

      emit('ox:deletedCharacter', this.source, this.userId, charId);

      DEV: console.info(`Deleted character ${charId} for OxPlayer<${this.userId}>`);
      return true;
    }
  }
}

OxPlayer.init();

exports('SaveAllPlayers', (arg: any) => OxPlayer.saveAll(arg));
exports('GetPlayerFromUserId', (arg: any) => OxPlayer.getFromUserId(arg));
exports('GetPlayerFromCharId', (arg: any) => OxPlayer.getFromCharId(arg));
exports('GetPlayerFromFilter', (arg: any) => OxPlayer.getFromFilter(arg));
exports('GetPlayers', (arg: any) => OxPlayer.getAll(arg, true));
