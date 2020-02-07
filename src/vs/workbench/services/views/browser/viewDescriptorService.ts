/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ViewContainerLocation, IViewDescriptorService, ViewContainer, IViewsRegistry, IViewContainersRegistry, IViewDescriptor, Extensions as ViewExtensions, IViewDescriptorCollection } from 'vs/workbench/common/views';
import { IContextKey, RawContextKey, IContextKeyService, IReadableSet, IContextKeyChangeEvent } from 'vs/platform/contextkey/common/contextkey';
import { IStorageService, StorageScope, IWorkspaceStorageChangeEvent } from 'vs/platform/storage/common/storage';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { Registry } from 'vs/platform/registry/common/platform';
import { toDisposable, DisposableStore, Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { Event, Emitter } from 'vs/base/common/event';
import { firstIndex } from 'vs/base/common/arrays';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { VIEW_ID as SEARCH_VIEW_ID } from 'vs/workbench/services/search/common/search';

class CounterSet<T> implements IReadableSet<T> {

	private map = new Map<T, number>();

	add(value: T): CounterSet<T> {
		this.map.set(value, (this.map.get(value) || 0) + 1);
		return this;
	}

	delete(value: T): boolean {
		let counter = this.map.get(value) || 0;

		if (counter === 0) {
			return false;
		}

		counter--;

		if (counter === 0) {
			this.map.delete(value);
		} else {
			this.map.set(value, counter);
		}

		return true;
	}

	has(value: T): boolean {
		return this.map.has(value);
	}
}

interface IViewItem {
	viewDescriptor: IViewDescriptor;
	active: boolean;
}

class ViewDescriptorCollection extends Disposable implements IViewDescriptorCollection {

	private contextKeys = new CounterSet<string>();
	private items: IViewItem[] = [];

	private _onDidChangeViews: Emitter<{ added: IViewDescriptor[], removed: IViewDescriptor[]; }> = this._register(new Emitter<{ added: IViewDescriptor[], removed: IViewDescriptor[]; }>());
	readonly onDidChangeViews: Event<{ added: IViewDescriptor[], removed: IViewDescriptor[]; }> = this._onDidChangeViews.event;

	private _onDidChangeActiveViews: Emitter<{ added: IViewDescriptor[], removed: IViewDescriptor[]; }> = this._register(new Emitter<{ added: IViewDescriptor[], removed: IViewDescriptor[]; }>());
	readonly onDidChangeActiveViews: Event<{ added: IViewDescriptor[], removed: IViewDescriptor[]; }> = this._onDidChangeActiveViews.event;

	get activeViewDescriptors(): IViewDescriptor[] {
		return this.items
			.filter(i => i.active)
			.map(i => i.viewDescriptor);
	}

	get allViewDescriptors(): IViewDescriptor[] {
		return this.items.map(i => i.viewDescriptor);
	}

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
	) {
		super();
		this._register(Event.filter(contextKeyService.onDidChangeContext, e => e.affectsSome(this.contextKeys))(this.onContextChanged, this));
	}

	addViews(viewDescriptors: IViewDescriptor[]): void {
		const added: IViewDescriptor[] = [];

		for (const viewDescriptor of viewDescriptors) {
			const item = {
				viewDescriptor,
				active: this.isViewDescriptorActive(viewDescriptor) // TODO: should read from some state?
			};

			this.items.push(item);

			if (viewDescriptor.when) {
				for (const key of viewDescriptor.when.keys()) {
					this.contextKeys.add(key);
				}
			}

			if (item.active) {
				added.push(viewDescriptor);
			}
		}

		this._onDidChangeViews.fire({ added: viewDescriptors, removed: [] });

		if (added.length) {
			this._onDidChangeActiveViews.fire({ added, removed: [] });
		}
	}

	removeViews(viewDescriptors: IViewDescriptor[]): void {
		const removed: IViewDescriptor[] = [];

		for (const viewDescriptor of viewDescriptors) {
			const index = firstIndex(this.items, i => i.viewDescriptor.id === viewDescriptor.id);

			if (index === -1) {
				continue;
			}

			const item = this.items[index];
			this.items.splice(index, 1);

			if (viewDescriptor.when) {
				for (const key of viewDescriptor.when.keys()) {
					this.contextKeys.delete(key);
				}
			}

			if (item.active) {
				removed.push(viewDescriptor);
			}
		}

		this._onDidChangeViews.fire({ added: [], removed: viewDescriptors });

		if (removed.length) {
			this._onDidChangeActiveViews.fire({ added: [], removed });
		}
	}

	private onContextChanged(event: IContextKeyChangeEvent): void {
		const removed: IViewDescriptor[] = [];
		const added: IViewDescriptor[] = [];

		for (const item of this.items) {
			const active = this.isViewDescriptorActive(item.viewDescriptor);

			if (item.active !== active) {
				if (active) {
					added.push(item.viewDescriptor);
				} else {
					removed.push(item.viewDescriptor);
				}
			}

			item.active = active;
		}

		if (added.length || removed.length) {
			this._onDidChangeActiveViews.fire({ added, removed });
		}
	}

	private isViewDescriptorActive(viewDescriptor: IViewDescriptor): boolean {
		return !viewDescriptor.when || this.contextKeyService.contextMatchesRules(viewDescriptor.when);
	}
}

interface ICachedViewContainerInfo {
	containerId: string;
	location?: ViewContainerLocation;
	sourceViewId?: string;
}

export class ViewDescriptorService extends Disposable implements IViewDescriptorService {

	_serviceBrand: undefined;

	private static readonly CACHED_VIEW_POSITIONS = 'views.cachedViewPositions';
	private static readonly COMMON_CONTAINER_ID_PREFIX = 'workbench.views.service';

	private readonly _onDidChangeContainer: Emitter<{ views: IViewDescriptor[], from: ViewContainer, to: ViewContainer }> = this._register(new Emitter<{ views: IViewDescriptor[], from: ViewContainer, to: ViewContainer }>());
	readonly onDidChangeContainer: Event<{ views: IViewDescriptor[], from: ViewContainer, to: ViewContainer }> = this._onDidChangeContainer.event;

	private readonly _onDidChangeLocation: Emitter<{ views: IViewDescriptor[], from: ViewContainerLocation, to: ViewContainerLocation }> = this._register(new Emitter<{ views: IViewDescriptor[], from: ViewContainerLocation, to: ViewContainerLocation }>());
	readonly onDidChangeLocation: Event<{ views: IViewDescriptor[], from: ViewContainerLocation, to: ViewContainerLocation }> = this._onDidChangeLocation.event;

	private readonly viewDescriptorCollections: Map<ViewContainer, { viewDescriptorCollection: ViewDescriptorCollection, disposable: IDisposable; }>;
	private readonly activeViewContextKeys: Map<string, IContextKey<boolean>>;
	private readonly movableViewContextKeys: Map<string, IContextKey<boolean>>;

	private readonly viewsRegistry: IViewsRegistry;
	private readonly viewContainersRegistry: IViewContainersRegistry;

	private cachedViewInfo: Map<string, ICachedViewContainerInfo>;
	private generatedContainerSourceViewIds: Map<string, string>;

	private _cachedViewPositionsValue: string | undefined;
	private get cachedViewPositionsValue(): string {
		if (!this._cachedViewPositionsValue) {
			this._cachedViewPositionsValue = this.getStoredCachedViewPositionsValue();
		}

		return this._cachedViewPositionsValue;
	}

	private set cachedViewPositionsValue(value: string) {
		if (this.cachedViewPositionsValue !== value) {
			this._cachedViewPositionsValue = value;
			this.setStoredCachedViewPositionsValue(value);
		}
	}

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IStorageService private readonly storageService: IStorageService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();

		this.viewDescriptorCollections = new Map<ViewContainer, { viewDescriptorCollection: ViewDescriptorCollection, disposable: IDisposable; }>();
		this.activeViewContextKeys = new Map<string, IContextKey<boolean>>();
		this.movableViewContextKeys = new Map<string, IContextKey<boolean>>();

		this.viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
		this.viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
		this.generatedContainerSourceViewIds = new Map<string, string>();

		this.cachedViewInfo = this.getCachedViewPositions();

		// Register all containers that were registered before this ctor
		this.viewContainersRegistry.all.forEach(viewContainer => this.onDidRegisterViewContainer(viewContainer));

		this._register(this.viewsRegistry.onViewsRegistered(({ views, viewContainer }) => this.onDidRegisterViews(views, viewContainer)));
		this._register(this.viewsRegistry.onViewsDeregistered(({ views, viewContainer }) => this.onDidDeregisterViews(views, viewContainer)));

		this._register(this.viewsRegistry.onDidChangeContainer(({ views, from, to }) => this.moveViews(views, from, to)));

		this._register(this.viewContainersRegistry.onDidRegister(({ viewContainer }) => this.onDidRegisterViewContainer(viewContainer)));
		this._register(this.viewContainersRegistry.onDidDeregister(({ viewContainer }) => this.onDidDeregisterViewContainer(viewContainer)));
		this._register(toDisposable(() => {
			this.viewDescriptorCollections.forEach(({ disposable }) => disposable.dispose());
			this.viewDescriptorCollections.clear();
		}));

		this._register(this.storageService.onDidChangeStorage((e) => { this.onDidStorageChange(e); }));

		this._register(this.extensionService.onDidRegisterExtensions(() => this.onDidRegisterExtensions()));

		this._register(this.configurationService.onDidChangeConfiguration((changeEvent) => {
			if (changeEvent.affectedKeys.find(key => key === 'workbench.view.experimental.allowMovingToNewContainer')) {
				if (this.viewsCanMoveSettingValue) {
					return;
				}

				// update all moved views to their default locations
				for (const viewId of this.cachedViewInfo.keys()) {
					if (viewId === SEARCH_VIEW_ID) {
						continue;
					}

					const viewDescriptor = this.getViewDescriptor(viewId);
					const viewLocation = this.getViewContainer(viewId);
					const defaultLocation = this.getDefaultContainer(viewId);

					if (viewDescriptor && viewLocation && defaultLocation && defaultLocation !== viewLocation) {
						this.moveViews([viewDescriptor], viewLocation, defaultLocation);
					}
				}
			}
		}));
	}

	private get viewsCanMoveSettingValue(): boolean {
		return !!this.configurationService.getValue<boolean>('workbench.view.experimental.allowMovingToNewContainer');
	}

	private registerGroupedViews(groupedViews: Map<string, { cachedContainerInfo?: ICachedViewContainerInfo, views: IViewDescriptor[] }>): void {
		// Register views that have already been registered to their correct view containers
		for (const containerId of groupedViews.keys()) {
			const viewContainer = this.viewContainersRegistry.get(containerId);
			const containerData = groupedViews.get(containerId)!;

			// The container has not been registered yet
			if (!viewContainer || !this.viewDescriptorCollections.has(viewContainer)) {
				if (containerData.cachedContainerInfo && this.shouldGenerateContainer(containerData.cachedContainerInfo)) {
					const containerInfo = containerData.cachedContainerInfo;

					const sourceViewDescriptor = this.viewsRegistry.getView(containerInfo.sourceViewId!);
					if (sourceViewDescriptor && !this.viewContainersRegistry.get(containerId)) {
						this.registerViewContainerForSingleView(sourceViewDescriptor, containerInfo.location!);
					}
				}

				continue;
			}

			this.addViews(viewContainer, containerData.views);
		}
	}

	private deregisterGroupedViews(groupedViews: Map<string, { cachedContainerInfo?: ICachedViewContainerInfo, views: IViewDescriptor[] }>): void {
		// Register views that have already been registered to their correct view containers
		for (const viewContainerId of groupedViews.keys()) {
			const viewContainer = this.viewContainersRegistry.get(viewContainerId);

			// The container has not been registered yet
			if (!viewContainer || !this.viewDescriptorCollections.has(viewContainer)) {
				continue;
			}

			this.removeViews(viewContainer, groupedViews.get(viewContainerId)!.views);
		}
	}

	private onDidRegisterExtensions(): void {
		for (const [viewId, containerInfo] of this.cachedViewInfo.entries()) {
			const containerId = containerInfo.containerId;

			// check if cached view container is registered
			if (this.viewContainersRegistry.get(containerId)) {
				continue;
			}

			// check if we should generate this container
			if (this.shouldGenerateContainer(containerInfo)) {
				const sourceView = this.getViewDescriptor(containerInfo.sourceViewId!);

				if (sourceView) {
					this.registerViewContainerForSingleView(sourceView, containerInfo.location!);
					continue;
				}
			}

			// check if view has been registered to default location
			const viewContainer = this.viewsRegistry.getViewContainer(viewId);
			const viewDescriptor = this.getViewDescriptor(viewId);
			if (viewContainer && viewDescriptor) {
				this.addViews(viewContainer, [viewDescriptor]);

				const newLocation = this.getViewContainerLocation(viewContainer);
				if (containerInfo.location && containerInfo.location !== newLocation) {
					this._onDidChangeLocation.fire({ views: [viewDescriptor], from: containerInfo.location, to: newLocation });
				}
			}
		}

		this.saveViewPositionsToCache();
	}

	private onDidRegisterViews(views: IViewDescriptor[], viewContainer: ViewContainer): void {
		// When views are registered, we need to regroup them based on the cache
		const regroupedViews = this.regroupViews(viewContainer.id, views);

		// Once they are grouped, try registering them which occurs
		// if the container has already been registered within this service
		// or we can generate the container from the source view id
		this.registerGroupedViews(regroupedViews);

		views.forEach(viewDescriptor => this.getOrCreateMovableViewContextKey(viewDescriptor).set(!!viewDescriptor.canMoveView));
	}

	private shouldGenerateContainer(containerInfo: ICachedViewContainerInfo): boolean {
		return !!containerInfo.sourceViewId && containerInfo.location !== undefined && (this.viewsCanMoveSettingValue || containerInfo.sourceViewId === SEARCH_VIEW_ID);
	}

	private onDidDeregisterViews(views: IViewDescriptor[], viewContainer: ViewContainer): void {
		// When views are registered, we need to regroup them based on the cache
		const regroupedViews = this.regroupViews(viewContainer.id, views);
		this.deregisterGroupedViews(regroupedViews);
		views.forEach(viewDescriptor => this.getOrCreateMovableViewContextKey(viewDescriptor).set(false));
	}

	private regroupViews(containerId: string, views: IViewDescriptor[]): Map<string, { cachedContainerInfo?: ICachedViewContainerInfo, views: IViewDescriptor[] }> {
		const ret = new Map<string, { cachedContainerInfo?: ICachedViewContainerInfo, views: IViewDescriptor[] }>();

		views.forEach(viewDescriptor => {
			const containerInfo = this.cachedViewInfo.get(viewDescriptor.id);
			const correctContainerId = containerInfo?.containerId || containerId;

			const containerData = ret.get(correctContainerId) || { cachedContainerInfo: containerInfo, views: [] };
			containerData.views.push(viewDescriptor);
			ret.set(correctContainerId, containerData);
		});

		return ret;
	}

	getViewDescriptor(viewId: string): IViewDescriptor | null {
		return this.viewsRegistry.getView(viewId);
	}

	getViewLocation(viewId: string): ViewContainerLocation | null {
		const cachedInfo = this.cachedViewInfo.get(viewId);

		if (cachedInfo && cachedInfo.location) {
			return cachedInfo.location;
		}

		const container = cachedInfo?.containerId ?
			this.viewContainersRegistry.get(cachedInfo.containerId) ?? null :
			this.viewsRegistry.getViewContainer(viewId);

		if (!container) {
			return null;
		}

		return this.getViewContainerLocation(container);
	}

	getViewContainer(viewId: string): ViewContainer | null {
		const containerId = this.cachedViewInfo.get(viewId)?.containerId;

		return containerId ?
			this.viewContainersRegistry.get(containerId) ?? null :
			this.viewsRegistry.getViewContainer(viewId);
	}

	getViewContainerLocation(viewContainer: ViewContainer): ViewContainerLocation {
		return this.viewContainersRegistry.getViewContainerLocation(viewContainer);
	}

	getDefaultContainer(viewId: string): ViewContainer | null {
		return this.viewsRegistry.getViewContainer(viewId) ?? null;
	}

	getViewDescriptors(container: ViewContainer): ViewDescriptorCollection {
		return this.getOrRegisterViewDescriptorCollection(container);
	}

	moveViewToLocation(view: IViewDescriptor, location: ViewContainerLocation): void {
		const previousContainer = this.getViewContainer(view.id);
		if (previousContainer && this.getViewContainerLocation(previousContainer) === location) {
			return;
		}

		let container = this.getDefaultContainer(view.id)!;
		if (this.getViewContainerLocation(container) !== location) {
			container = this.registerViewContainerForSingleView(view, location);
		}

		this.moveViewsToContainer([view], container);
	}

	moveViewsToContainer(views: IViewDescriptor[], viewContainer: ViewContainer): void {
		if (!views.length) {
			return;
		}

		const from = this.getViewContainer(views[0].id);
		const to = viewContainer;

		if (from && to && from !== to) {
			this.moveViews(views, from, to);
		}
	}

	private moveViews(views: IViewDescriptor[], from: ViewContainer, to: ViewContainer, skipCacheUpdate?: boolean): void {
		this.removeViews(from, views);
		this.addViews(to, views);

		const oldLocation = this.getViewContainerLocation(from);
		const newLocation = this.getViewContainerLocation(to);

		if (oldLocation !== newLocation) {
			this._onDidChangeLocation.fire({ views, from: oldLocation, to: newLocation });
		}

		this._onDidChangeContainer.fire({ views, from, to });

		if (!skipCacheUpdate) {
			this.saveViewPositionsToCache();
		}
	}

	private registerViewContainerForSingleView(sourceView: IViewDescriptor, location: ViewContainerLocation): ViewContainer {
		const id = this.generateContainerIdFromSourceViewId(sourceView.id, location);

		return this.viewContainersRegistry.registerViewContainer({
			id,
			ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [id, `${id}.state`, { mergeViewWithContainerWhenSingleView: true }]),
			name: sourceView.name,
			icon: sourceView.containerIcon,
			hideIfEmpty: true
		}, location);
	}

	private getCachedViewPositions(): Map<string, ICachedViewContainerInfo> {
		const result = new Map<string, ICachedViewContainerInfo>(JSON.parse(this.cachedViewPositionsValue));

		// Sanitize cache
		for (const [viewId, containerInfo] of result.entries()) {
			if (!containerInfo) {
				result.delete(viewId);
			}
		}

		return result;
	}

	private onDidStorageChange(e: IWorkspaceStorageChangeEvent): void {
		if (e.key === ViewDescriptorService.CACHED_VIEW_POSITIONS && e.scope === StorageScope.GLOBAL
			&& this.cachedViewPositionsValue !== this.getStoredCachedViewPositionsValue() /* This checks if current window changed the value or not */) {
			this._cachedViewPositionsValue = this.getStoredCachedViewPositionsValue();

			const newCachedPositions = this.getCachedViewPositions();

			for (let viewId of newCachedPositions.keys()) {
				const viewDescriptor = this.getViewDescriptor(viewId);
				if (!viewDescriptor) {
					continue;
				}

				const prevViewContainer = this.getViewContainer(viewId);
				const newViewContainerInfo = newCachedPositions.get(viewId)!;
				// Verify if we need to create the destination container
				if (newViewContainerInfo.sourceViewId) {
					const sourceViewDescriptor = this.getViewDescriptor(newViewContainerInfo.sourceViewId);

					if (!this.viewContainersRegistry.get(newViewContainerInfo.containerId) && sourceViewDescriptor) {
						this.registerViewContainerForSingleView(sourceViewDescriptor, newViewContainerInfo.location!);
					}
				}

				// Try moving to the new container
				const newViewContainer = this.viewContainersRegistry.get(newViewContainerInfo.containerId);
				if (prevViewContainer && newViewContainer && newViewContainer !== prevViewContainer) {
					const viewDescriptor = this.getViewDescriptor(viewId);
					if (viewDescriptor) {
						this.moveViews([viewDescriptor], prevViewContainer, newViewContainer);
					}
				}
			}

			this.cachedViewInfo = this.getCachedViewPositions();
		}
	}

	// Generated Container Id Format
	// {Common Prefix}.{Uniqueness Id}.{Source View Id}
	private generateContainerIdFromSourceViewId(viewId: string, location: ViewContainerLocation): string {
		const result = `${ViewDescriptorService.COMMON_CONTAINER_ID_PREFIX}.${location === ViewContainerLocation.Panel ? 'panel' : 'sidebar'}.${viewId}`;
		this.generatedContainerSourceViewIds.set(result, viewId);
		return result;
	}

	private getStoredCachedViewPositionsValue(): string {
		return this.storageService.get(ViewDescriptorService.CACHED_VIEW_POSITIONS, StorageScope.GLOBAL, '[]');
	}

	private setStoredCachedViewPositionsValue(value: string): void {
		this.storageService.store(ViewDescriptorService.CACHED_VIEW_POSITIONS, value, StorageScope.GLOBAL);
	}

	private saveViewPositionsToCache(): void {
		this.viewContainersRegistry.all.forEach(viewContainer => {
			const viewDescriptorCollection = this.getViewDescriptors(viewContainer);
			viewDescriptorCollection.allViewDescriptors.forEach(viewDescriptor => {
				const sourceViewId = this.generatedContainerSourceViewIds.get(viewContainer.id);
				const containerLocation = this.getViewContainerLocation(viewContainer);
				this.cachedViewInfo.set(viewDescriptor.id, {
					containerId: viewContainer.id,
					location: containerLocation,
					sourceViewId: sourceViewId
				});
			});
		});

		this.cachedViewPositionsValue = JSON.stringify([...this.cachedViewInfo]);
	}

	private getViewsByContainer(viewContainer: ViewContainer): IViewDescriptor[] {
		const result = this.viewsRegistry.getViews(viewContainer).filter(viewDescriptor => {
			const cachedContainer = this.cachedViewInfo.get(viewDescriptor.id)?.containerId || viewContainer.id;
			return cachedContainer === viewContainer.id;
		});

		for (const [viewId, containerInfo] of this.cachedViewInfo.entries()) {
			if (!containerInfo || containerInfo.containerId !== viewContainer.id) {
				continue;
			}

			if (this.viewsRegistry.getViewContainer(viewId) === viewContainer) {
				continue;
			}

			const viewDescriptor = this.getViewDescriptor(viewId);
			if (viewDescriptor) {
				result.push(viewDescriptor);
			}
		}

		return result;
	}

	private onDidRegisterViewContainer(viewContainer: ViewContainer): void {
		this.getOrRegisterViewDescriptorCollection(viewContainer);
	}

	private getOrRegisterViewDescriptorCollection(viewContainer: ViewContainer): ViewDescriptorCollection {
		let viewDescriptorCollection = this.viewDescriptorCollections.get(viewContainer)?.viewDescriptorCollection;

		if (!viewDescriptorCollection) {
			const disposables = new DisposableStore();
			viewDescriptorCollection = disposables.add(new ViewDescriptorCollection(this.contextKeyService));

			this.onDidChangeActiveViews({ added: viewDescriptorCollection.activeViewDescriptors, removed: [] });
			viewDescriptorCollection.onDidChangeActiveViews(changed => this.onDidChangeActiveViews(changed), this, disposables);

			this.viewDescriptorCollections.set(viewContainer, { viewDescriptorCollection, disposable: disposables });

			const viewsToRegister = this.getViewsByContainer(viewContainer);
			if (viewsToRegister.length) {
				this.addViews(viewContainer, viewsToRegister);
				viewsToRegister.forEach(viewDescriptor => this.getOrCreateMovableViewContextKey(viewDescriptor).set(!!viewDescriptor.canMoveView));
			}
		}

		return viewDescriptorCollection;
	}

	private onDidDeregisterViewContainer(viewContainer: ViewContainer): void {
		const viewDescriptorCollectionItem = this.viewDescriptorCollections.get(viewContainer);
		if (viewDescriptorCollectionItem) {
			viewDescriptorCollectionItem.disposable.dispose();
			this.viewDescriptorCollections.delete(viewContainer);
		}
	}

	private onDidChangeActiveViews({ added, removed }: { added: IViewDescriptor[], removed: IViewDescriptor[]; }): void {
		added.forEach(viewDescriptor => this.getOrCreateActiveViewContextKey(viewDescriptor).set(true));
		removed.forEach(viewDescriptor => this.getOrCreateActiveViewContextKey(viewDescriptor).set(false));
	}

	private addViews(container: ViewContainer, views: IViewDescriptor[]): void {
		// Update in memory cache
		const location = this.getViewContainerLocation(container);
		const sourceViewId = this.generatedContainerSourceViewIds.get(container.id);
		views.forEach(view => {
			this.cachedViewInfo.set(view.id, { containerId: container.id, location, sourceViewId });
		});

		this.getViewDescriptors(container).addViews(views);
	}

	private removeViews(container: ViewContainer, views: IViewDescriptor[]): void {
		this.getViewDescriptors(container).removeViews(views);
	}

	private getOrCreateActiveViewContextKey(viewDescriptor: IViewDescriptor): IContextKey<boolean> {
		const activeContextKeyId = `${viewDescriptor.id}.active`;
		let contextKey = this.activeViewContextKeys.get(activeContextKeyId);
		if (!contextKey) {
			contextKey = new RawContextKey(activeContextKeyId, false).bindTo(this.contextKeyService);
			this.activeViewContextKeys.set(activeContextKeyId, contextKey);
		}
		return contextKey;
	}

	private getOrCreateMovableViewContextKey(viewDescriptor: IViewDescriptor): IContextKey<boolean> {
		const movableViewContextKeyId = `${viewDescriptor.id}.canMove`;
		let contextKey = this.movableViewContextKeys.get(movableViewContextKeyId);
		if (!contextKey) {
			contextKey = new RawContextKey(movableViewContextKeyId, false).bindTo(this.contextKeyService);
			this.movableViewContextKeys.set(movableViewContextKeyId, contextKey);
		}
		return contextKey;
	}
}

registerSingleton(IViewDescriptorService, ViewDescriptorService);
