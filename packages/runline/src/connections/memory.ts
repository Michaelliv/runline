import type { ConnectionConfig } from "../plugin/types.js";
import {
  type ConnectionHandle,
  type ConnectionProvider,
  type ConnectionRequest,
  connectionPatch,
} from "./types.js";

/**
 * Process-local storage. Share this instance across engines to share credentials
 * and update ownership. It neither reads environment variables nor touches disk.
 */
export class MemoryConnectionProvider implements ConnectionProvider {
  private readonly connections = new Map<string, ConnectionConfig>();
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(connections: ConnectionConfig[] = []) {
    this.add(connections);
  }

  /** Add new identities, never overwrite a credential during an in-flight refresh. */
  add(connections: ConnectionConfig[]): void {
    const names = new Set(this.connections.keys());
    for (const connection of connections) {
      if (names.has(connection.name))
        throw new Error(`Duplicate connection: ${connection.name}`);
      names.add(connection.name);
    }
    const copies = structuredClone(connections);
    for (const connection of copies)
      this.connections.set(connection.name, connection);
  }

  list(): ConnectionConfig[] {
    return structuredClone([...this.connections.values()]);
  }

  async resolve(request: ConnectionRequest): Promise<ConnectionHandle> {
    let connection = [...this.connections.values()].find(
      (value) => value.plugin === request.plugin,
    );
    if (!connection) {
      // Credential-free plugins also have a mutable, process-local connection.
      let name = request.plugin;
      while (this.connections.has(name)) name = `_${name}`;
      connection = { name, plugin: request.plugin, config: {} };
      this.connections.set(name, connection);
    }
    const name = connection.name;
    const read = () => {
      const current = this.connections.get(name);
      if (!current) throw new Error(`Connection not found: ${name}`);
      return structuredClone(current);
    };
    return {
      read: async () => read(),
      update: async (change) => {
        const previous = this.pending.get(name) ?? Promise.resolve();
        const work = previous
          .catch(() => {})
          .then(async () => {
            const current = read();
            const patch = await connectionPatch(change, current.config);
            if (patch !== undefined) {
              current.config = { ...current.config, ...patch };
              this.connections.set(name, current);
            }
            return structuredClone(current);
          });
        this.pending.set(name, work);
        try {
          return await work;
        } finally {
          if (this.pending.get(name) === work) this.pending.delete(name);
        }
      },
    };
  }
}
