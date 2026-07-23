#!/usr/bin/env node
import { backupCommand } from './commands/backup.js';
import { doctorCommand } from './commands/doctor.js';
import { migrateCommand } from './commands/migrate.js';
import { restoreCommand } from './commands/restore.js';
import { verifyCommand } from './commands/verify.js';

const [command, ...arguments_] = process.argv.slice(2);
let exitCode: number;
if (command === 'backup') exitCode = await backupCommand(arguments_);
else if (command === 'doctor') exitCode = await doctorCommand(arguments_);
else if (command === 'restore') exitCode = await restoreCommand(arguments_);
else if (command === 'verify') exitCode = await verifyCommand(arguments_);
else if (command === 'migrate') exitCode = await migrateCommand(arguments_);
else throw new Error('maintenance_command_unknown');
process.exitCode = exitCode;
