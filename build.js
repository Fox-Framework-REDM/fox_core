//@ts-check

import { createBuilder, createFxmanifest } from "@overextended/fx-utils";
import { spawn } from "child_process";

const watch = process.argv.includes("--watch");

function exec(command) {
  return new Promise((resolve) => {
    const child = spawn(command, { stdio: "inherit", shell: true });

    child.on("exit", (code) => {
      resolve(code === 0);
    });
  });
}

if (!watch) {
  const tsc = await exec(`tsc --build ${watch ? "--watch --preserveWatchOutput" : ""} && tsc-alias`);

  if (!tsc) process.exit(0);
}

createBuilder(
  watch,
  {
    dropLabels: !watch ? ["DEV"] : undefined,
  },
  [
    {
      name: "server",
      options: {
        platform: "node",
        target: ["node22"],
        format: "cjs",
        // ClassInterface derives its exports from `this.name` (e.g. GetPlayerCalls).
        // Without keepNames, esbuild renames the class to `_OxPlayer`, so `.name`
        // becomes "_OxPlayer" -> exports register as Get_PlayerCalls and break the
        // @fox_core/lib bridge. keepNames preserves the original class name.
        keepNames: true,
        entryPoints: [`./server/index.ts`],
      },
    },
    {
      name: "client",
      options: {
        platform: "browser",
        target: ["es2023"],
        format: "iife",
        keepNames: true,
        entryPoints: [`./client/index.ts`],
      },
    },
  ],
  async (files) => {
    await createFxmanifest({
      client_scripts: [files.client],
      server_scripts: [files.server],
      files: ["lib/init.lua", "lib/client/**.lua", "locales/*.json", "common/data/*.json"],
      dependencies: ["/server:12913", "/onesync"],
      metadata: {
        node_version: "22",
        // RedM target
        game: "rdr3",
        name: "fox_core",
        author: "Overextended (RedM port)",
        description: "fox_core - ox_core framework ported to RedM (rdr3).",
        rdr3_warning:
          "I acknowledge that this is a prerelease build of RedM, and I am aware my resources *will* become incompatible once RedM ships.",
      },
    });
  },
);
