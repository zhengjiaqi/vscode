/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Event, Emitter } from 'vs/base/common/event';
import { assign } from 'vs/base/common/objects';
import { withNullAsUndefined, assertIsDefined } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { IDisposable, Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { IEditor as ICodeEditor, IEditorViewState, ScrollType, IDiffEditor } from 'vs/editor/common/editorCommon';
import { IEditorModel, IEditorOptions, ITextEditorOptions, IBaseResourceInput, IResourceInput, EditorActivation, EditorOpenContext, ITextEditorSelection, TextEditorSelectionRevealType } from 'vs/platform/editor/common/editor';
import { IInstantiationService, IConstructorSignature0, ServicesAccessor, BrandedService } from 'vs/platform/instantiation/common/instantiation';
import { RawContextKey, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { Registry } from 'vs/platform/registry/common/platform';
import { ITextModel } from 'vs/editor/common/model';
import { IEditorGroup, IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { ICompositeControl } from 'vs/workbench/common/composite';
import { ActionRunner, IAction } from 'vs/base/common/actions';
import { IFileService, FileSystemProviderCapabilities } from 'vs/platform/files/common/files';
import { IPathData } from 'vs/platform/windows/common/windows';
import { coalesce, firstOrDefault } from 'vs/base/common/arrays';
import { ITextFileSaveOptions, ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { isEqual, dirname } from 'vs/base/common/resources';
import { IPanel } from 'vs/workbench/common/panel';
import { IRange } from 'vs/editor/common/core/range';
import { createMemoizer } from 'vs/base/common/decorators';
import { ILabelService } from 'vs/platform/label/common/label';
import { Schemas } from 'vs/base/common/network';
import { IFilesConfigurationService, AutoSaveMode } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';

export const DirtyWorkingCopiesContext = new RawContextKey<boolean>('dirtyWorkingCopies', false);
export const ActiveEditorContext = new RawContextKey<string | null>('activeEditor', null);
export const ActiveEditorIsReadonlyContext = new RawContextKey<boolean>('activeEditorIsReadonly', false);
export const EditorsVisibleContext = new RawContextKey<boolean>('editorIsOpen', false);
export const EditorPinnedContext = new RawContextKey<boolean>('editorPinned', false);
export const EditorGroupActiveEditorDirtyContext = new RawContextKey<boolean>('groupActiveEditorDirty', false);
export const EditorGroupEditorsCountContext = new RawContextKey<number>('groupEditorsCount', 0);
export const NoEditorsVisibleContext: ContextKeyExpr = EditorsVisibleContext.toNegated();
export const TextCompareEditorVisibleContext = new RawContextKey<boolean>('textCompareEditorVisible', false);
export const TextCompareEditorActiveContext = new RawContextKey<boolean>('textCompareEditorActive', false);
export const ActiveEditorGroupEmptyContext = new RawContextKey<boolean>('activeEditorGroupEmpty', false);
export const ActiveEditorGroupIndexContext = new RawContextKey<number>('activeEditorGroupIndex', 0);
export const ActiveEditorGroupLastContext = new RawContextKey<boolean>('activeEditorGroupLast', false);
export const MultipleEditorGroupsContext = new RawContextKey<boolean>('multipleEditorGroups', false);
export const SingleEditorGroupsContext = MultipleEditorGroupsContext.toNegated();
export const InEditorZenModeContext = new RawContextKey<boolean>('inZenMode', false);
export const IsCenteredLayoutContext = new RawContextKey<boolean>('isCenteredLayout', false);
export const SplitEditorsVertically = new RawContextKey<boolean>('splitEditorsVertically', false);
export const EditorAreaVisibleContext = new RawContextKey<boolean>('editorAreaVisible', true);

/**
 * Text diff editor id.
 */
export const TEXT_DIFF_EDITOR_ID = 'workbench.editors.textDiffEditor';

/**
 * Binary diff editor id.
 */
export const BINARY_DIFF_EDITOR_ID = 'workbench.editors.binaryResourceDiffEditor';

export interface IEditor extends IPanel {

	/**
	 * The assigned input of this editor.
	 */
	input: IEditorInput | undefined;

	/**
	 * The assigned options of this editor.
	 */
	options: IEditorOptions | undefined;

	/**
	 * The assigned group this editor is showing in.
	 */
	group: IEditorGroup | undefined;

	/**
	 * The minimum width of this editor.
	 */
	readonly minimumWidth: number;

	/**
	 * The maximum width of this editor.
	 */
	readonly maximumWidth: number;

	/**
	 * The minimum height of this editor.
	 */
	readonly minimumHeight: number;

	/**
	 * The maximum height of this editor.
	 */
	readonly maximumHeight: number;

	/**
	 * An event to notify whenever minimum/maximum width/height changes.
	 */
	readonly onDidSizeConstraintsChange: Event<{ width: number; height: number; } | undefined>;

	/**
	 * Returns the underlying control of this editor.
	 */
	getControl(): IEditorControl | undefined;

	/**
	 * Finds out if this editor is visible or not.
	 */
	isVisible(): boolean;
}

export interface ITextEditor extends IEditor {

	/**
	 * Returns the underlying text editor widget of this editor.
	 */
	getControl(): ICodeEditor | undefined;

	/**
	 * Returns the current view state of the text editor if any.
	 */
	getViewState(): IEditorViewState | undefined;
}

export function isTextEditor(thing: IEditor | undefined): thing is ITextEditor {
	const candidate = thing as ITextEditor | undefined;

	return typeof candidate?.getViewState === 'function';
}

export interface ITextDiffEditor extends IEditor {

	/**
	 * Returns the underlying text editor widget of this editor.
	 */
	getControl(): IDiffEditor | undefined;
}

export interface ITextSideBySideEditor extends IEditor {

	/**
	 * Returns the underlying text editor widget of the master side
	 * of this side-by-side editor.
	 */
	getMasterEditor(): ITextEditor;

	/**
	 * Returns the underlying text editor widget of the details side
	 * of this side-by-side editor.
	 */
	getDetailsEditor(): ITextEditor;
}

/**
 * Marker interface for the base editor control
 */
export interface IEditorControl extends ICompositeControl { }

export interface IFileInputFactory {

	createFileInput(resource: URI, encoding: string | undefined, mode: string | undefined, instantiationService: IInstantiationService): IFileEditorInput;

	isFileInput(obj: any): obj is IFileEditorInput;
}

export interface IEditorInputFactoryRegistry {

	/**
	 * Registers the file input factory to use for file inputs.
	 */
	registerFileInputFactory(factory: IFileInputFactory): void;

	/**
	 * Returns the file input factory to use for file inputs.
	 */
	getFileInputFactory(): IFileInputFactory;

	/**
	 * Registers a editor input factory for the given editor input to the registry. An editor input factory
	 * is capable of serializing and deserializing editor inputs from string data.
	 *
	 * @param editorInputId the identifier of the editor input
	 * @param factory the editor input factory for serialization/deserialization
	 */
	registerEditorInputFactory<Services extends BrandedService[]>(editorInputId: string, ctor: { new(...Services: Services): IEditorInputFactory }): IDisposable;

	/**
	 * Returns the editor input factory for the given editor input.
	 *
	 * @param editorInputId the identifier of the editor input
	 */
	getEditorInputFactory(editorInputId: string): IEditorInputFactory | undefined;

	/**
	 * Starts the registry by providing the required services.
	 */
	start(accessor: ServicesAccessor): void;
}

export interface IEditorInputFactory {

	/**
	 * Determines whether the given editor input can be serialized by the factory.
	 */
	canSerialize(editorInput: IEditorInput): boolean;

	/**
	 * Returns a string representation of the provided editor input that contains enough information
	 * to deserialize back to the original editor input from the deserialize() method.
	 */
	serialize(editorInput: EditorInput): string | undefined;

	/**
	 * Returns an editor input from the provided serialized form of the editor input. This form matches
	 * the value returned from the serialize() method.
	 */
	deserialize(instantiationService: IInstantiationService, serializedEditorInput: string): EditorInput | undefined;
}

export interface IUntitledTextResourceInput extends IBaseResourceInput {

	/**
	 * Optional resource. If the resource is not provided a new untitled file is created (e.g. Untitled-1).
	 * If the used scheme for the resource is not `untitled://`, `forceUntitled: true` must be configured to
	 * force use the provided resource as associated path. As such, the resource will be used when saving
	 * the untitled editor.
	 */
	resource?: URI;

	/**
	 * Optional language of the untitled resource.
	 */
	mode?: string;

	/**
	 * Optional contents of the untitled resource.
	 */
	contents?: string;

	/**
	 * Optional encoding of the untitled resource.
	 */
	encoding?: string;
}

export interface IResourceDiffInput extends IBaseResourceInput {

	/**
	 * The left hand side URI to open inside a diff editor.
	 */
	leftResource: URI;

	/**
	 * The right hand side URI to open inside a diff editor.
	 */
	rightResource: URI;
}

export interface IResourceSideBySideInput extends IBaseResourceInput {

	/**
	 * The right hand side URI to open inside a side by side editor.
	 */
	masterResource: URI;

	/**
	 * The left hand side URI to open inside a side by side editor.
	 */
	detailResource: URI;
}

export const enum Verbosity {
	SHORT,
	MEDIUM,
	LONG
}

export const enum SaveReason {

	/**
	 * Explicit user gesture.
	 */
	EXPLICIT = 1,

	/**
	 * Auto save after a timeout.
	 */
	AUTO = 2,

	/**
	 * Auto save after editor focus change.
	 */
	FOCUS_CHANGE = 3,

	/**
	 * Auto save after window change.
	 */
	WINDOW_CHANGE = 4
}

export interface ISaveOptions {

	/**
	 * An indicator how the save operation was triggered.
	 */
	reason?: SaveReason;

	/**
	 * Forces to save the contents of the working copy
	 * again even if the working copy is not dirty.
	 */
	force?: boolean;

	/**
	 * Instructs the save operation to skip any save participants.
	 */
	skipSaveParticipants?: boolean;

	/**
	 * A hint as to which file systems should be available for saving.
	 */
	availableFileSystems?: string[];
}

export interface IRevertOptions {

	/**
	 * Forces to load the contents of the working copy
	 * again even if the working copy is not dirty.
	 */
	force?: boolean;

	/**
	 * A soft revert will clear dirty state of a working copy
	 * but will not attempt to load it from its persisted state.
	 *
	 * This option may be used in scenarios where an editor is
	 * closed and where we do not require to load the contents.
	 */
	soft?: boolean;
}

export interface IEditorInput extends IDisposable {

	/**
	 * Triggered when this input is disposed.
	 */
	readonly onDispose: Event<void>;

	/**
	 * Triggered when this input changes its dirty state.
	 */
	readonly onDidChangeDirty: Event<void>;

	/**
	 * Triggered when this input changes its label
	 */
	readonly onDidChangeLabel: Event<void>;

	/**
	 * Returns the associated resource of this input.
	 */
	getResource(): URI | undefined;

	/**
	 * Unique type identifier for this inpput.
	 */
	getTypeId(): string;

	/**
	 * Returns the display name of this input.
	 */
	getName(): string;

	/**
	 * Returns the display description of this input.
	 */
	getDescription(verbosity?: Verbosity): string | undefined;

	/**
	 * Returns the display title of this input.
	 */
	getTitle(verbosity?: Verbosity): string | undefined;

	/**
	 * Resolves the input.
	 */
	resolve(): Promise<IEditorModel | null>;

	/**
	 * Returns if this input is readonly or not.
	 */
	isReadonly(): boolean;

	/**
	 * Returns if the input is an untitled editor or not.
	 */
	isUntitled(): boolean;

	/**
	 * Returns if this input is dirty or not.
	 */
	isDirty(): boolean;

	/**
	 * Returns if this input is currently being saved or soon to be
	 * saved. Based on this assumption the editor may for example
	 * decide to not signal the dirty state to the user assuming that
	 * the save is scheduled to happen anyway.
	 */
	isSaving(): boolean;

	/**
	 * Saves the editor. The provided groupId helps implementors
	 * to e.g. preserve view state of the editor and re-open it
	 * in the correct group after saving.
	 *
	 * @returns the resulting editor input (typically the same) of
	 * this operation or `undefined` to indicate that the operation
	 * failed or was canceled.
	 */
	save(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined>;

	/**
	 * Saves the editor to a different location. The provided `group`
	 * helps implementors to e.g. preserve view state of the editor
	 * and re-open it in the correct group after saving.
	 *
	 * @returns the resulting editor input (typically a different one)
	 * of this operation or `undefined` to indicate that the operation
	 * failed or was canceled.
	 */
	saveAs(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined>;

	/**
	 * Reverts this input from the provided group.
	 */
	revert(group: GroupIdentifier, options?: IRevertOptions): Promise<boolean>;

	/**
	 * Returns if the other object matches this input.
	 */
	matches(other: unknown): boolean;

	/**
	 * Returns if this editor is disposed.
	 */
	isDisposed(): boolean;
}

/**
 * Editor inputs are lightweight objects that can be passed to the workbench API to open inside the editor part.
 * Each editor input is mapped to an editor that is capable of opening it through the Platform facade.
 */
export abstract class EditorInput extends Disposable implements IEditorInput {

	protected readonly _onDidChangeDirty = this._register(new Emitter<void>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	protected readonly _onDidChangeLabel = this._register(new Emitter<void>());
	readonly onDidChangeLabel = this._onDidChangeLabel.event;

	private readonly _onDispose = this._register(new Emitter<void>());
	readonly onDispose = this._onDispose.event;

	private disposed: boolean = false;

	abstract getTypeId(): string;

	getResource(): URI | undefined {
		return undefined;
	}

	getName(): string {
		return `Editor ${this.getTypeId()}`;
	}

	getDescription(verbosity?: Verbosity): string | undefined {
		return undefined;
	}

	getTitle(verbosity?: Verbosity): string {
		return this.getName();
	}

	/**
	 * Returns the preferred editor for this input. A list of candidate editors is passed in that whee registered
	 * for the input. This allows subclasses to decide late which editor to use for the input on a case by case basis.
	 */
	getPreferredEditorId(candidates: string[]): string | undefined {
		return firstOrDefault(candidates);
	}

	/**
	* Returns a descriptor suitable for telemetry events.
	*
	* Subclasses should extend if they can contribute.
	*/
	getTelemetryDescriptor(): { [key: string]: unknown } {
		/* __GDPR__FRAGMENT__
			"EditorTelemetryDescriptor" : {
				"typeId" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
			}
		*/
		return { typeId: this.getTypeId() };
	}

	/**
	 * Returns a type of EditorModel that represents the resolved input. Subclasses should
	 * override to provide a meaningful model.
	 */
	abstract resolve(): Promise<IEditorModel | null>;

	isReadonly(): boolean {
		return true;
	}

	isUntitled(): boolean {
		return false;
	}

	isDirty(): boolean {
		return false;
	}

	isSaving(): boolean {
		return false;
	}

	async save(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		return this;
	}

	async saveAs(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		return this;
	}

	async revert(group: GroupIdentifier, options?: IRevertOptions): Promise<boolean> {
		return true;
	}

	/**
	 * Subclasses can set this to false if it does not make sense to split the editor input.
	 */
	supportsSplitEditor(): boolean {
		return true;
	}

	matches(otherInput: unknown): boolean {
		return this === otherInput;
	}

	isDisposed(): boolean {
		return this.disposed;
	}

	dispose(): void {
		if (!this.disposed) {
			this.disposed = true;
			this._onDispose.fire();
		}

		super.dispose();
	}
}

export abstract class TextResourceEditorInput extends EditorInput {

	private static readonly MEMOIZER = createMemoizer();

	constructor(
		protected readonly resource: URI,
		@IEditorService protected readonly editorService: IEditorService,
		@IEditorGroupsService protected readonly editorGroupService: IEditorGroupsService,
		@ITextFileService protected readonly textFileService: ITextFileService,
		@ILabelService protected readonly labelService: ILabelService,
		@IFileService protected readonly fileService: IFileService,
		@IFilesConfigurationService protected readonly filesConfigurationService: IFilesConfigurationService
	) {
		super();

		// Clear label memoizer on certain events that have impact
		this._register(this.labelService.onDidChangeFormatters(() => TextResourceEditorInput.MEMOIZER.clear()));
		this._register(this.fileService.onDidChangeFileSystemProviderRegistrations(() => TextResourceEditorInput.MEMOIZER.clear()));
	}

	getResource(): URI {
		return this.resource;
	}

	getName(): string {
		return this.basename;
	}

	@TextResourceEditorInput.MEMOIZER
	private get basename(): string {
		return this.labelService.getUriBasenameLabel(this.resource);
	}

	getDescription(verbosity: Verbosity = Verbosity.MEDIUM): string | undefined {
		switch (verbosity) {
			case Verbosity.SHORT:
				return this.shortDescription;
			case Verbosity.LONG:
				return this.longDescription;
			case Verbosity.MEDIUM:
			default:
				return this.mediumDescription;
		}
	}

	@TextResourceEditorInput.MEMOIZER
	private get shortDescription(): string {
		return this.labelService.getUriBasenameLabel(dirname(this.resource));
	}

	@TextResourceEditorInput.MEMOIZER
	private get mediumDescription(): string {
		return this.labelService.getUriLabel(dirname(this.resource), { relative: true });
	}

	@TextResourceEditorInput.MEMOIZER
	private get longDescription(): string {
		return this.labelService.getUriLabel(dirname(this.resource));
	}

	@TextResourceEditorInput.MEMOIZER
	private get shortTitle(): string {
		return this.getName();
	}

	@TextResourceEditorInput.MEMOIZER
	private get mediumTitle(): string {
		return this.labelService.getUriLabel(this.resource, { relative: true });
	}

	@TextResourceEditorInput.MEMOIZER
	private get longTitle(): string {
		return this.labelService.getUriLabel(this.resource);
	}

	getTitle(verbosity: Verbosity): string {
		switch (verbosity) {
			case Verbosity.SHORT:
				return this.shortTitle;
			case Verbosity.LONG:
				return this.longTitle;
			default:
			case Verbosity.MEDIUM:
				return this.mediumTitle;
		}
	}

	isUntitled(): boolean {
		return this.resource.scheme === Schemas.untitled;
	}

	isReadonly(): boolean {
		if (this.isUntitled()) {
			return false; // untitled is never readonly
		}

		if (!this.fileService.canHandleResource(this.resource)) {
			return true; // resources without file support are always readonly
		}

		const model = this.textFileService.files.get(this.resource);

		return model?.isReadonly() || this.fileService.hasCapability(this.resource, FileSystemProviderCapabilities.Readonly);
	}

	isSaving(): boolean {
		if (this.isUntitled()) {
			return false; // untitled is never saving automatically
		}

		if (this.filesConfigurationService.getAutoSaveMode() === AutoSaveMode.AFTER_SHORT_DELAY) {
			return true; // a short auto save is configured, treat this as being saved
		}

		return false;
	}

	async save(group: GroupIdentifier, options?: ITextFileSaveOptions): Promise<IEditorInput | undefined> {
		return this.doSave(group, options, false);
	}

	saveAs(group: GroupIdentifier, options?: ITextFileSaveOptions): Promise<IEditorInput | undefined> {
		return this.doSave(group, options, true);
	}

	private async doSave(group: GroupIdentifier, options: ISaveOptions | undefined, saveAs: boolean): Promise<IEditorInput | undefined> {

		// Save / Save As
		let target: URI | undefined;
		if (saveAs) {
			target = await this.textFileService.saveAs(this.resource, undefined, options);
		} else {
			target = await this.textFileService.save(this.resource, options);
		}

		if (!target) {
			return undefined; // save cancelled
		}

		if (!isEqual(target, this.resource)) {
			return this.editorService.createInput({ resource: target });
		}

		return this;
	}

	revert(group: GroupIdentifier, options?: IRevertOptions): Promise<boolean> {
		return this.textFileService.revert(this.resource, options);
	}
}

export const enum EncodingMode {

	/**
	 * Instructs the encoding support to encode the current input with the provided encoding
	 */
	Encode,

	/**
	 * Instructs the encoding support to decode the current input with the provided encoding
	 */
	Decode
}

export interface IEncodingSupport {

	/**
	 * Gets the encoding of the type if known.
	 */
	getEncoding(): string | undefined;

	/**
	 * Sets the encoding for the type for saving.
	 */
	setEncoding(encoding: string, mode: EncodingMode): void;
}

export interface IModeSupport {

	/**
	 * Sets the language mode of the type.
	 */
	setMode(mode: string): void;
}

/**
 * This is a tagging interface to declare an editor input being capable of dealing with files. It is only used in the editor registry
 * to register this kind of input to the platform.
 */
export interface IFileEditorInput extends IEditorInput, IEncodingSupport, IModeSupport {

	/**
	 * Gets the resource this editor is about.
	 */
	getResource(): URI;

	/**
	 * Sets the preferred encoding to use for this input.
	 */
	setPreferredEncoding(encoding: string): void;

	/**
	 * Sets the preferred language mode to use for this input.
	 */
	setPreferredMode(mode: string): void;

	/**
	 * Forces this file input to open as binary instead of text.
	 */
	setForceOpenAsBinary(): void;
}

/**
 * Side by side editor inputs that have a master and details side.
 */
export class SideBySideEditorInput extends EditorInput {

	static readonly ID: string = 'workbench.editorinputs.sidebysideEditorInput';

	constructor(
		protected readonly name: string | undefined,
		private readonly description: string | undefined,
		private readonly _details: EditorInput,
		private readonly _master: EditorInput
	) {
		super();

		this.registerListeners();
	}

	get master(): EditorInput {
		return this._master;
	}

	get details(): EditorInput {
		return this._details;
	}

	getTypeId(): string {
		return SideBySideEditorInput.ID;
	}

	getName(): string {
		if (!this.name) {
			return localize('sideBySideLabels', "{0} - {1}", this._details.getName(), this._master.getName());
		}

		return this.name;
	}

	getDescription(): string | undefined {
		return this.description;
	}

	isReadonly(): boolean {
		return this.master.isReadonly();
	}

	isUntitled(): boolean {
		return this.master.isUntitled();
	}

	isDirty(): boolean {
		return this.master.isDirty();
	}

	isSaving(): boolean {
		return this.master.isSaving();
	}

	save(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		return this.master.save(group, options);
	}

	saveAs(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		return this.master.saveAs(group, options);
	}

	revert(group: GroupIdentifier, options?: IRevertOptions): Promise<boolean> {
		return this.master.revert(group, options);
	}

	getTelemetryDescriptor(): { [key: string]: unknown } {
		const descriptor = this.master.getTelemetryDescriptor();

		return assign(descriptor, super.getTelemetryDescriptor());
	}

	private registerListeners(): void {

		// When the details or master input gets disposed, dispose this diff editor input
		const onceDetailsDisposed = Event.once(this.details.onDispose);
		this._register(onceDetailsDisposed(() => {
			if (!this.isDisposed()) {
				this.dispose();
			}
		}));

		const onceMasterDisposed = Event.once(this.master.onDispose);
		this._register(onceMasterDisposed(() => {
			if (!this.isDisposed()) {
				this.dispose();
			}
		}));

		// Reemit some events from the master side to the outside
		this._register(this.master.onDidChangeDirty(() => this._onDidChangeDirty.fire()));
		this._register(this.master.onDidChangeLabel(() => this._onDidChangeLabel.fire()));
	}

	async resolve(): Promise<EditorModel | null> {
		return null;
	}

	matches(otherInput: unknown): boolean {
		if (super.matches(otherInput) === true) {
			return true;
		}

		if (otherInput) {
			if (!(otherInput instanceof SideBySideEditorInput)) {
				return false;
			}

			return this.details.matches(otherInput.details) && this.master.matches(otherInput.master);
		}

		return false;
	}
}

export interface ITextEditorModel extends IEditorModel {
	textEditorModel: ITextModel;
}

/**
 * The editor model is the heavyweight counterpart of editor input. Depending on the editor input, it
 * connects to the disk to retrieve content and may allow for saving it back or reverting it. Editor models
 * are typically cached for some while because they are expensive to construct.
 */
export class EditorModel extends Disposable implements IEditorModel {

	private readonly _onDispose = this._register(new Emitter<void>());
	readonly onDispose = this._onDispose.event;

	/**
	 * Causes this model to load returning a promise when loading is completed.
	 */
	async load(): Promise<IEditorModel> {
		return this;
	}

	/**
	 * Returns whether this model was loaded or not.
	 */
	isResolved(): boolean {
		return true;
	}

	/**
	 * Subclasses should implement to free resources that have been claimed through loading.
	 */
	dispose(): void {
		this._onDispose.fire();

		super.dispose();
	}
}

export interface IEditorInputWithOptions {
	editor: IEditorInput;
	options?: IEditorOptions | ITextEditorOptions;
}

export function isEditorInputWithOptions(obj: unknown): obj is IEditorInputWithOptions {
	const editorInputWithOptions = obj as IEditorInputWithOptions;

	return !!editorInputWithOptions && !!editorInputWithOptions.editor;
}

/**
 * The editor options is the base class of options that can be passed in when opening an editor.
 */
export class EditorOptions implements IEditorOptions {

	/**
	 * Helper to create EditorOptions inline.
	 */
	static create(settings: IEditorOptions): EditorOptions {
		const options = new EditorOptions();
		options.overwrite(settings);

		return options;
	}

	/**
	 * Tells the editor to not receive keyboard focus when the editor is being opened.
	 *
	 * Will also not activate the group the editor opens in unless the group is already
	 * the active one. This behaviour can be overridden via the `activation` option.
	 */
	preserveFocus: boolean | undefined;

	/**
	 * This option is only relevant if an editor is opened into a group that is not active
	 * already and allows to control if the inactive group should become active, restored
	 * or preserved.
	 *
	 * By default, the editor group will become active unless `preserveFocus` or `inactive`
	 * is specified.
	 */
	activation: EditorActivation | undefined;

	/**
	 * Tells the editor to reload the editor input in the editor even if it is identical to the one
	 * already showing. By default, the editor will not reload the input if it is identical to the
	 * one showing.
	 */
	forceReload: boolean | undefined;

	/**
	 * Will reveal the editor if it is already opened and visible in any of the opened editor groups.
	 */
	revealIfVisible: boolean | undefined;

	/**
	 * Will reveal the editor if it is already opened (even when not visible) in any of the opened editor groups.
	 */
	revealIfOpened: boolean | undefined;

	/**
	 * An editor that is pinned remains in the editor stack even when another editor is being opened.
	 * An editor that is not pinned will always get replaced by another editor that is not pinned.
	 */
	pinned: boolean | undefined;

	/**
	 * The index in the document stack where to insert the editor into when opening.
	 */
	index: number | undefined;

	/**
	 * An active editor that is opened will show its contents directly. Set to true to open an editor
	 * in the background without loading its contents.
	 *
	 * Will also not activate the group the editor opens in unless the group is already
	 * the active one. This behaviour can be overridden via the `activation` option.
	 */
	inactive: boolean | undefined;

	/**
	 * Will not show an error in case opening the editor fails and thus allows to show a custom error
	 * message as needed. By default, an error will be presented as notification if opening was not possible.
	 */
	ignoreError: boolean | undefined;

	/**
	 * Does not use editor overrides while opening the editor.
	 */
	ignoreOverrides: boolean | undefined;

	/**
	 * A optional hint to signal in which context the editor opens.
	 *
	 * If configured to be `EditorOpenContext.USER`, this hint can be
	 * used in various places to control the experience. For example,
	 * if the editor to open fails with an error, a notification could
	 * inform about this in a modal dialog. If the editor opened through
	 * some background task, the notification would show in the background,
	 * not as a modal dialog.
	 */
	context: EditorOpenContext | undefined;

	/**
	 * Overwrites option values from the provided bag.
	 */
	overwrite(options: IEditorOptions): EditorOptions {
		if (typeof options.forceReload === 'boolean') {
			this.forceReload = options.forceReload;
		}

		if (typeof options.revealIfVisible === 'boolean') {
			this.revealIfVisible = options.revealIfVisible;
		}

		if (typeof options.revealIfOpened === 'boolean') {
			this.revealIfOpened = options.revealIfOpened;
		}

		if (typeof options.preserveFocus === 'boolean') {
			this.preserveFocus = options.preserveFocus;
		}

		if (typeof options.activation === 'number') {
			this.activation = options.activation;
		}

		if (typeof options.pinned === 'boolean') {
			this.pinned = options.pinned;
		}

		if (typeof options.inactive === 'boolean') {
			this.inactive = options.inactive;
		}

		if (typeof options.ignoreError === 'boolean') {
			this.ignoreError = options.ignoreError;
		}

		if (typeof options.index === 'number') {
			this.index = options.index;
		}

		if (typeof options.ignoreOverrides === 'boolean') {
			this.ignoreOverrides = options.ignoreOverrides;
		}

		if (typeof options.context === 'number') {
			this.context = options.context;
		}

		return this;
	}
}

/**
 * Base Text Editor Options.
 */
export class TextEditorOptions extends EditorOptions implements ITextEditorOptions {

	/**
	 * Text editor selection.
	 */
	selection: ITextEditorSelection | undefined;

	/**
	 * Text editor view state.
	 */
	editorViewState: IEditorViewState | undefined;

	/**
	 * Option to control the text editor selection reveal type.
	 */
	selectionRevealType: TextEditorSelectionRevealType | undefined;

	static from(input?: IBaseResourceInput): TextEditorOptions | undefined {
		if (!input || !input.options) {
			return undefined;
		}

		return TextEditorOptions.create(input.options);
	}

	/**
	 * Helper to convert options bag to real class
	 */
	static create(options: ITextEditorOptions = Object.create(null)): TextEditorOptions {
		const textEditorOptions = new TextEditorOptions();
		textEditorOptions.overwrite(options);

		return textEditorOptions;
	}

	/**
	 * Overwrites option values from the provided bag.
	 */
	overwrite(options: ITextEditorOptions): TextEditorOptions {
		super.overwrite(options);

		if (options.selection) {
			this.selection = {
				startLineNumber: options.selection.startLineNumber,
				startColumn: options.selection.startColumn,
				endLineNumber: options.selection.endLineNumber ?? options.selection.startLineNumber,
				endColumn: options.selection.endColumn ?? options.selection.startColumn
			};
		}

		if (options.viewState) {
			this.editorViewState = options.viewState as IEditorViewState;
		}

		if (typeof options.selectionRevealType !== 'undefined') {
			this.selectionRevealType = options.selectionRevealType;
		}

		return this;
	}

	/**
	 * Returns if this options object has objects defined for the editor.
	 */
	hasOptionsDefined(): boolean {
		return !!this.editorViewState || !!this.selectionRevealType || !!this.selection;
	}

	/**
	 * Create a TextEditorOptions inline to be used when the editor is opening.
	 */
	static fromEditor(editor: ICodeEditor, settings?: IEditorOptions): TextEditorOptions {
		const options = TextEditorOptions.create(settings);

		// View state
		options.editorViewState = withNullAsUndefined(editor.saveViewState());

		return options;
	}

	/**
	 * Apply the view state or selection to the given editor.
	 *
	 * @return if something was applied
	 */
	apply(editor: ICodeEditor, scrollType: ScrollType): boolean {
		let gotApplied = false;

		// First try viewstate
		if (this.editorViewState) {
			editor.restoreViewState(this.editorViewState);
			gotApplied = true;
		}

		// Otherwise check for selection
		else if (this.selection) {
			const range: IRange = {
				startLineNumber: this.selection.startLineNumber,
				startColumn: this.selection.startColumn,
				endLineNumber: this.selection.endLineNumber ?? this.selection.startLineNumber,
				endColumn: this.selection.endColumn ?? this.selection.startColumn
			};

			editor.setSelection(range);

			if (this.selectionRevealType === TextEditorSelectionRevealType.NearTop) {
				editor.revealRangeNearTop(range, scrollType);
			} else if (this.selectionRevealType === TextEditorSelectionRevealType.CenterIfOutsideViewport) {
				editor.revealRangeInCenterIfOutsideViewport(range, scrollType);
			} else {
				editor.revealRangeInCenter(range, scrollType);
			}

			gotApplied = true;
		}

		return gotApplied;
	}
}

export interface IEditorIdentifier {
	groupId: GroupIdentifier;
	editor: IEditorInput;
}

/**
 * The editor commands context is used for editor commands (e.g. in the editor title)
 * and we must ensure that the context is serializable because it potentially travels
 * to the extension host!
 */
export interface IEditorCommandsContext {
	groupId: GroupIdentifier;
	editorIndex?: number;
}

export class EditorCommandsContextActionRunner extends ActionRunner {

	constructor(
		private context: IEditorCommandsContext
	) {
		super();
	}

	run(action: IAction): Promise<void> {
		return super.run(action, this.context);
	}
}

export interface IEditorCloseEvent extends IEditorIdentifier {
	replaced: boolean;
	index: number;
}

export type GroupIdentifier = number;

export interface IWorkbenchEditorConfiguration {
	workbench: {
		editor: IEditorPartConfiguration,
		iconTheme: string;
	};
}

interface IEditorPartConfiguration {
	showTabs?: boolean;
	highlightModifiedTabs?: boolean;
	tabCloseButton?: 'left' | 'right' | 'off';
	tabSizing?: 'fit' | 'shrink';
	focusRecentEditorAfterClose?: boolean;
	showIcons?: boolean;
	enablePreview?: boolean;
	enablePreviewFromQuickOpen?: boolean;
	closeOnFileDelete?: boolean;
	openPositioning?: 'left' | 'right' | 'first' | 'last';
	openSideBySideDirection?: 'right' | 'down';
	closeEmptyGroups?: boolean;
	revealIfOpen?: boolean;
	mouseBackForwardToNavigate?: boolean;
	labelFormat?: 'default' | 'short' | 'medium' | 'long';
	restoreViewState?: boolean;
	splitSizing?: 'split' | 'distribute';
	limit?: {
		enabled?: boolean;
		value?: number;
		perEditorGroup?: boolean;
	};
}

export interface IEditorPartOptions extends IEditorPartConfiguration {
	iconTheme?: string;
}

export interface IEditorPartOptionsChangeEvent {
	oldPartOptions: IEditorPartOptions;
	newPartOptions: IEditorPartOptions;
}

export enum SideBySideEditor {
	MASTER = 1,
	DETAILS = 2
}

export interface IResourceOptions {
	supportSideBySide?: SideBySideEditor;
	filterByScheme?: string | string[];
}

export function toResource(editor: IEditorInput | undefined, options?: IResourceOptions): URI | undefined {
	if (!editor) {
		return undefined;
	}

	if (options?.supportSideBySide && editor instanceof SideBySideEditorInput) {
		editor = options.supportSideBySide === SideBySideEditor.MASTER ? editor.master : editor.details;
	}

	const resource = editor.getResource();
	if (!resource || !options || !options.filterByScheme) {
		return resource;
	}

	if (Array.isArray(options.filterByScheme) && options.filterByScheme.some(scheme => resource.scheme === scheme)) {
		return resource;
	}

	if (options.filterByScheme === resource.scheme) {
		return resource;
	}

	return undefined;
}

export const enum CloseDirection {
	LEFT,
	RIGHT
}

export interface IEditorMemento<T> {

	saveEditorState(group: IEditorGroup, resource: URI, state: T): void;
	saveEditorState(group: IEditorGroup, editor: EditorInput, state: T): void;

	loadEditorState(group: IEditorGroup, resource: URI): T | undefined;
	loadEditorState(group: IEditorGroup, editor: EditorInput): T | undefined;

	clearEditorState(resource: URI, group?: IEditorGroup): void;
	clearEditorState(editor: EditorInput, group?: IEditorGroup): void;
}

class EditorInputFactoryRegistry implements IEditorInputFactoryRegistry {
	private instantiationService: IInstantiationService | undefined;
	private fileInputFactory: IFileInputFactory | undefined;

	private readonly editorInputFactoryConstructors: Map<string, IConstructorSignature0<IEditorInputFactory>> = new Map();
	private readonly editorInputFactoryInstances: Map<string, IEditorInputFactory> = new Map();

	start(accessor: ServicesAccessor): void {
		const instantiationService = this.instantiationService = accessor.get(IInstantiationService);

		this.editorInputFactoryConstructors.forEach((ctor, key) => {
			this.createEditorInputFactory(key, ctor, instantiationService);
		});

		this.editorInputFactoryConstructors.clear();
	}

	private createEditorInputFactory(editorInputId: string, ctor: IConstructorSignature0<IEditorInputFactory>, instantiationService: IInstantiationService): void {
		const instance = instantiationService.createInstance(ctor);
		this.editorInputFactoryInstances.set(editorInputId, instance);
	}

	registerFileInputFactory(factory: IFileInputFactory): void {
		this.fileInputFactory = factory;
	}

	getFileInputFactory(): IFileInputFactory {
		return assertIsDefined(this.fileInputFactory);
	}

	registerEditorInputFactory(editorInputId: string, ctor: IConstructorSignature0<IEditorInputFactory>): IDisposable {
		if (!this.instantiationService) {
			this.editorInputFactoryConstructors.set(editorInputId, ctor);
		} else {
			this.createEditorInputFactory(editorInputId, ctor, this.instantiationService);

		}

		return toDisposable(() => {
			this.editorInputFactoryConstructors.delete(editorInputId);
			this.editorInputFactoryInstances.delete(editorInputId);
		});
	}

	getEditorInputFactory(editorInputId: string): IEditorInputFactory | undefined {
		return this.editorInputFactoryInstances.get(editorInputId);
	}
}

export const Extensions = {
	EditorInputFactories: 'workbench.contributions.editor.inputFactories'
};

Registry.add(Extensions.EditorInputFactories, new EditorInputFactoryRegistry());

export async function pathsToEditors(paths: IPathData[] | undefined, fileService: IFileService): Promise<(IResourceInput | IUntitledTextResourceInput)[]> {
	if (!paths || !paths.length) {
		return [];
	}

	const editors = await Promise.all(paths.map(async path => {
		const resource = URI.revive(path.fileUri);
		if (!resource || !fileService.canHandleResource(resource)) {
			return;
		}

		const exists = (typeof path.exists === 'boolean') ? path.exists : await fileService.exists(resource);

		const options: ITextEditorOptions = (exists && typeof path.lineNumber === 'number') ? {
			selection: {
				startLineNumber: path.lineNumber,
				startColumn: path.columnNumber || 1
			},
			pinned: true
		} : { pinned: true };

		let input: IResourceInput | IUntitledTextResourceInput;
		if (!exists) {
			input = { resource, options, forceUntitled: true };
		} else {
			input = { resource, options, forceFile: true };
		}

		return input;
	}));

	return coalesce(editors);
}

export const enum EditorsOrder {

	/**
	 * Editors sorted by most recent activity (most recent active first)
	 */
	MOST_RECENTLY_ACTIVE,

	/**
	 * Editors sorted by sequential order
	 */
	SEQUENTIAL
}
