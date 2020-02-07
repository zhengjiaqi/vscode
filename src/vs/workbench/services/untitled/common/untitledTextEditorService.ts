/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { UntitledTextEditorInput } from 'vs/workbench/common/editor/untitledTextEditorInput';
import { IFilesConfiguration } from 'vs/platform/files/common/files';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { Event, Emitter } from 'vs/base/common/event';
import { ResourceMap } from 'vs/base/common/map';
import { Schemas } from 'vs/base/common/network';
import { Disposable } from 'vs/base/common/lifecycle';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { UntitledTextEditorModel, IUntitledTextEditorModel } from 'vs/workbench/common/editor/untitledTextEditorModel';
import { IResolvedTextEditorModel } from 'vs/editor/common/services/resolverService';

export const IUntitledTextEditorService = createDecorator<IUntitledTextEditorService>('untitledTextEditorService');

export interface INewUntitledTextEditorOptions {

	/**
	 * Initial value of the untitled file. An untitled file with initial
	 * value is dirty right from the beginning.
	 */
	initialValue?: string;

	/**
	 * Preferred language mode to use when saving the untitled file.
	 */
	mode?: string;

	/**
	 * Preferred encoding to use when saving the untitled file.
	 */
	encoding?: string;
}

export interface IExistingUntitledTextEditorOptions extends INewUntitledTextEditorOptions {

	/**
	 * A resource to identify the untitled resource to create or return
	 * if already existing.
	 *
	 * Note: the resource will not be used unless the scheme is `untitled`.
	 */
	untitledResource?: URI;
}

export interface INewUntitledTextEditorWithAssociatedResourceOptions extends INewUntitledTextEditorOptions {

	/**
	 * Resource components to associate with the untitled file. When saving
	 * the untitled file, the associated components will be used and the user
	 * is not being asked to provide a file path.
	 *
	 * Note: currently it is not possible to specify the `scheme` to use. The
	 * untitled file will saved to the default local or remote resource.
	 */
	associatedResource?: { authority: string; path: string; query: string; fragment: string; }
}

type IInternalUntitledTextEditorOptions = IExistingUntitledTextEditorOptions & INewUntitledTextEditorWithAssociatedResourceOptions;

export interface IUntitledTextEditorModelManager {

	/**
	 * Events for when untitled text editors change (e.g. getting dirty, saved or reverted).
	 */
	readonly onDidChangeDirty: Event<URI>;

	/**
	 * Events for when untitled text editor encodings change.
	 */
	readonly onDidChangeEncoding: Event<URI>;

	/**
	 * Events for when untitled text editor labels change.
	 */
	readonly onDidChangeLabel: Event<URI>;

	/**
	 * Events for when untitled text editors are disposed.
	 */
	readonly onDidDisposeModel: Event<URI>;

	/**
	 * Returns if an untitled resource with the given URI exists.
	 */
	exists(resource: URI): boolean;

	/**
	 * Returns an existing untitled input if already created before.
	 */
	get(resource: URI): UntitledTextEditorInput | undefined;

	/**
	 * Creates a new untitled input with the provided options. If the `untitledResource`
	 * property is provided and the untitled input exists, it will return that existing
	 * instance instead of creating a new one.
	 */
	create(options?: INewUntitledTextEditorOptions): UntitledTextEditorInput;
	create(options?: INewUntitledTextEditorWithAssociatedResourceOptions): UntitledTextEditorInput;
	create(options?: IExistingUntitledTextEditorOptions): UntitledTextEditorInput;

	/**
	 * Resolves an untitled editor model from the provided options. If the `untitledResource`
	 * property is provided and the untitled input exists, it will return that existing
	 * instance instead of creating a new one.
	 */
	resolve(options?: INewUntitledTextEditorOptions): Promise<IUntitledTextEditorModel & IResolvedTextEditorModel>;
	resolve(options?: INewUntitledTextEditorWithAssociatedResourceOptions): Promise<IUntitledTextEditorModel & IResolvedTextEditorModel>;
	resolve(options?: IExistingUntitledTextEditorOptions): Promise<IUntitledTextEditorModel & IResolvedTextEditorModel>;

	/**
	 * A check to find out if a untitled resource has a file path associated or not.
	 */
	hasAssociatedFilePath(resource: URI): boolean;
}

export interface IUntitledTextEditorService extends IUntitledTextEditorModelManager {

	_serviceBrand: undefined;
}

export class UntitledTextEditorService extends Disposable implements IUntitledTextEditorService {

	_serviceBrand: undefined;

	private readonly _onDidChangeDirty = this._register(new Emitter<URI>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	private readonly _onDidChangeEncoding = this._register(new Emitter<URI>());
	readonly onDidChangeEncoding = this._onDidChangeEncoding.event;

	private readonly _onDidDisposeModel = this._register(new Emitter<URI>());
	readonly onDidDisposeModel = this._onDidDisposeModel.event;

	private readonly _onDidChangeLabel = this._register(new Emitter<URI>());
	readonly onDidChangeLabel = this._onDidChangeLabel.event;

	private readonly mapResourceToInput = new ResourceMap<UntitledTextEditorInput>();
	private readonly mapResourceToAssociatedFilePath = new ResourceMap<boolean>();

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
	}

	exists(resource: URI): boolean {
		return this.mapResourceToInput.has(resource);
	}

	get(resource: URI): UntitledTextEditorInput | undefined {
		return this.mapResourceToInput.get(resource);
	}

	resolve(options?: IInternalUntitledTextEditorOptions): Promise<UntitledTextEditorModel & IResolvedTextEditorModel> {
		return this.doCreateOrGet(options).resolve();
	}

	create(options?: IInternalUntitledTextEditorOptions): UntitledTextEditorInput {
		return this.doCreateOrGet(options);
	}

	private doCreateOrGet(options: IInternalUntitledTextEditorOptions = Object.create(null)): UntitledTextEditorInput {
		const massagedOptions = this.massageOptions(options);

		// Return existing instance if asked for it
		if (massagedOptions.untitledResource && this.mapResourceToInput.has(massagedOptions.untitledResource)) {
			return this.mapResourceToInput.get(massagedOptions.untitledResource)!;
		}

		// Create new instance otherwise
		return this.doCreate(massagedOptions);
	}

	private massageOptions(options: IInternalUntitledTextEditorOptions): IInternalUntitledTextEditorOptions {
		const massagedOptions: IInternalUntitledTextEditorOptions = Object.create(null);

		// Figure out associated and untitled resource
		if (options.associatedResource) {
			massagedOptions.untitledResource = URI.from({
				scheme: Schemas.untitled,
				authority: options.associatedResource.authority,
				fragment: options.associatedResource.fragment,
				path: options.associatedResource.path,
				query: options.associatedResource.query
			});
			massagedOptions.associatedResource = options.associatedResource;
		} else {
			if (options.untitledResource?.scheme === Schemas.untitled) {
				massagedOptions.untitledResource = options.untitledResource;
			}
		}

		// Language mode
		if (options.mode) {
			massagedOptions.mode = options.mode;
		} else if (!massagedOptions.associatedResource) {
			const configuration = this.configurationService.getValue<IFilesConfiguration>();
			if (configuration.files?.defaultLanguage) {
				massagedOptions.mode = configuration.files.defaultLanguage;
			}
		}

		// Take over encoding and initial value
		massagedOptions.encoding = options.encoding;
		massagedOptions.initialValue = options.initialValue;

		return massagedOptions;
	}

	private doCreate(options: IInternalUntitledTextEditorOptions): UntitledTextEditorInput {

		// Create a new untitled resource if none is provided
		let untitledResource = options.untitledResource;
		if (!untitledResource) {
			let counter = 1;
			do {
				untitledResource = URI.from({ scheme: Schemas.untitled, path: `Untitled-${counter}` });
				counter++;
			} while (this.mapResourceToInput.has(untitledResource));
		}

		// Create new input with provided options
		const input = this.instantiationService.createInstance(UntitledTextEditorInput, untitledResource, !!options.associatedResource, options.mode, options.initialValue, options.encoding);

		const dirtyListener = input.onDidChangeDirty(() => this._onDidChangeDirty.fire(input.getResource()));
		const labelListener = input.onDidChangeLabel(() => this._onDidChangeLabel.fire(input.getResource()));
		const encodingListener = input.onDidModelChangeEncoding(() => this._onDidChangeEncoding.fire(input.getResource()));
		const disposeListener = input.onDispose(() => this._onDidDisposeModel.fire(input.getResource()));

		// Remove from cache on dispose
		Event.once(input.onDispose)(() => {

			// Registry
			this.mapResourceToInput.delete(input.getResource());
			this.mapResourceToAssociatedFilePath.delete(input.getResource());

			// Listeners
			dirtyListener.dispose();
			labelListener.dispose();
			encodingListener.dispose();
			disposeListener.dispose();
		});

		// Add to cache
		this.mapResourceToInput.set(untitledResource, input);
		if (options.associatedResource) {
			this.mapResourceToAssociatedFilePath.set(untitledResource, true);
		}

		return input;
	}

	hasAssociatedFilePath(resource: URI): boolean {
		return this.mapResourceToAssociatedFilePath.has(resource);
	}
}

registerSingleton(IUntitledTextEditorService, UntitledTextEditorService, true);
