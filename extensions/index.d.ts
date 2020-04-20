import * as electron from 'electron';
// import Fs from 'fs-extra'
// declare type move1 = move;

// declare type Fs = import('fs-extra').move

declare module "vscode" {
	export let a: number;
	export interface ExtensionContext {
		a?: number
	}
	export let extHostContext: any;
 }

declare global {

    interface Window {
		context: WebViewContext;
	}

	interface Window {
		renderContext: Context;
	}

	interface WebViewContext {
		event: event;
		query: {
			config: string,
			deviceId: string,
			name: string,
			path: string,
			preload: string,
			scope: string
		};
		util: webViewContextUtil
	}

	interface Context {
		sdk: {
			typings: {
				current: {
					path: string
				}
			}
		}
		info: {
			projectInfo: {
				dir: string,
				id: string,
				name: string,
				projectType: 'program',
				sign: string,
				smartProgramDir: string,
				type: string,
				userData: string
			}
		}
	}
}

// declare interface WebViewContext {
// 	event: event;
// 	query: {
// 		config: string,
// 		deviceId: string,
// 		name: string,
// 		path: string,
// 		preload: string,
// 		scope: string
// 	};
// 	util: webViewContextUtil
// }

interface event {
	send(eventName: string, data?: object, callback?: Function): Promise<Array<any>>;
	sendTo(target: string, eventName: string, data?: object, callback?: Function): Promise<Array<any>>;
	on(eventName: string, handler: Function, extra?: object): void;
	once(eventName: string, handler: Function): void;
	off(eventName: string, handler: Function): void;
}

interface webViewContextUtil {
	Menu: electron.Menu;
	MenuItem: electron.MenuItem;
	clipboard: electron.Clipboard;
	cookies: electron.Cookies;
	createWebSocket(uri: string, options: object, callbacks: object): void;
	dialog: electron.Dialog;
	download(option: downloadOption): void;
	downloadFile(options: object, callbacks: object): void;
	// fs: Fs;
}

interface downloadOption {
	url: string;
	filePath: string;
}

// declare interface Context {
// 	sdk: {
// 		typings: {
// 			current: {
// 				path: string
// 			}
// 		}
// 	}
// 	info: {
// 		projectInfo: {
// 			dir: string,
// 			id: string,
// 			name: string,
// 			projectType: 'program',
// 			sign: string,
// 			smartProgramDir: string,
// 			type: string,
// 			userData: string
// 		}
// 	}
// }
