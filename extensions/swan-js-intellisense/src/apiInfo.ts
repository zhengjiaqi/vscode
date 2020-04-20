/**
 * @license
 *  Copyright Baidu Inc. All Rights Reserved.
 *
 *  This source code is licensed under the Apache License, Version 2.0; found in the
 *  LICENSE file in the root directory of this source tree.
 *
 * @file js代码提示信息
 * @author zhengjiaqi01@baidu.com
 */

import * as path from 'path';
import * as fs from 'fs-extra';

/**
 * 获取apiInfo
 *
 */
export async function getApiInfo(resourcePath: string) {
    const apiInfo = await fs.readJson(path.join(resourcePath, 'api.json'));
	return apiInfo;
}

/**
 * 获取apiInfo
 *
 */
export async function getGlobalInfo(resourcePath: string) {
    const globalInfo = await fs.readJson(path.join(resourcePath, 'global.json'));
	return globalInfo;
}
