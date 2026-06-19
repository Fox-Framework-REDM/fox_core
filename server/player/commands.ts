import { addCommand } from '@overextended/ox_lib/server';
import { OxPlayer } from 'player/class';
import { BanUser, UnbanUser } from './db';
import locale from '../../common/locales';

// NOTE: These commands are intended for development purposes.

addCommand('logout', async (playerId) => OxPlayer.get(playerId).logout(true), {
  help: 'Logout and return to character selection.',
  restricted: 'group.admin',
});

addCommand(
  'deletechar',
  async (playerId) => {
    const player = OxPlayer.get(playerId);

    if (!player.charId) return;

    player.deleteCharacter(player.charId);
  },
  {
    help: 'Hard delete your current character (cannot be reversed).',
    restricted: 'group.admin',
  },
);

addCommand(
  'charinfo',
  async (playerId) => {
    const player = OxPlayer.get(playerId);
    console.log(`${player.get('firstName')} ${player.get('lastName')} (${player.charId}) - ${player.stateId}`);
  },
  {
    help: 'Display basic character information.',
  },
);

addCommand(
  'ban',
  async (_playerId, args: { target: number; hours?: number; reason?: string }) => {
    const target = OxPlayer.get(args.target);

    if (!target?.userId) return console.error(locale('ban_no_target', args.target));

    // hours omitted/0 -> permanent. The connect-time evasion check also blocks shared PC tokens/IP.
    await BanUser(target.userId, args.reason || locale('ban_default_reason'), args.hours || undefined);
  },
  {
    help: locale('ban_command_help'),
    params: [
      { name: 'target', type: 'playerId', help: locale('ban_param_target') },
      { name: 'hours', type: 'number', help: locale('ban_param_hours'), optional: true },
      { name: 'reason', type: 'longString', help: locale('ban_param_reason'), optional: true },
    ],
    restricted: 'group.admin',
  },
);

addCommand(
  'unban',
  async (_playerId, args: { userId: number }) => {
    await UnbanUser(args.userId);
    console.log(locale('unban_success', args.userId));
  },
  {
    help: locale('unban_command_help'),
    params: [{ name: 'userId', type: 'number', help: locale('unban_param_userid') }],
    restricted: 'group.admin',
  },
);
