/*
 * Copyright (c) 2024 by frostime. All Rights Reserved.
 * @Author       : frostime
 * @Date         : 2025-07-13
 * @FilePath     : /scripts/make_dev_copy.js
 * @LastEditTime : 2025-07-13
 * @Description  : Copy plugin files to SiYuan plugins directory instead of creating symbolic links
 */
import fs from 'fs';
import path from 'path';
import minimist from 'minimist';
import { log, error, getSiYuanDir, chooseTarget, getThisPluginName, copyDirectory } from './utils.js';

const args = minimist(process.argv.slice(2));
const sourceDirName = args.source || args.s || 'dev';

let targetDir = `D:\\Notes\\Siyuan\\Achuan-2\\data\\plugins`;
// let targetDir =`C:\\Users\\wangmin\\Documents\\siyuan_plugins_test\\data\\plugins`;
// let targetDir =`C:\\Users\\wangmin\\Documents\\Project Code\\notebook\\data\\plugins`;

/**
 * 1. Get the parent directory to install the plugin
 */
log('>>> Try to visit constant "targetDir" in make_dev_copy.js...');
if (targetDir === '') {
    log('>>> Constant "targetDir" is empty, try to get SiYuan directory automatically....');
    let res = await getSiYuanDir();

    if (!res || res.length === 0) {
        log('>>> Can not get SiYuan directory automatically, try to visit environment variable "SIYUAN_PLUGIN_DIR"....');
        let env = process.env?.SIYUAN_PLUGIN_DIR;
        if (env) {
            targetDir = env;
            log(`\tGot target directory from environment variable "SIYUAN_PLUGIN_DIR": ${targetDir}`);
        } else {
            error('\tCan not get SiYuan directory from environment variable "SIYUAN_PLUGIN_DIR", failed!');
            process.exit(1);
        }
    } else {
        targetDir = await chooseTarget(res);
    }

    log(`>>> Successfully got target directory: ${targetDir}`);
}
if (!fs.existsSync(targetDir)) {
    error(`Failed! Plugin directory not exists: "${targetDir}"`);
    error('Please set the plugin directory in scripts/make_dev_copy.js');
    process.exit(1);
}

/**
 * 2. The source directory, which contains the compiled plugin code
 */
const sourceDir = path.resolve(process.cwd(), sourceDirName);
if (!fs.existsSync(sourceDir)) {
    error(`Failed! Source directory not exists: "${sourceDir}"`);
    error('Please run "pnpm run build" or "pnpm run dev" first to generate the output directory');
    process.exit(1);
}

/**
 * 3. The target directory to copy source directory contents
 */
const name = getThisPluginName();
if (name === null) {
    process.exit(1);
}
const targetPath = `${targetDir}/${name}`;

/**
 * 4. Create target directory if it doesn't exist
 */
log(`>>> Ensuring target directory exists: ${targetPath}`);
if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
    log(`Created directory: ${targetPath}`);
} else {
    log(`Target directory already exists, will update files incrementally`);
}

/**
 * 5. Copy/update all contents from source directory to target directory
 * This will only update changed files instead of deleting everything
 */
copyDirectory(sourceDir, targetPath);
log(`>>> Successfully synchronized all files to SiYuan plugins directory!`);
