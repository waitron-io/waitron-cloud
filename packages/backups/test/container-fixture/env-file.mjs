export function parseEnvFile(value){return Object.fromEntries(value.trim().split("\n").map(line=>line.split("=")))}
