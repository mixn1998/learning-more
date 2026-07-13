#!/usr/bin/env node
import { migrateCommand } from './commands/migrate.js';
import { verifyCommand } from './commands/verify.js';

const [command, ...arguments_] = process.argv.slice(2);
let exitCode: number;
if (command === 'verify') exitCode = await verifyCommand(arguments_);
else if (command === 'migrate') exitCode = await migrateCommand(arguments_);
else throw new Error('maintenance_command_unknown');
process.exitCode = exitCode;
