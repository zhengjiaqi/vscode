/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/scmViewlet';
import { localize } from 'vs/nls';
import { Event, Emitter } from 'vs/base/common/event';
import { append, $, toggleClass, addClasses } from 'vs/base/browser/dom';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { VIEWLET_ID, ISCMService, ISCMRepository } from 'vs/workbench/contrib/scm/common/scm';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IContextViewService, IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { MenuItemAction } from 'vs/platform/actions/common/actions';
import { IAction, IActionViewItem } from 'vs/base/common/actions';
import { ContextAwareMenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { SCMMenus } from './menus';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IViewsRegistry, Extensions, IViewDescriptorService } from 'vs/workbench/common/views';
import { Registry } from 'vs/platform/registry/common/platform';
import { RepositoryPane, RepositoryViewDescriptor } from 'vs/workbench/contrib/scm/browser/repositoryPane';
import { MainPaneDescriptor, MainPane, IViewModel } from 'vs/workbench/contrib/scm/browser/mainPane';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import type { IAddedViewDescriptorRef } from 'vs/workbench/browser/parts/views/views';
import { debounce } from 'vs/base/common/decorators';

export interface ISpliceEvent<T> {
	index: number;
	deleteCount: number;
	elements: T[];
}

export class SCMViewPaneContainer extends ViewPaneContainer implements IViewModel {

	private static readonly STATE_KEY = 'workbench.scm.views.state';

	private el!: HTMLElement;
	private message: HTMLElement;
	private menus: SCMMenus;
	private _repositories: ISCMRepository[] = [];

	private repositoryCountKey: IContextKey<number>;
	private viewDescriptors: RepositoryViewDescriptor[] = [];

	private readonly _onDidSplice = new Emitter<ISpliceEvent<ISCMRepository>>();
	readonly onDidSplice: Event<ISpliceEvent<ISCMRepository>> = this._onDidSplice.event;

	private _height: number | undefined = undefined;
	get height(): number | undefined { return this._height; }

	get repositories(): ISCMRepository[] {
		return this._repositories;
	}

	get visibleRepositories(): ISCMRepository[] {
		return this.panes.filter(pane => pane instanceof RepositoryPane)
			.map(pane => (pane as RepositoryPane).repository);
	}

	get onDidChangeVisibleRepositories(): Event<ISCMRepository[]> {
		const modificationEvent = Event.debounce(Event.any(this.viewsModel.onDidAdd, this.viewsModel.onDidRemove), () => null, 0);
		return Event.map(modificationEvent, () => this.visibleRepositories);
	}

	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITelemetryService telemetryService: ITelemetryService,
		@ISCMService protected scmService: ISCMService,
		@IInstantiationService protected instantiationService: IInstantiationService,
		@IContextViewService protected contextViewService: IContextViewService,
		@IKeybindingService protected keybindingService: IKeybindingService,
		@INotificationService protected notificationService: INotificationService,
		@IContextMenuService protected contextMenuService: IContextMenuService,
		@IThemeService protected themeService: IThemeService,
		@ICommandService protected commandService: ICommandService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExtensionService extensionService: IExtensionService,
		@IWorkspaceContextService protected contextService: IWorkspaceContextService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService
	) {
		super(VIEWLET_ID, SCMViewPaneContainer.STATE_KEY, { mergeViewWithContainerWhenSingleView: true }, instantiationService, configurationService, layoutService, contextMenuService, telemetryService, extensionService, themeService, storageService, contextService, viewDescriptorService);

		this.menus = instantiationService.createInstance(SCMMenus, undefined);
		this._register(this.menus.onDidChangeTitle(this.updateTitleArea, this));

		this.message = $('.empty-message', { tabIndex: 0 }, localize('no open repo', "No source control providers registered."));

		const viewsRegistry = Registry.as<IViewsRegistry>(Extensions.ViewsRegistry);
		viewsRegistry.registerViews([new MainPaneDescriptor(this)], this.viewContainer);

		this._register(configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('scm.alwaysShowProviders') && configurationService.getValue<boolean>('scm.alwaysShowProviders')) {
				this.viewsModel.setVisible(MainPane.ID, true);
			}
		}));

		this.repositoryCountKey = contextKeyService.createKey('scm.providerCount', 0);

		this._register(this.viewsModel.onDidAdd(this.onDidShowView, this));
		this._register(this.viewsModel.onDidRemove(this.onDidHideView, this));
	}

	create(parent: HTMLElement): void {
		super.create(parent);

		this.el = parent;
		addClasses(parent, 'scm-viewlet', 'empty');
		append(parent, this.message);

		this._register(this.scmService.onDidAddRepository(this.onDidAddRepository, this));
		this._register(this.scmService.onDidRemoveRepository(this.onDidRemoveRepository, this));
		this.scmService.repositories.forEach(r => this.onDidAddRepository(r));
	}

	private onDidAddRepository(repository: ISCMRepository): void {
		const index = this._repositories.length;
		this._repositories.push(repository);

		const viewDescriptor = new RepositoryViewDescriptor(repository, false);
		Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).registerViews([viewDescriptor], this.viewContainer);
		this.viewDescriptors.push(viewDescriptor);

		this._onDidSplice.fire({ index, deleteCount: 0, elements: [repository] });
		this.updateTitleArea();

		this.onDidChangeRepositories();
	}

	private onDidRemoveRepository(repository: ISCMRepository): void {
		const index = this._repositories.indexOf(repository);

		if (index === -1) {
			return;
		}

		Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).deregisterViews([this.viewDescriptors[index]], this.viewContainer);

		this._repositories.splice(index, 1);
		this.viewDescriptors.splice(index, 1);

		this._onDidSplice.fire({ index, deleteCount: 1, elements: [] });
		this.updateTitleArea();

		this.onDidChangeRepositories();
	}

	private onDidChangeRepositories(): void {
		const repositoryCount = this.repositories.length;
		toggleClass(this.el, 'empty', repositoryCount === 0);
		this.repositoryCountKey.set(repositoryCount);
	}

	private onDidShowView(e: IAddedViewDescriptorRef[]): void {
		for (const ref of e) {
			if (ref.viewDescriptor instanceof RepositoryViewDescriptor) {
				ref.viewDescriptor.repository.setSelected(true);
			}
		}
	}

	private onDidHideView(e: IAddedViewDescriptorRef[]): void {
		for (const ref of e) {
			if (ref.viewDescriptor instanceof RepositoryViewDescriptor) {
				ref.viewDescriptor.repository.setSelected(false);
			}
		}

		this.afterOnDidHideView();
	}

	@debounce(0)
	private afterOnDidHideView(): void {
		if (this.repositoryCountKey.get()! > 0 && this.viewDescriptors.every(d => !this.viewsModel.isVisible(d.id))) {
			this.viewsModel.setVisible(this.viewDescriptors[0].id, true);
		}
	}

	focus(): void {
		if (this.repositoryCountKey.get()! === 0) {
			this.message.focus();
		} else {
			const repository = this.visibleRepositories[0];

			if (repository) {
				const pane = this.panes
					.filter(pane => pane instanceof RepositoryPane && pane.repository === repository)[0] as RepositoryPane | undefined;

				if (pane) {
					pane.focus();
				} else {
					super.focus();
				}
			} else {
				super.focus();
			}
		}
	}

	getOptimalWidth(): number {
		return 400;
	}

	getTitle(): string {
		const title = localize('source control', "Source Control");

		if (this.visibleRepositories.length === 1) {
			const [repository] = this.repositories;
			return localize('viewletTitle', "{0}: {1}", title, repository.provider.label);
		} else {
			return title;
		}
	}

	getActionViewItem(action: IAction): IActionViewItem | undefined {
		if (!(action instanceof MenuItemAction)) {
			return undefined;
		}

		return new ContextAwareMenuEntryActionViewItem(action, this.keybindingService, this.notificationService, this.contextMenuService);
	}

	getActions(): IAction[] {
		if (this.repositories.length > 0) {
			return super.getActions();
		}

		return this.menus.getTitleActions();
	}

	getSecondaryActions(): IAction[] {
		if (this.repositories.length > 0) {
			return super.getSecondaryActions();
		}

		return this.menus.getTitleSecondaryActions();
	}

	getActionsContext(): any {
		if (this.visibleRepositories.length === 1) {
			return this.repositories[0].provider;
		}
	}

	setVisibleRepositories(repositories: ISCMRepository[]): void {
		const visibleViewDescriptors = this.viewsModel.visibleViewDescriptors;

		const toSetVisible = this.viewsModel.viewDescriptors
			.filter((d): d is RepositoryViewDescriptor => d instanceof RepositoryViewDescriptor && repositories.indexOf(d.repository) > -1 && visibleViewDescriptors.indexOf(d) === -1);

		const toSetInvisible = visibleViewDescriptors
			.filter((d): d is RepositoryViewDescriptor => d instanceof RepositoryViewDescriptor && repositories.indexOf(d.repository) === -1);

		let size: number | undefined;
		const oneToOne = toSetVisible.length === 1 && toSetInvisible.length === 1;

		for (const viewDescriptor of toSetInvisible) {
			if (oneToOne) {
				const pane = this.panes.filter(pane => pane.id === viewDescriptor.id)[0];

				if (pane) {
					size = this.getPaneSize(pane);
				}
			}

			this.viewsModel.setVisible(viewDescriptor.id, false);
		}

		for (const viewDescriptor of toSetVisible) {
			this.viewsModel.setVisible(viewDescriptor.id, true, size);
		}
	}
}
