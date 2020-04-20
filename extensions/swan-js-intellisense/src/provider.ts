/**
 * @license
 *  Copyright Baidu Inc. All Rights Reserved.
 *
 *  This source code is licensed under the Apache License, Version 2.0; found in the
 *  LICENSE file in the root directory of this source tree.
 *
 * @file js代码提示 provider
 * @author zhengjiaqi01@baidu.com
 */

import * as vscode from 'vscode';

export interface apiInfo {
	// 命名空间类型 可选值[object, string]
	type: string,
	// 命名空间名称
	name: string,
	// 命名空间下api数组
	members: Array<member>
}

export interface member {
	// api类型 可选值[function]
	type: string,
	// api名称
	name: string,
	// api描述信息
	description: string,
	// api参数列表
	params: Array<param>
}

export interface param {
	// api参数类型 可选值[object，string, boolean]
	type: string,
	// api参数名称
	name: string,
	// api参数成员列表
	members: Array<paramMember>,
}

export interface paramMember {
	// api参数成员名称
	name: string,
	// api参数成员类型 可选值[string，color-string，function，array，number，boolean]
	type: string,
	// api参数成员是否必要值
	necessary: boolean,
	// api参数成员描述信息
	detail: string,
	description?: string
}

export interface options {
	// 是否过滤必要属性(只提示必要属性)
	isfilterNecessary?: boolean,
	// 是否展开花括号(包括对象与函数)
	isExpandBracket?: boolean,
	// 是否添加注释信息
	showComment?: boolean,
	// 注释信息前是否空行
	lineBeforeComment?: boolean,
	// 是否使用箭头函数
	noArrows?: boolean,
	// 是否不使用占位光标
	noPlaceholder?: boolean
}

const NAMESPACE_REG = /\s*?([\w.]+?)\.(\w*?)$/;

/**
 * 创建Object属性补全内容块
 *
 * @param {string} members - Object参数属性
 * @param {Object} options - 设置选项
 * @param {boolean} options.noPlaceholder - 是否不使用占位光标
 * @param {boolean} options.isExpandBracket - 是否展开花括号(包括对象与函数)
 * @param {boolean} options.showComment - 是否添加注释信息
 * @param {boolean} options.lineBeforeComment - 注释信息前是否空行
 * @param {boolean} options.noArrows - 是否使用箭头函数
 * @return {string} string - Object属性补全内容块
 */
function buildObjectPropertyChunk(members: Array<paramMember>, options: options) {
    const {
        noPlaceholder = false,
        isExpandBracket = false,
        showComment = false,
        lineBeforeComment = false,
        noArrows = false
	} = options;
	console.log('###members:', members);
    let res = members.reduce((origin, currentValue, currentIndex, array) => {
        const type = currentValue.type;
        const name = currentValue.name;
        let isEnd = currentIndex === array.length - 1;
        let isFirst = currentIndex === 0;
        let end = isEnd ? '' : ',\n';
        const placeholder = isFirst && !noPlaceholder ? '$0' : '';
        let propertyChunk = '';
        let comment = '';
        let noColon = false;
        if (showComment) {
            const description = currentValue.detail || currentValue.description;
            comment = `${lineBeforeComment ? '\n' : ''}\t// ${description}\n`;
        }
        switch (type) {
            case 'string':
                propertyChunk = `'${placeholder}'`;
                break;
            case 'object':
                if (isExpandBracket) {
                    propertyChunk = `{\n\t\t${placeholder}\n\t}`;
                }
                else {
                    propertyChunk = `{${placeholder}}`;
                }
                break;
            case 'function':
                if (noArrows) {
                    noColon = true;
                    if (isExpandBracket) {
                        propertyChunk = `(res${placeholder}) {\n\n\t}`;
                    }
                    else {
                        propertyChunk = `(res${placeholder}) {}`;
                    }
                }
                else if (isExpandBracket) {
                    propertyChunk = `res${placeholder} => {\n\n\t}`;
                }
                else {
                    propertyChunk = `res${placeholder} => {}`;
                }
                break;
            case 'array':
                propertyChunk = `[${placeholder}]`;
                break;
            case 'color-string':
                propertyChunk = `'#${placeholder}'`;
                break;
            case 'number':
                propertyChunk = `0${placeholder}`;
                break;
            case 'boolean':
                propertyChunk = `false${placeholder}`;
                break;
            default:
                propertyChunk = `'${placeholder}'`;
        }
        return `${origin}${comment}\t${name}${noColon ? '' : ': '}${propertyChunk}${end}`;
    }, '');

    if (!res) {
        res = '\t$0';
    }

    return res;
}

/**
 * 创建Object参数补全文本
 *
 * @param {string} paramInfo -api方法Object参数对象
 * @param {Object} options - 设置选项
 * @param {boolean} options.isfilterNecessary - 是否过滤必要属性(只提示必要属性）
 * @param {boolean} options.noPlaceholder - 是否不使用占位光标
 * @param {boolean} options.isExpandBracket - 是否展开花括号(包括对象与函数)
 * @param {boolean} options.showComment - 是否添加注释信息
 * @return {string} string - Object参数补全文本
 */
function buildApiParamsCompletion(paramInfo: param, options: options) {
    const isfilterNecessary = options.isfilterNecessary || false;
    let members = paramInfo.members;
    if (isfilterNecessary) {
        members = members.filter(o => o.necessary);
    }
    let objectPropertyChunk = buildObjectPropertyChunk(members, options);

    let res = `{\n${objectPropertyChunk}\n}`;

    return res;
}

/**
 * 创建api参数提示
 *
 * @param {Object} paramInfo - api方法参数对象
 * @param {Object} options - 设置选项
 * @return {string} apiParam - api方法参数提示文本
 */
function buildApiParam(paramInfo: param, options: options) {
    if (paramInfo.type === 'object'
    && paramInfo.members
    && paramInfo.members instanceof Array) {
        return buildApiParamsCompletion(paramInfo, options);
    }
    return paramInfo.name;
}

/**
 * 创建api参数补全内容块
 *
 * @param {string} paramList - api参数补全内容列表
 * @return {string} string - api参数补全内容块
 */
function buildApiParams(paramList:Array<string>) {
    let params = '';
    params = paramList.reduce((origin, currentValue, currentIndex, array) => {
        let isEnd = currentIndex === array.length - 1;
        let end = isEnd ? '' : ', ';
        return `${origin}${currentValue}${end}`;
    }, '');
    return params;
}

/**
 * 创建api提示文本
 *
 * @param {Object} info - api方法对象
 * @param {string} namespace - api命名空间(代码片段需要补全命名空间)
 * @param {Object} options - 设置选项
 * @param {boolean} options.isfilterNecessary - 是否过滤必要属性(只提示必要属性)
 * @param {boolean} options.isExpandBracket - 是否展开花括号(包括对象与函数)
 * @param {boolean} options.showComment - 是否添加注释信息
 * @return {string} insertText - api提示文本
 */
function buildApiInsertText(info: member, namespace = '', options: options) {
    if (info.type !== 'function') {
        return `${namespace ? namespace + '.' : ''}${info.name}`;
    }
    let functionName = info.name;
    let paramList:Array<string> = [];
    let noPlaceholder = false;
    info.params.forEach(paramInfo => {
        paramList.push(buildApiParam(paramInfo, {...options, noPlaceholder}));
        // 当有多个object类型参数时不使用占位光标
        if (paramInfo.type === 'object') {
            noPlaceholder = true;
        }
    });
    let params = buildApiParams(paramList);
    let insertText = `${namespace ? namespace + '.' : ''}${functionName}(${params});`;
    return insertText;
}

/**
 * 创建api提示
 *
 * @param {string} namespace - api命名空间
 * @param {string} input - 输入字符
 * @param {Array} apiInfo - api信息列表
 * @return {Array} suggestions - api提示列表
 */
const buildApiSuggestions = (namespace: string, input: string, apiInfo: Array<apiInfo>): Array<vscode.CompletionItem> => {
    // 重名命名空间members合并
    const namespaceInfo = apiInfo.filter(x => x.name === namespace).reduce(
        (origin: apiInfo | null, currentValue) => {
            if (!origin) {
                return {...currentValue};
            }
            if (origin.members && origin.members instanceof Array) {
                origin.members = origin.members.concat(currentValue.members || []);
            }
            else {
                origin.members = currentValue.members || [];
            }
            if (currentValue.type === 'object') {
                origin.type = currentValue.type;
            }
            return origin;
        }, null);

    if (namespaceInfo && namespaceInfo.type === 'object' && namespaceInfo.members) {
        return namespaceInfo.members
            .filter(info => {
                return (new RegExp(input)).test(info.name);
            })
            .map(info => {
                const args = [info.name];
				const commandUri = vscode.Uri.parse(
					`command:doc?${encodeURIComponent(JSON.stringify(args))}`
				);
				const completionItem = new vscode.CompletionItem(info.name, vscode.CompletionItemKind.Property);
				completionItem.command = {
					command: 'statistics',
					title: 'jsApiSuggestions',
					arguments: ['jsApiSuggestions']
				};
				completionItem.sortText = '&';
				completionItem.insertText = buildApiInsertText(info, '', {
					isfilterNecessary: true
				});
				const contents = new vscode.MarkdownString(`[查看文档](${commandUri})  \n\n${info.description}`);
				contents.isTrusted = true;
				completionItem.documentation = contents;
				completionItem.detail = info.type === 'function' ? 'function' : 'Keyword';
				return completionItem;
            });
    }
    return [];
};

/**
 * 创建api命名空间提示
 *
 * @param {Array} apiInfo - api信息列表
 * @return {Array} suggestions - api命名空间提示列表
 */
function buildNamespaceSuggestions(apiInfo: Array<apiInfo>): Array<vscode.CompletionItem> {
    let suggestions: Array<vscode.CompletionItem> = [];
    let keyMap: {[key: string]: string} = {};
    apiInfo.forEach(apiInfoItem => {
		let name = apiInfoItem.name;
        if (!keyMap[name]) {
			const completionItem = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
			completionItem.command = {
				command: 'statistics',
				title: 'jsNamespaceSuggestions',
				arguments: ['jsNamespaceSuggestions']
			};
			completionItem.sortText = '&';
			completionItem.insertText = name;
			completionItem.documentation = name;
			completionItem.detail = 'Keyword';
			suggestions.push(completionItem);
            keyMap[name] = name;
        }
	});
    return suggestions;
}

/**
 * 创建api子命名空间提示
 *
 * @param {string} namespace - 触发提示的命名空间
 * @param {string} input - 输入值
 * @param {Array} apiInfo - api信息列表
 * @return {Array} suggestions - api子命名空间提示
 */
function buildSubNamespaceSuggestions(namespace: string, input: string, apiInfo: Array<apiInfo>): Array<vscode.CompletionItem> {
    let suggestions: Array<vscode.CompletionItem> = [];
    apiInfo.forEach(apiInfoItem => {
        let apiNamespace = apiInfoItem.name;
        const matchRes = apiNamespace.match(NAMESPACE_REG);
        if (matchRes && matchRes.length > 2) {
            const preNamespace = matchRes[1];
            const subNamespace = matchRes[2];
            if (namespace === preNamespace && (new RegExp(input)).test(subNamespace)) {
				const completionItem = new vscode.CompletionItem(subNamespace, vscode.CompletionItemKind.Keyword);
				completionItem.command = {
					command: 'statistics',
					title: 'jsSubNamespaceSuggestions',
					arguments: ['jsSubNamespaceSuggestions']
				};
				completionItem.sortText = '&';
				completionItem.insertText = subNamespace;
				completionItem.documentation = subNamespace;
				completionItem.detail = 'Keyword';
				suggestions.push(completionItem);
            }
        }
    });
    return suggestions;
}

/**
 * 创建api代码片段提示
 *
 * @param {Array} apiInfo - api信息列表
 * @return {Array} suggestions - api代码片段提示列表
 */
function buildSnippetSuggestions(apiInfo: Array<apiInfo>): Array<vscode.CompletionItem> {
    let suggestions: Array<vscode.CompletionItem> = [];
    apiInfo.forEach(apiInfoItem => {
        const namespace = apiInfoItem.name;
        const apiMembers = apiInfoItem.members;
        if (!apiMembers) {
            return [];
        }
        apiMembers.forEach(info => {
			const args = [info.name];
			const commandUri = vscode.Uri.parse(
				`command:doc?${encodeURIComponent(JSON.stringify(args))}`
			);
			const completionItem = new vscode.CompletionItem(info.name, vscode.CompletionItemKind.Snippet);
			completionItem.command = {
				command: 'statistics',
				title: 'jsApiSnippetSuggestions',
				arguments: ['jsApiSnippetSuggestions']
			};
			completionItem.sortText = '1';
			completionItem.insertText = buildApiInsertText(info, namespace, {
				isfilterNecessary: false,
				isExpandBracket: false,
				showComment: true
			})
			const contents = new vscode.MarkdownString(`[查看文档](${commandUri})  \n\n${info.description}`);
			contents.isTrusted = true;
			completionItem.documentation = contents;
			completionItem.detail = 'Snippet';
			suggestions.push(completionItem);
		});
		return;
	});
	console.log('###buildSnippetSuggestions:', suggestions)
    return suggestions;
}

/**
 * 创建global api代码片段提示
 *
 * @param {Array} globalInfo - api信息列表
 * @return {Array} suggestions - api代码片段提示列表
 */
function buildGlobalSnippetSuggestions(globalInfo: Array<member>) {
    let suggestions: Array<vscode.CompletionItem> = [];
    globalInfo.forEach(apiInfoItem => {
		const args = [apiInfoItem.name];
		const commandUri = vscode.Uri.parse(
			`command:doc?${encodeURIComponent(JSON.stringify(args))}`
		);
		const completionItem = new vscode.CompletionItem(apiInfoItem.name, vscode.CompletionItemKind.Snippet);
		completionItem.command = {
			command: 'statistics',
			title: 'jsGlobalSnippetSuggestions',
			arguments: ['jsGlobalSnippetSuggestions']
		};
		completionItem.sortText = '&';
		completionItem.insertText = buildApiInsertText(apiInfoItem, '', {
			isfilterNecessary: false,
			isExpandBracket: true,
			showComment: true,
			lineBeforeComment: true,
			noArrows: true
		})
		const contents = new vscode.MarkdownString(`[查看文档](${commandUri})  \n\n${apiInfoItem.description}`);
		contents.isTrusted = true;
		completionItem.documentation = contents;
		completionItem.detail = 'Snippet';
		suggestions.push(completionItem);
    });
    return suggestions;
}


export class SwanJsProvider implements vscode.CompletionItemProvider {
	private apiInfo: Array<apiInfo> = [];
	private globalInfo: Array<member> = [];

    constructor(apiInfo: Array<apiInfo>, globalInfo: Array<member>,) {
		this.apiInfo = apiInfo;
		this.globalInfo = globalInfo;
	 }


    provideCompletionItems (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.CompletionItem[]> {
        return new Promise((resolve, reject) => {
			let suggestions: vscode.CompletionItem[] | PromiseLike<vscode.CompletionItem[]> | undefined = [];

			const range = new vscode.Range(position.line, 0, position.line, position.character)
			const text = document.getText(range);
			const matchRes = text.match(NAMESPACE_REG);

			if (matchRes && matchRes.length > 2) {
				const namespace = matchRes[1];
				const input = matchRes[2];
				// 添加子命名空间提示
				suggestions = suggestions.concat(
					buildSubNamespaceSuggestions(namespace, input, this.apiInfo)
				);
				// 添加api提示
				suggestions = suggestions.concat(
					buildApiSuggestions(namespace, input, this.apiInfo)
				);
			}
			else {
				// 添加api代码片段提示
				suggestions = suggestions.concat(buildSnippetSuggestions(this.apiInfo));
				// 添加global api代码片段提示
				suggestions = suggestions.concat(buildGlobalSnippetSuggestions(this.globalInfo));
				// 添加命名空间提示
				suggestions = suggestions.concat(buildNamespaceSuggestions(this.apiInfo));
			}
            return resolve(suggestions)
        });
    }
}
