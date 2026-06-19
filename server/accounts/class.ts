import { ClassInterface } from 'classInterface';
import { OxPlayer } from 'player/class';
import { GetCharIdFromStateId } from 'player/db';
import type { Dict, OxAccountMetadata, OxAccountRole, OxAccountPermissions, OxCreateInvoice } from 'types';
import {
  SelectAccount,
  UpdateBalance,
  PerformTransaction,
  DepositMoney,
  WithdrawMoney,
  DepositGold,
  WithdrawGold,
  DeleteAccount,
  SelectAccountRole,
  UpdateAccountAccess,
  SetAccountType,
  CreateInvoice,
} from './db';
import { CanPerformAction } from './roles';

interface UpdateAccountBalance {
  amount: number;
  message?: string;
}

interface RemoveAccountBalance extends UpdateAccountBalance {
  overdraw?: boolean;
}

interface TransferAccountBalance {
  toId: number;
  amount: number;
  overdraw?: boolean;
  message?: string;
  note?: string;
  actorId?: number;
}

export class OxAccount extends ClassInterface {
  protected static members: Dict<OxAccount> = {};

  static async get(accountId: number) {
    if (accountId in this.members) this.members[accountId];

    const validAccount = await SelectAccount(accountId);

    if (!validAccount) throw new Error(`No account exists with accountId ${accountId}.`);

    return new OxAccount(accountId);
  }

  static getAll() {
    return this.members;
  }

  constructor(public accountId: number) {
    super();
    OxAccount.add(accountId, this);
  }

  async get<T extends keyof OxAccountMetadata>(key: T): Promise<OxAccountMetadata[T]>;
  async get<T extends keyof OxAccountMetadata>(keys: T[]): Promise<Pick<OxAccountMetadata, T>>;
  async get<T extends keyof OxAccountMetadata>(
    keys: T | T[],
  ): Promise<OxAccountMetadata[T] | Pick<OxAccountMetadata, T> | null> {
    const metadata = await SelectAccount(this.accountId);

    if (!metadata) return null;

    if (Array.isArray(keys))
      return keys.reduce(
        (acc, key) => {
          acc[key] = metadata[key];
          return acc;
        },
        {} as Pick<OxAccountMetadata, T>,
      );

    return metadata[keys];
  }

  async addBalance({ amount, message }: UpdateAccountBalance) {
    return UpdateBalance(this.accountId, amount, 'add', false, message);
  }

  async removeBalance({ amount, overdraw = false, message }: RemoveAccountBalance) {
    return UpdateBalance(this.accountId, amount, 'remove', overdraw, message);
  }

  async transferBalance({ toId, amount, overdraw = false, message, note, actorId }: TransferAccountBalance) {
    return PerformTransaction(this.accountId, toId, amount, overdraw, message, note, actorId);
  }

  async depositMoney(playerId: number, amount: number, message?: string, note?: string) {
    return DepositMoney(playerId, this.accountId, amount, message, note);
  }

  async withdrawMoney(playerId: number, amount: number, message?: string, note?: string) {
    return WithdrawMoney(playerId, this.accountId, amount, message, note);
  }

  async depositGold(playerId: number, amount: number, message?: string, note?: string) {
    return DepositGold(playerId, this.accountId, amount, message, note);
  }

  async withdrawGold(playerId: number, amount: number, message?: string, note?: string) {
    return WithdrawGold(playerId, this.accountId, amount, message, note);
  }

  async deleteAccount() {
    return DeleteAccount(this.accountId);
  }

  async getCharacterRole(id: number | string) {
    const charId = typeof id === 'string' ? await GetCharIdFromStateId(id) : id;
    return charId ? SelectAccountRole(this.accountId, charId) : null;
  }

  async setCharacterRole(id: number | string, role?: OxAccountRole) {
    const charId = typeof id === 'string' ? await GetCharIdFromStateId(id) : id;
    return charId && UpdateAccountAccess(this.accountId, charId, role);
  }

  async playerHasPermission(playerId: number, permission: keyof OxAccountPermissions) {
    const player = OxPlayer.get(playerId);

    if (!player?.charId) return false;

    const role = await this.getCharacterRole(player.charId);
    return await CanPerformAction(player, this.accountId, role, permission);
  }

  async setShared() {
    return SetAccountType(this.accountId, 'shared');
  }

  async createInvoice(data: Omit<OxCreateInvoice, 'fromAccount'>) {
    const invoice = {
      fromAccount: this.accountId,
      ...data,
    };

    return await CreateInvoice(invoice);
  }
}

OxAccount.init();
