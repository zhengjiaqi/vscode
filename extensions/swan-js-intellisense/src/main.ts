/**
 * @license
 *  Copyright Baidu Inc. All Rights Reserved.
 *
 *  This source code is licensed under the Apache License, Version 2.0; found in the
 *  LICENSE file in the root directory of this source tree.
 *
 * @file js代码提示
 * @author zhengjiaqi01@baidu.com
 */

import * as vscode from 'vscode';
import { SwanJsProvider } from './provider';
import { getApiInfo, getGlobalInfo } from './apiInfo';
import * as path from 'path';

export async function deactivate(): Promise<any> {

}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const sdkPath = await vscode.extHostContext.send('getSdkPath');
	const resourcePath = path.join(sdkPath, 'config')
	const apiInfo = await getApiInfo(resourcePath);
	const globalInfo = await getGlobalInfo(resourcePath);
	const provider = new SwanJsProvider(apiInfo, globalInfo);
	const LANS = ['javascript'];
    for (let lan of LANS) {
        let providerDisposable = vscode.languages.registerCompletionItemProvider(lan, provider, '.');
        context.subscriptions.push(providerDisposable);
	}

	let disposable2 = vscode.commands.registerTextEditorCommand('doc', (textEditor, edit, apiName) => {
		console.log('###apiName:', apiName)
		vscode.extHostContext.send('docs-search.show', {searchText: apiName});
	});

	let disposable3 = vscode.commands.registerTextEditorCommand('statistics', (textEditor, edit, actionName) => {
		console.log('###statistics:', actionName)
		vscode.extHostContext.send('js-intellisense-statistics', {actionName});
	});
	context.subscriptions.push(disposable3);

	context.subscriptions.push(disposable2);
}
