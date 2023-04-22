import { Command } from 'commander';
import * as utils from './utils';

export async function compileTestContracts() {
    await utils.spawn('yarn --cwd etc/contracts-test-data hardhat compile');
    await utils.spawn('yarn --cwd core/tests/ts-integration/contracts hardhat compile');
}

export async function compileSystemContracts() {
    await utils.spawn('yarn --cwd etc/ERC20 hardhat compile');

    process.chdir('etc/system-contracts');
    await utils.spawn('yarn');
    await utils.spawn('yarn hardhat compile');

    // build bootloader files (etc/system-contracts/scripts/process.ts) using
    //  the etc/system-contracts/bootloader/bootloader.yul template. output in
    //  folder bootloader/build
    await utils.spawn('yarn preprocess');

    // compile .yul files in etc/system-contracts/bootloader to .zbin files
    //   usinig https://github.com/matter-labs/zksolc-bin
    await utils.spawn('yarn hardhat run ./scripts/compile-yul.ts');

    process.chdir('../..');
}

export async function compileAll() {
    await compileSystemContracts();
    await compileTestContracts();
}

export const command = new Command('compiler').description('compile contract');

command.command('all').description('').action(compileAll);
command.command('system-contracts').description('').action(compileSystemContracts);
command.command('test-contracts').description('').action(compileTestContracts);
