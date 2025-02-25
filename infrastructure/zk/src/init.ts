import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import * as utils from './utils';

import * as server from './server';
import * as contract from './contract';
import * as run from './run/run';
import * as compiler from './compiler';
import * as db from './database/database';
import { clean } from './clean';
import * as env from './env';
import * as docker from './docker';
import { up } from './up';

const entry = chalk.bold.yellow;
const announce = chalk.yellow;
const success = chalk.green;
const timestamp = chalk.grey;

export async function init(skipSubmodulesCheckout: boolean = false) {
    // TODO(zidong): this is for `matterlabs/geth:latest` in the default compose
    //  file but some steps might not be necessary if we use a different DA
    //  layer
    await announced('Creating docker volumes', createVolumes());
    if (!process.env.CI) {
        await announced('Pulling images', docker.pull());
        await announced('Checking environment', checkEnv());
        await announced('Checking git hooks', env.gitHooks());
        await announced('Setting up containers', up());
    }

    if (!skipSubmodulesCheckout) {
        // TODO(zidong): this runs `git submodule update` but there's a bug that
        //    the default branch is not main / master. So it won't really update
        //    for a few repos. use `git submodule status` to check it out.
        await announced('Checkout system-contracts submodule', submoduleUpdate());
    }

    // this builds zksync-sdk-web3, reading-tool from the top-level package.json
    await announced('Compiling JS packages', run.yarn());

    // compile system contracts (L2)
    await announced('Compile l2 contracts', compiler.compileAll());

    await announced('Drop postgres db', db.drop());
    await announced('Setup postgres db', db.setup());
    await announced('Clean rocksdb', clean('db'));
    await announced('Clean backups', clean('backups'));
    await announced('Checking PLONK setup', run.plonkSetup());

    // build the L1 contracts
    await announced('Building contracts', contract.build());

    // deploy the ERC20 token to L1
    // TODO(zidong):
    //   - change ETH_CLIENT_WEB3_URL in contracts / ethereum /.env
    //   - 'dev' will deploy a few common ERC20 tokens. should change it to 'new' and specify the token we need
    //   - maybe just comment it out to avoid deploying any token at all since it's using `ethTestConfig.mnemonic`
    // await announced('Deploying localhost ERC20 tokens', run.deployERC20('dev'));

    // runs `zk server --genesis`. generates L2 genesis data and store in PSQL.
    //   see "core/bin/zksync_core/src/bin/zksync_server.rs"
    await announced('Running server genesis setup', server.genesisFromSources());

    // TODO(zidong): for many of the following steps, we need to either set
    // process.env.MNEMONIC or pass in arguments for --private - key

    await announced('Deploying L1 contracts', contract.redeployL1([]));

    // TODO(zidong): this will always silently fail
    // await announced('Initializing validator', contract.initializeValidator());

    // maps to IAllowList.sol
    // this calls contracts/ethereum/scripts/initialize-l1-allow-list.ts
    await announced('Initialize L1 allow list', contract.initializeL1AllowList());

    await announced('Deploying L2 contracts', contract.deployL2());
}

// A smaller version of `init` that "resets" the localhost environment, for which `init` was already called before.
// It does less and runs much faster.
export async function reinit() {
    await announced('Setting up containers', up());
    await announced('Compiling JS packages', run.yarn());
    await announced('Compile l2 contracts', compiler.compileAll());
    await announced('Drop postgres db', db.drop());
    await announced('Setup postgres db', db.setup());
    await announced('Clean rocksdb', clean('db'));
    await announced('Clean backups', clean('backups'));
    await announced('Building contracts', contract.build());
    await announced('Running server genesis setup', server.genesisFromSources());
    await announced('Deploying L1 contracts', contract.redeployL1([]));
    // TODO(zidong): this will always silently fail
    // await announced('Initializing validator', contract.initializeValidator());
    await announced('Initializing L1 Allow list', contract.initializeL1AllowList());
    await announced('Deploying L2 contracts', contract.deployL2());
}

// A lightweight version of `init` that sets up local databases, generates genesis and deploys precompiled contracts
export async function lightweightInit() {
    await announced('Clean rocksdb', clean('db'));
    await announced('Clean backups', clean('backups'));
    await announced('Running server genesis setup', server.genesisFromBinary());
    await announced('Deploying L1 contracts', contract.redeployL1([]));
    // TODO(zidong): this will always silently fail
    // await announced('Initializing validator', contract.initializeValidator());
    await announced('Initializing L1 Allow list', contract.initializeL1AllowList());
    await announced('Deploying L2 contracts', contract.deployL2());
}

// Wrapper that writes an announcement and completion notes for each executed task.
async function announced(fn: string, promise: Promise<void> | void) {
    const announceLine = `${entry('>')} ${announce(fn)}`;
    const separator = '-'.repeat(fn.length + 2); // 2 is the length of "> ".
    console.log(`\n` + separator); // So it's easier to see each individual step in the console.
    console.log(announceLine);

    const start = new Date().getTime();
    // The actual execution part
    await promise;

    const time = new Date().getTime() - start;
    const successLine = `${success('✔')} ${fn} done`;
    const timestampLine = timestamp(`(${time}ms)`);
    console.log(`${successLine} ${timestampLine}`);
}

function createVolumes() {
    fs.mkdirSync(`${process.env.ZKSYNC_HOME}/volumes/geth`, { recursive: true });
    fs.mkdirSync(`${process.env.ZKSYNC_HOME}/volumes/postgres`, { recursive: true });
}

async function submoduleUpdate() {
    await utils.exec('git submodule update');
}

async function checkEnv() {
    const tools = ['node', 'yarn', 'docker', 'docker-compose', 'cargo'];
    for (const tool of tools) {
        await utils.exec(`which ${tool}`);
    }
    const { stdout: version } = await utils.exec('node --version');
    // Node v14.14 is required because
    // the `fs.rmSync` function was added in v14.14.0
    if ('v14.14' >= version) {
        throw new Error('Error, node.js version 14.14.0 or higher is required');
    }
}

// the actual developer-facing commands

export const initCommand = new Command('init')
    .option('--skip-submodules-checkout')
    .description('perform zksync network initialization for development')
    .action(async (cmd: Command) => {
        await init(cmd.skipSubmodulesCheckout);
    });
export const reinitCommand = new Command('reinit')
    .description('"reinitializes" network. Runs faster than `init`, but requires `init` to be executed prior')
    .action(reinit);
export const lightweightInitCommand = new Command('lightweight-init')
    .description('perform lightweight zksync network initialization for development')
    .action(lightweightInit);
