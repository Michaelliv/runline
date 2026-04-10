import chalk from "chalk";

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printSuccess(msg: string): void {
  console.log(chalk.green("✓"), msg);
}

export function printError(msg: string): void {
  console.error(chalk.red("✗"), msg);
}

export function printWarn(msg: string): void {
  console.warn(chalk.yellow("⚠"), msg);
}
