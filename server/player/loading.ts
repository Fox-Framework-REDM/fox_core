import { OxPlayer } from 'player/class';
import { BanUser, CreateUser, GetActiveBan, GetUserIdFromIdentifier, UpdateUserIp, UpdateUserTokens } from './db';
import { GetIdentifiers, GetPlayerLicense } from 'utils';
import { DEBUG, SV_LAN } from '../config';
import type { Dict } from 'types';
import locales from '../../common/locales';

const connectingPlayers: Dict<OxPlayer> = {};

/** Loads existing data for the player, or inserts new data into the database. */
async function loadPlayer(playerId: number) {
  let player: OxPlayer | undefined;

  try {
    if (serverLockdown) return serverLockdown;

    player = new OxPlayer(playerId);
    const license = SV_LAN ? 'fayoum' : GetPlayerLicense(playerId);

    if (!license) return locales('no_license');

    const identifier = license.substring(license.indexOf(':') + 1);
    let userId: number;

    userId = (await GetUserIdFromIdentifier(identifier)) ?? 0;

    if (userId && OxPlayer.getFromUserId(userId)) {
      const kickReason = locales('userid_is_active', userId);

      if (!DEBUG) return kickReason;

      userId = (await GetUserIdFromIdentifier(identifier, 1)) ?? 0;
      if (userId && OxPlayer.getFromUserId(userId)) return kickReason;
    }

    player.username = GetPlayerName(player.source as string);

    // Ensure a user row exists before associating tokens/IP (FK) and running the evasion check.
    if (!userId) userId = await CreateUser(player.username, GetIdentifiers(playerId));

    player.userId = userId;
    player.identifier = identifier;

    const tokens = getPlayerTokens(playerId);
    const ip = GetPlayerEndpoint(player.source as string) || undefined;

    await UpdateUserTokens(userId, tokens);
    await UpdateUserIp(userId, ip);

    const ban = await GetActiveBan(userId, tokens, ip);

    if (ban) {
      // A match on a different account is ban evasion — also ban this identity so it reads as a
      // direct ban next time, mirroring the original ban's remaining duration (permanent stays permanent).
      if (ban.userId !== userId) {
        const hours = ban.unban_at
          ? Math.max(1, Math.ceil((new Date(ban.unban_at).getTime() - Date.now()) / 3600000))
          : undefined;

        await BanUser(userId, locales('ban_evasion_reason', ban.userId, ban.reason ?? '-'), hours);
      }

      return OxPlayer.formatBanReason(ban);
    }

    DEV: console.info(`Loaded player data for OxPlayer<${player.userId}>`);

    return player;
  } catch (err) {
    console.error('Error loading player:', err);

    if (player?.userId) {
      try {
        OxPlayer.remove(player.source);
      } catch (cleanupErr) {
        console.error('Error during cleanup:', cleanupErr);
      }
    }

    return err.message;
  }
}

let serverLockdown: string;

setInterval(() => {
  for (const tempId in connectingPlayers) {
    if (!DoesPlayerExist(tempId)) delete connectingPlayers[tempId];
  }
}, 10000);

on('txAdmin:events:serverShuttingDown', () => {
  serverLockdown = locales('server_restarting');
  OxPlayer.saveAll(serverLockdown);
});

on('playerConnecting', async (username: string, _: any, deferrals: any) => {
  const tempId = source;

  deferrals.defer();

  if (serverLockdown) return deferrals.done(serverLockdown);

  const player = await loadPlayer(tempId);

  if (!(player instanceof OxPlayer)) return deferrals.done(player || 'Failed to load player.');

  connectingPlayers[tempId] = player;

  deferrals.done();
});

on('playerJoining', async (tempId: string) => {
  if (serverLockdown) return DropPlayer(source.toString(), serverLockdown);

  const player = connectingPlayers[tempId];

  if (!player) return;

  delete connectingPlayers[tempId];
  connectingPlayers[source] = player;
  player.source = source;

  DEV: console.info(`Assigned id ${source} to OxPlayer<${player.userId}>`);
});

onNet('ox:playerJoined', async () => {
  const playerSrc = source;
  const player = connectingPlayers[playerSrc] || (await loadPlayer(playerSrc));
  delete connectingPlayers[playerSrc];

  if (!(player instanceof OxPlayer)) return DropPlayer(playerSrc.toString(), player || 'Failed to load player.');

  player.setAsJoined();
});

on('playerDropped', async () => {
  const player = OxPlayer.get(source);

  if (!player) return;

  try {
    await player.logout(true, true);
  } catch (err) {
    console.error(`Failed to log out OxPlayer<${player.userId}> on disconnect:`, err);
  }

  OxPlayer.remove(player.source);

  DEV: console.info(`Dropped OxPlayer<${player.userId}>`);
});

RegisterCommand(
  'saveplayers',
  () => {
    OxPlayer.saveAll();
  },
  true,
);
