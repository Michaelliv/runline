# Codemode

Codemode turns APIs and host capabilities into actions that code can call. An agent writes JavaScript, each configured plugin is a global in that code, and one run can call several actions and return a single value.

Use codemode to give an agent access to services such as GitHub, Slack, or Stripe without one tool per endpoint. You can run it from the command line, embed it in an application with the SDK, or add it to Pi as a tool.

## Start using codemode

New to codemode? Follow the [Quickstart](quickstart.md) to install it, add a connection, and run your first action.

If codemode is already installed, choose what you want to do:

- [Run code](usage.md) to call actions, discover them from inside a run, and read results and logs.
- [Add a connection](connections.md) to give a plugin its credentials, including OAuth logins.
- [Browse the bundled plugins](bundled-plugins.md) that ship with codemode.
- [Understand how codemode works](how-codemode-works.md), including plugins, connections, and the runtime.

## Extend codemode

- [Write a plugin](plugins.md) to add actions for an API or a host capability.
- [Declare credentials](credentials.md) so codemode signs a plugin's requests and the plugin never handles the secret.
- [Use packages](packages.md) to install plugins from npm or git, or to distribute your own.

## Embed codemode

- Use the [SDK](sdk.md) to run code, supply connections, and load plugins inside a Node.js or Bun process.
- Use [`PackageManager`](packages.md#embed-the-package-manager) to install and load packages from a host.
- Use [`pi-runline`](https://github.com/Michaelliv/pi-runline) to add it to Pi as a single tool.

## Find reference information

Coming from runline? Follow [Migrate from runline](migrating-from-runline.md).

Use the reference pages to look up [commands and options](cli.md), [files, settings, and environment variables](configuration.md), and the [credential helpers, fields, and error codes](credentials-reference.md).

## Work safely

Plugins run inside the codemode process with its permissions, and the code runtime is not a sandbox. Project trust controls which project plugins load, but it does not limit what they do afterward. Review [Security](security.md) before running untrusted code, installing third-party packages, or trusting a project.
