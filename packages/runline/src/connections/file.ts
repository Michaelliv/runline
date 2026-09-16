import { resolve } from "node:path";
import { applyEnvOverrides } from "../config/loader.js";
import {
  type ConnectionFile,
  readConnectionFile,
  updateConnectionFile,
} from "../config/store.js";
import type { ConnectionConfig } from "../plugin/types.js";
import {
  type ConnectionHandle,
  type ConnectionProvider,
  type ConnectionRequest,
  connectionPatch,
} from "./types.js";

/**
 * Explicit CLI adapter for a config file. The absolute path is captured at
 * construction; environment hints fill missing values only on this adapter.
 * Runtime and config-management writes share a renewable file-wide lock.
 * Manual file editors are not coordinated. This is plaintext local storage
 * (writes use 0600), not an encrypted vault or a distributed credential broker.
 */
export class FileConnectionProvider implements ConnectionProvider {
  readonly path: string;

  constructor(path: string) {
    this.path = resolve(path);
  }

  async resolve(request: ConnectionRequest): Promise<ConnectionHandle> {
    const plugin = request.plugin;
    const schema = structuredClone(request.schema);
    const connection = readConnectionFile(this.path).connections.find(
      (entry) => entry.plugin === plugin,
    );
    const name = connection?.name ?? plugin;
    const generation = connection?.generation;
    const hydrate = (entry: ConnectionConfig) =>
      applyEnvOverrides(structuredClone(entry), schema);
    const find = (data: ConnectionFile) =>
      data.connections.find(
        (entry) =>
          entry.name === name &&
          entry.plugin === plugin &&
          entry.generation === generation,
      );
    const missing = () => new Error(`Connection not found: ${name}`);
    return {
      read: async () => {
        // A credential-free binding never attaches to an account created later.
        if (!connection) return hydrate({ name, plugin, config: {} });
        const current = find(readConnectionFile(this.path));
        if (!current) throw missing();
        return hydrate(current);
      },
      update: async (change) => {
        if (!connection) throw missing();
        return updateConnectionFile(this.path, async (data) => {
          const current = find(data);
          if (!current) throw missing();
          const patch = await connectionPatch(change, hydrate(current).config);
          if (patch !== undefined)
            current.config = { ...current.config, ...patch };
          return { result: hydrate(current), write: patch !== undefined };
        });
      },
    };
  }
}
