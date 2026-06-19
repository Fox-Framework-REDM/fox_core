import type { Character, Dict, OxStatus, CharacterLicense, OxLicense, BanDetails } from 'types';
import { CHARACTER_SLOTS } from '../../common/config';
import { db } from '../db';
import { OxPlayer } from './class';

export function GetUserIdFromIdentifier(identifier: string, offset?: number) {
  return db.column<number>('SELECT userId FROM users WHERE license2 = ? LIMIT ?, 1', [identifier, offset || 0]);
}

export function CreateUser(username: string, { license2, steam, fivem, discord }: Dict<string>) {
  return db.insert('INSERT INTO users (username, license2, steam, fivem, discord) VALUES (?, ?, ?, ?, ?)', [
    username,
    license2,
    steam,
    fivem,
    discord,
  ]);
}

export async function IsStateIdAvailable(stateId: string) {
  return !(await db.exists('SELECT 1 FROM characters WHERE stateId = ?', [stateId]));
}

export function CreateCharacter(
  userId: number,
  stateId: string,
  firstName: string,
  lastName: string,
  gender: string,
  date: number,
  telegramId?: string,
) {
  return db.insert(
    'INSERT INTO characters (userId, stateId, firstName, lastName, gender, dateOfBirth, telegramId) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userId, stateId, firstName, lastName, gender, new Date(Number(date)), telegramId],
  );
}

export function GetCharacters(userId: number) {
  return db.execute<Character>(
    'SELECT charId, stateId, firstName, lastName, gender, x, y, z, heading, DATE_FORMAT(lastPlayed, "%d/%m/%Y") AS lastPlayed FROM characters WHERE userId = ? AND deleted IS NULL LIMIT ?',
    [userId, CHARACTER_SLOTS],
  );
}

export function SaveCharacterData(values: any[] | any[][], batch?: boolean) {
  const query =
    'UPDATE characters SET x = ?, y = ?, z = ?, heading = ?, isDead = ?, lastPlayed = CURRENT_TIMESTAMP(), health = ?, statuses = ?, dirt = ? WHERE charId = ?';

  return batch ? db.batch(query, values) : db.update(query, values);
}

export async function DeleteCharacter(charId: number) {
  return (await db.update('UPDATE characters SET deleted = curdate() WHERE charId = ?', [charId])) === 1;
}

export function GetCharacterMetadata(charId: number) {
  return db.row<{
    isDead: number;
    gender: string;
    dateOfBirth: string;
    telegramId: string;
    origin: string | null;
    health: number;
    statuses: Dict<number>;
    dirt: Dict<number>;
  }>(
    'SELECT isDead, gender, DATE_FORMAT(dateOfBirth, "%d/%m/%Y") AS dateOfBirth, telegramId, origin, health, statuses, dirt FROM characters WHERE charId = ?',
    [charId],
  );
}

export function GetStatuses() {
  return db.query<OxStatus>('SELECT name, `default`, onTick FROM fox_statuses');
}

export function GetLicenses() {
  return db.query<Dict<OxLicense>>('SELECT name, label FROM fox_licenses');
}

export function GetLicense(name: string) {
  return db.row<OxLicense>('SELECT name, label FROM fox_licenses WHERE name = ?', [name]);
}

export function GetCharacterLicenses(charId: number) {
  return db.query<{ name: string; data: CharacterLicense }>(
    'SELECT name, data FROM character_licenses WHERE charId = ?',
    [charId],
  );
}

export function AddCharacterLicense(charId: number, name: string, data: CharacterLicense) {
  return db.update('INSERT INTO character_licenses (charId, name, data) VALUES (?, ?, ?)', [
    charId,
    name,
    JSON.stringify(data),
  ]);
}

export function RemoveCharacterLicense(charId: number, name: string) {
  return db.update('DELETE FROM character_licenses WHERE charId = ? AND name = ?', [charId, name]);
}

export function UpdateCharacterLicense(charId: number, name: string, key: string, value: any) {
  const params = [`$.${key}`, name, charId];

  if (value == null)
    return db.update('UPDATE character_licenses SET data = JSON_REMOVE(data, ?) WHERE name = ? AND charId = ?', params);

  params.splice(1, 0, value);

  return db.update('UPDATE character_licenses SET data = JSON_SET(data, ?, ?) WHERE name = ? AND charId = ?', params);
}

export function GetCharIdFromStateId(stateId: string) {
  return db.column<number>('SELECT charId FROM characters WHERE stateId = ?', [stateId]);
}

export async function UpdateUserTokens(userId: number, tokens: string[]) {
  if (tokens.length === 0) return;

  const parameters = tokens.map((token) => [userId, token]);

  await db.batch('INSERT IGNORE INTO user_tokens (userId, token) VALUES (?, ?)', parameters);
}

/** Stores the player's current IP (refreshed on every join) for ban-evasion matching. */
export async function UpdateUserIp(userId: number, ip?: string) {
  if (!ip) return;

  await db.update('UPDATE users SET ip = ? WHERE userId = ?', [ip, userId]);
}

/**
 * Returns an active ban affecting this player, checking three links:
 *  - a direct ban on this userId,
 *  - a shared hardware token (the reliable ban-evasion signal — same PC, different account),
 *  - a shared IP (weaker secondary signal).
 * Expired bans are pruned and ignored. A match on a different userId means ban evasion.
 */
export async function GetActiveBan(userId: number, tokens: string[], ip?: string): Promise<BanDetails | undefined> {
  const bans = await db.query<BanDetails>(
    `SELECT DISTINCT bu.userId, bu.reason, bu.banned_at, bu.unban_at
       FROM banned_users bu
       LEFT JOIN user_tokens ut ON ut.userId = bu.userId
       LEFT JOIN users u ON u.userId = bu.userId
      WHERE bu.userId = ?
         OR ut.token IN (?)
         OR (? IS NOT NULL AND u.ip = ?)`,
    [userId, tokens.length ? tokens : [''], ip ?? null, ip ?? null],
  );

  if (!bans?.length) return;

  const now = Date.now();
  const expired = bans.filter((ban) => ban.unban_at && new Date(ban.unban_at).getTime() <= now);

  if (expired.length) await db.query('DELETE FROM banned_users WHERE userId IN (?)', [expired.map((ban) => ban.userId)]);

  const active = bans.filter((ban) => !ban.unban_at || new Date(ban.unban_at).getTime() > now);

  // Prefer a direct match on this user; otherwise the match is an evasion via a linked account.
  return active.find((ban) => ban.userId === userId) ?? active[0];
}

export async function BanUser(userId: number, reason?: string, hours?: number) {
  const success = await db.update(
    'INSERT INTO banned_users (userId, banned_at, unban_at, reason) VALUES (?, NOW(), DATE_ADD(NOW(), INTERVAL ? HOUR), ?)',
    [userId, hours, reason],
  );

  if (!success) {
    console.error(`Failed to ban ${userId}`);
    return false;
  }

  const playerId = OxPlayer.getFromUserId(userId)?.source as string;

  if (playerId) {
    const banned_at = Date.now();
    const unban_at = banned_at + (hours ? hours * 60 * 60 * 1000 : 0);

    DropPlayer(playerId, OxPlayer.formatBanReason({ userId, banned_at, unban_at, reason }));
  }

  return true;
}

export async function UnbanUser(userId: number) {
  const success = await db.update('DELETE FROM banned_users WHERE userId = ?', [userId]);

  return success;
}
