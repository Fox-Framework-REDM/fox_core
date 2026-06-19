# fox_core

`fox_core` is a RedM (`rdr3`) port of the original [`ox_core`](https://github.com/overextended/ox_core) framework by [Overextended](https://github.com/overextended).

It keeps the core ideas and public API style of `ox_core`, while adapting the runtime, natives, player flow, and world concepts for Red Dead Redemption 2 / RedM.

## About

`fox_core` provides the foundation for a modern RedM server:

- Player and character management
- Groups and accounts
- Persistent player state
- RedM-safe spawning and death flow
- Horses, wagons, carts, boats, and other RDR3 vehicle-like entities
- Shared Lua and TypeScript exports for other resources
- Integration with `ox_lib` and `oxmysql`

The resource name is `fox_core`, not `ox_core`. When following upstream `ox_core` documentation, replace references such as `exports.ox_core` or `@ox_core` with `exports.fox_core` or `@fox_core` where applicable.

## RedM Port Notes

This project targets RedM only:

- `fxmanifest.lua` uses `game 'rdr3'`
- GTA V-only concepts such as cars, armour, license plates, phone numbers, and GTA death screens are not used
- RDR3 natives must be validated before use
- Horses are handled as peds/mounts, while wagons, carts, and boats use RDR3 vehicle handling
- Telegram IDs replace phone numbers for character contact identity

## Original Project

`fox_core` is based on:

- Original framework: [`overextended/ox_core`](https://github.com/overextended/ox_core)
- Original documentation: [overextended.dev/ox_core](https://overextended.dev/ox_core)
- Original maintainers: [Overextended](https://github.com/overextended)

Most framework concepts come from `ox_core`; this fork exists to make those ideas work cleanly in a RedM environment.

## Links

- [ox_core documentation](https://overextended.dev/ox_core)
- [ox_lib documentation](https://overextended.dev/ox_lib)
- [oxmysql documentation](https://overextended.dev/oxmysql)
- [FiveM / RedM documentation](https://docs.fivem.net/)
- [RDR3 natives reference](https://rdr3natives.com/)

## Development

Install dependencies and build from the resource directory:

```sh
cd server-data/resources/[fox]/fox_core
bun install
bun run build
```

The build outputs:

- `dist/client.js`
- `dist/server.js`
- generated `fxmanifest.lua`

Always confirm the files in `dist/` were regenerated after building.

## Third-party Resources

When releasing resources for this framework, do not use the `ox` prefix. That prefix belongs to Overextended resources and can cause confusion or naming conflicts.

Use a project-specific prefix such as `fox_` for companion resources.

## License

`fox_core` is licensed under `GPL-3.0-or-later`.

The original `ox_core` project is licensed by Overextended under `LGPL-3.0-or-later`. This RedM port preserves attribution to the original project while using the license declared in this repository.
