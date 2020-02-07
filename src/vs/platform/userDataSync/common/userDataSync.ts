/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { IExtensionIdentifier } from 'vs/platform/extensionManagement/common/extensionManagement';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope, allSettings } from 'vs/platform/configuration/common/configurationRegistry';
import { localize } from 'vs/nls';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IJSONContributionRegistry, Extensions as JSONExtensions } from 'vs/platform/jsonschemas/common/jsonContributionRegistry';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { ILogService } from 'vs/platform/log/common/log';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IStringDictionary } from 'vs/base/common/collections';
import { FormattingOptions } from 'vs/base/common/jsonFormatter';
import { URI } from 'vs/base/common/uri';
import { isEqual } from 'vs/base/common/resources';

export const CONFIGURATION_SYNC_STORE_KEY = 'configurationSync.store';

export const DEFAULT_IGNORED_SETTINGS = [
	CONFIGURATION_SYNC_STORE_KEY,
	'sync.enable',
	'sync.enableSettings',
	'sync.enableExtensions',
];

export interface ISyncConfiguration {
	sync: {
		enable: boolean,
		enableSettings: boolean,
		enableKeybindings: boolean,
		enableUIState: boolean,
		enableExtensions: boolean,
		keybindingsPerPlatform: boolean,
		ignoredExtensions: string[],
		ignoredSettings: string[]
	}
}

export function registerConfiguration(): IDisposable {
	const ignoredSettingsSchemaId = 'vscode://schemas/ignoredSettings';
	const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
	configurationRegistry.registerConfiguration({
		id: 'sync',
		order: 30,
		title: localize('sync', "Sync"),
		type: 'object',
		properties: {
			'sync.enable': {
				type: 'boolean',
				description: localize('sync.enable', "Enable synchronization."),
				default: false,
				scope: ConfigurationScope.APPLICATION
			},
			'sync.enableSettings': {
				type: 'boolean',
				description: localize('sync.enableSettings', "Enable synchronizing settings."),
				default: true,
				scope: ConfigurationScope.APPLICATION,
			},
			'sync.enableKeybindings': {
				type: 'boolean',
				description: localize('sync.enableKeybindings', "Enable synchronizing keybindings."),
				default: true,
				scope: ConfigurationScope.APPLICATION,
			},
			'sync.enableUIState': {
				type: 'boolean',
				description: localize('sync.enableUIState', "Enable synchronizing UI state (Only Display Language)."),
				default: true,
				scope: ConfigurationScope.APPLICATION,
			},
			'sync.enableExtensions': {
				type: 'boolean',
				description: localize('sync.enableExtensions', "Enable synchronizing extensions."),
				default: true,
				scope: ConfigurationScope.APPLICATION,
			},
			'sync.keybindingsPerPlatform': {
				type: 'boolean',
				description: localize('sync.keybindingsPerPlatform', "Synchronize keybindings per platform."),
				default: true,
				scope: ConfigurationScope.APPLICATION,
			},
			'sync.ignoredExtensions': {
				'type': 'array',
				description: localize('sync.ignoredExtensions', "Configure extensions to be ignored while synchronizing."),
				'default': [],
				'scope': ConfigurationScope.APPLICATION,
				uniqueItems: true
			},
			'sync.ignoredSettings': {
				'type': 'array',
				description: localize('sync.ignoredSettings', "Configure settings to be ignored while synchronizing. \nDefault Ignored Settings:\n\n{0}", DEFAULT_IGNORED_SETTINGS.sort().map(setting => `- ${setting}`).join('\n')),
				'default': [],
				'scope': ConfigurationScope.APPLICATION,
				$ref: ignoredSettingsSchemaId,
				additionalProperties: true,
				uniqueItems: true
			}
		}
	});
	const registerIgnoredSettingsSchema = () => {
		const jsonRegistry = Registry.as<IJSONContributionRegistry>(JSONExtensions.JSONContribution);
		const ignoredSettingsSchema: IJSONSchema = {
			items: {
				type: 'string',
				enum: [...Object.keys(allSettings.properties).filter(setting => DEFAULT_IGNORED_SETTINGS.indexOf(setting) === -1), ...DEFAULT_IGNORED_SETTINGS.map(setting => `-${setting}`)]
			}
		};
		jsonRegistry.registerSchema(ignoredSettingsSchemaId, ignoredSettingsSchema);
	};
	return configurationRegistry.onDidUpdateConfiguration(() => registerIgnoredSettingsSchema());
}

export interface IUserData {
	ref: string;
	content: string | null;
}

export enum UserDataSyncErrorCode {
	Unauthorized = 'Unauthorized',
	Forbidden = 'Forbidden',
	ConnectionRefused = 'ConnectionRefused',
	Rejected = 'Rejected',
	TooLarge = 'TooLarge',
	NoRef = 'NoRef',
	Unknown = 'Unknown',
}

export class UserDataSyncError extends Error {

	constructor(message: string, public readonly code: UserDataSyncErrorCode, public readonly source?: SyncSource) {
		super(message);
	}

}

export class UserDataSyncStoreError extends UserDataSyncError { }

export interface IUserDataSyncStore {
	url: string;
	authenticationProviderId: string;
}

export function getUserDataSyncStore(configurationService: IConfigurationService): IUserDataSyncStore | undefined {
	const value = configurationService.getValue<IUserDataSyncStore>(CONFIGURATION_SYNC_STORE_KEY);
	return value && value.url && value.authenticationProviderId ? value : undefined;
}

export const IUserDataSyncStoreService = createDecorator<IUserDataSyncStoreService>('IUserDataSyncStoreService');
export interface IUserDataSyncStoreService {
	_serviceBrand: undefined;
	readonly userDataSyncStore: IUserDataSyncStore | undefined;
	read(key: string, oldValue: IUserData | null, source?: SyncSource): Promise<IUserData>;
	write(key: string, content: string, ref: string | null, source?: SyncSource): Promise<string>;
	clear(): Promise<void>;
}

export interface ISyncExtension {
	identifier: IExtensionIdentifier;
	version?: string;
	enabled: boolean;
}

export interface IGlobalState {
	argv: IStringDictionary<any>;
	storage: IStringDictionary<any>;
}

export const enum SyncSource {
	Settings = 'Settings',
	Keybindings = 'Keybindings',
	Extensions = 'Extensions',
	GlobalState = 'GlobalState'
}

export const enum SyncStatus {
	Uninitialized = 'uninitialized',
	Idle = 'idle',
	Syncing = 'syncing',
	HasConflicts = 'hasConflicts',
}

export interface ISynchroniser {
	readonly status: SyncStatus;
	readonly onDidChangeStatus: Event<SyncStatus>;
	readonly onDidChangeLocal: Event<void>;
	pull(): Promise<void>;
	push(): Promise<void>;
	sync(): Promise<void>;
	stop(): Promise<void>;
	restart(): Promise<void>;
	hasPreviouslySynced(): Promise<boolean>
	hasRemoteData(): Promise<boolean>;
	hasLocalData(): Promise<boolean>;
	resetLocal(): Promise<void>;
}

export interface IUserDataSynchroniser extends ISynchroniser {
	readonly source: SyncSource;
	getRemoteContent(preivew?: boolean): Promise<string | null>;
	accept(content: string): Promise<void>;
}

export const IUserDataSyncService = createDecorator<IUserDataSyncService>('IUserDataSyncService');
export interface IUserDataSyncService extends ISynchroniser {
	_serviceBrand: any;
	readonly conflictsSource: SyncSource | null;
	isFirstTimeSyncAndHasUserData(): Promise<boolean>;
	reset(): Promise<void>;
	resetLocal(): Promise<void>;
	getRemoteContent(source: SyncSource, preview: boolean): Promise<string | null>;
	accept(source: SyncSource, content: string): Promise<void>;
}

export const IUserDataAutoSyncService = createDecorator<IUserDataAutoSyncService>('IUserDataAutoSyncService');
export interface IUserDataAutoSyncService {
	_serviceBrand: any;
	onError: Event<{ code: UserDataSyncErrorCode, source?: SyncSource }>;
	triggerAutoSync(): Promise<void>;
}

export const IUserDataSyncUtilService = createDecorator<IUserDataSyncUtilService>('IUserDataSyncUtilService');
export interface IUserDataSyncUtilService {
	_serviceBrand: undefined;
	updateConfigurationValue(key: string, value: any): Promise<void>;
	resolveUserBindings(userbindings: string[]): Promise<IStringDictionary<string>>;
	resolveFormattingOptions(resource: URI): Promise<FormattingOptions>;
}

export const IUserDataAuthTokenService = createDecorator<IUserDataAuthTokenService>('IUserDataAuthTokenService');

export interface IUserDataAuthTokenService {
	_serviceBrand: undefined;

	readonly onDidChangeToken: Event<string | undefined>;

	getToken(): Promise<string | undefined>;
	setToken(accessToken: string | undefined): Promise<void>;
}

export const IUserDataSyncLogService = createDecorator<IUserDataSyncLogService>('IUserDataSyncLogService');
export interface IUserDataSyncLogService extends ILogService { }

export interface IConflictSetting {
	key: string;
	localValue: any | undefined;
	remoteValue: any | undefined;
}

export const ISettingsSyncService = createDecorator<ISettingsSyncService>('ISettingsSyncService');
export interface ISettingsSyncService extends IUserDataSynchroniser {
	_serviceBrand: any;
	readonly onDidChangeConflicts: Event<IConflictSetting[]>;
	readonly conflicts: IConflictSetting[];
	resolveSettingsConflicts(resolvedConflicts: { key: string, value: any | undefined }[]): Promise<void>;
}

export const CONTEXT_SYNC_STATE = new RawContextKey<string>('syncStatus', SyncStatus.Uninitialized);

export const USER_DATA_SYNC_SCHEME = 'vscode-userdata-sync';
export function toRemoteContentResource(source: SyncSource): URI {
	return URI.from({ scheme: USER_DATA_SYNC_SCHEME, path: `${source}/remoteContent` });
}
export function getSyncSourceFromRemoteContentResource(uri: URI): SyncSource | undefined {
	return [SyncSource.Settings, SyncSource.Keybindings, SyncSource.Extensions, SyncSource.GlobalState].filter(source => isEqual(uri, toRemoteContentResource(source)))[0];
}
