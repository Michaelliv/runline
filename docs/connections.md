# Connections

A connection gives a plugin the configuration it runs with: an API key, a token, a host name, or the result of an OAuth login. Codemode resolves a plugin's connection each time one of its actions is called.

Use this page to add and manage connections from the command line. A host that stores connections itself supplies them through the SDK. See [Supply connections](sdk.md#supply-connections).

## Add a connection

Name the connection, choose its plugin, and set its values:

```bash
codemode connection add gh --plugin github --set token=$GITHUB_TOKEN
```

Repeat `--set` or `-s` for each value. Values are stored as strings. The field names come from the plugin's connection schema. See [Bundled Plugins](bundled-plugins.md) for the required fields of each bundled plugin.

Adding a connection with an existing name replaces it. A bundled plugin that needs no configuration still needs a connection before `codemode exec` loads it:

```bash
codemode connection add node --plugin node
```

## Use environment variables

A plugin can name an environment variable for each field. Codemode reads the variable when the connection does not set that field, so the secret can stay out of `config.json`:

```bash
export GITHUB_TOKEN=ghp_example
codemode connection add gh --plugin github
```

A value stored in the connection takes precedence over the environment. Only the command-line interface and `FileConnectionProvider` read environment variables. Connections passed to the SDK in memory do not.

## Log in with OAuth

Plugins that declare an OAuth configuration are connected with `codemode auth`. It opens the provider's consent page, receives the redirect on a local port, exchanges the code, and saves the tokens as a connection:

```bash
codemode auth gmail
```

| Option | Behavior |
|---|---|
| `-n`, `--name <name>` | Names the connection. The default is the plugin name |
| `--client-id <id>` | Supplies the OAuth client ID |
| `--client-secret <secret>` | Supplies the OAuth client secret |

Codemode takes the client ID and secret from the options, then from the environment variables the plugin names, then from a client ID the plugin publishes. It prompts for whatever is still missing and first prints the plugin's setup instructions.

Register this redirect URI with the provider unless the plugin's instructions name another:

```text
http://127.0.0.1:47823/callback
```

Set `CODEMODE_OAUTH_CALLBACK_PORT` to change the port. Codemode renews the access token when it expires or is rejected and stores the renewal in the connection. When the provider revokes the grant, run `codemode auth` again.

## List and remove connections

List the stored connections, or remove one by name:

```bash
codemode connection list
codemode connection remove gh
```

`codemode connection list --json` includes each connection's field names with their values redacted.

## Understand how a connection is chosen

Codemode uses one connection per plugin. When several connections name the same plugin, it prefers one made for the plugin's source and otherwise takes the first in the file.

Each connection records the source of the plugin it was made for as its `owner`: `builtin`, `local`, or a package identity. A plugin from a package uses only connections made for that package, so a package cannot take over credentials by declaring another plugin's name. See [Understand names and connections](packages.md#understand-names-and-connections).

## Understand where secrets are stored

The command-line interface stores connections in the `config.json` of the nearest `.codemode` folder, as plain text in a file readable only by your account. It is not an encrypted store.

- Keep `.codemode/config.json` out of version control when it holds secrets, or keep the secrets in environment variables.
- Prefer narrowly scoped, short-lived credentials.
- A plugin that declares its credential can send it only to the HTTPS targets it declared. See [Credentials](credentials.md).

Code run with `codemode exec` does not receive connections or the host environment, but it is not sandboxed. See [Security](security.md).
