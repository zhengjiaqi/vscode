/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/markers';

import { URI } from 'vs/base/common/uri';
import * as dom from 'vs/base/browser/dom';
import { IAction, IActionViewItem, Action } from 'vs/base/common/actions';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IEditorService, SIDE_GROUP, ACTIVE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import Constants from 'vs/workbench/contrib/markers/browser/constants';
import { Marker, ResourceMarkers, RelatedInformation, MarkerChangesEvent } from 'vs/workbench/contrib/markers/browser/markersModel';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { MarkersFilterActionViewItem, MarkersFilterAction, IMarkersFilterActionChangeEvent, IMarkerFilterController } from 'vs/workbench/contrib/markers/browser/markersViewActions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import Messages from 'vs/workbench/contrib/markers/browser/messages';
import { RangeHighlightDecorations } from 'vs/workbench/browser/parts/editor/rangeDecorations';
import { IThemeService, registerThemingParticipant, ITheme, ICssStyleCollector } from 'vs/platform/theme/common/themeService';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IMarkersWorkbenchService } from 'vs/workbench/contrib/markers/browser/markers';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { localize } from 'vs/nls';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { Iterator } from 'vs/base/common/iterator';
import { ITreeElement, ITreeNode, ITreeContextMenuEvent, ITreeRenderer } from 'vs/base/browser/ui/tree/tree';
import { Relay, Event, Emitter } from 'vs/base/common/event';
import { WorkbenchObjectTree, TreeResourceNavigator, IListService, IWorkbenchObjectTreeOptions } from 'vs/platform/list/browser/listService';
import { FilterOptions } from 'vs/workbench/contrib/markers/browser/markersFilterOptions';
import { IExpression } from 'vs/base/common/glob';
import { deepClone } from 'vs/base/common/objects';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { FilterData, Filter, VirtualDelegate, ResourceMarkersRenderer, MarkerRenderer, RelatedInformationRenderer, TreeElement, MarkersTreeAccessibilityProvider, MarkersViewModel, ResourceDragAndDrop } from 'vs/workbench/contrib/markers/browser/markersTreeViewer';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { Separator, ActionViewItem, ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { IMenuService, MenuId } from 'vs/platform/actions/common/actions';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { StandardKeyboardEvent, IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { domEvent } from 'vs/base/browser/event';
import { ResourceLabels } from 'vs/workbench/browser/labels';
import { IMarker } from 'vs/platform/markers/common/markers';
import { withUndefinedAsNull } from 'vs/base/common/types';
import { MementoObject, Memento } from 'vs/workbench/common/memento';
import { IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { PANEL_BACKGROUND } from 'vs/workbench/common/theme';
import { KeyCode } from 'vs/base/common/keyCodes';
import { editorLightBulbForeground, editorLightBulbAutoFixForeground } from 'vs/platform/theme/common/colorRegistry';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IViewDescriptorService } from 'vs/workbench/common/views';

function createResourceMarkersIterator(resourceMarkers: ResourceMarkers): Iterator<ITreeElement<TreeElement>> {
	const markersIt = Iterator.fromArray(resourceMarkers.markers);

	return Iterator.map(markersIt, m => {
		const relatedInformationIt = Iterator.from(m.relatedInformation);
		const children = Iterator.map(relatedInformationIt, r => ({ element: r }));

		return { element: m, children };
	});

}

export class MarkersView extends ViewPane implements IMarkerFilterController {

	private lastSelectedRelativeTop: number = 0;
	private currentActiveResource: URI | null = null;

	private readonly rangeHighlightDecorations: RangeHighlightDecorations;
	private readonly filter: Filter;

	private tree: MarkersTree | undefined;
	private filterActionBar: ActionBar | undefined;
	private messageBoxContainer: HTMLElement | undefined;
	private ariaLabelElement: HTMLElement | undefined;
	private readonly collapseAllAction: IAction;
	private readonly filterAction: MarkersFilterAction;

	private readonly panelState: MementoObject;
	private panelFoucusContextKey: IContextKey<boolean>;

	private _onDidFilter = this._register(new Emitter<void>());
	readonly onDidFilter: Event<void> = this._onDidFilter.event;
	private cachedFilterStats: { total: number; filtered: number; } | undefined = undefined;

	private currentResourceGotAddedToMarkersData: boolean = false;
	readonly markersViewModel: MarkersViewModel;
	private isSmallLayout: boolean = false;

	readonly onDidChangeVisibility = this.onDidChangeBodyVisibility;

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IMarkersWorkbenchService private readonly markersWorkbenchService: IMarkersWorkbenchService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IMenuService private readonly menuService: IMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IStorageService storageService: IStorageService,
	) {
		super({ ...(options as IViewPaneOptions), id: Constants.MARKERS_VIEW_ID, ariaHeaderLabel: Messages.MARKERS_PANEL_TITLE_PROBLEMS }, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService);
		this.panelFoucusContextKey = Constants.MarkerViewFocusContextKey.bindTo(contextKeyService);
		this.panelState = new Memento(Constants.MARKERS_VIEW_STORAGE_ID, storageService).getMemento(StorageScope.WORKSPACE);
		this.markersViewModel = this._register(instantiationService.createInstance(MarkersViewModel, this.panelState['multiline']));
		this._register(this.markersViewModel.onDidChange(marker => this.onDidChangeViewState(marker)));
		this.setCurrentActiveEditor();

		this.filter = new Filter(new FilterOptions());
		this.rangeHighlightDecorations = this._register(this.instantiationService.createInstance(RangeHighlightDecorations));

		// actions
		this.collapseAllAction = this._register(new Action('vs.tree.collapse', localize('collapseAll', "Collapse All"), 'monaco-tree-action codicon-collapse-all', true, async () => this.collapseAll()));
		this.filterAction = this._register(this.instantiationService.createInstance(MarkersFilterAction, {
			filterText: this.panelState['filter'] || '',
			filterHistory: this.panelState['filterHistory'] || [],
			showErrors: this.panelState['showErrors'] !== false,
			showWarnings: this.panelState['showWarnings'] !== false,
			showInfos: this.panelState['showInfos'] !== false,
			excludedFiles: !!this.panelState['useFilesExclude'],
			activeFile: !!this.panelState['activeFile']
		}));
	}

	public renderBody(parent: HTMLElement): void {

		dom.addClass(parent, 'markers-panel');

		const container = dom.append(parent, dom.$('.markers-panel-container'));

		this.createFilterActionBar(container);
		this.createArialLabelElement(container);
		this.createMessageBox(container);
		this.createTree(container);
		this.createListeners();

		this.updateFilter();

		this._register(this.onDidFocus(() => this.panelFoucusContextKey.set(true)));
		this._register(this.onDidBlur(() => this.panelFoucusContextKey.set(false)));

		this._register(this.onDidChangeVisibility(visible => {
			if (visible) {
				this.refreshPanel();
			} else {
				this.rangeHighlightDecorations.removeHighlightRange();
			}
		}));

		this.filterActionBar!.push(this.filterAction);
		this.renderContent();
	}

	public getTitle(): string {
		return Messages.MARKERS_PANEL_TITLE_PROBLEMS;
	}

	public layoutBody(height: number, width: number): void {
		const wasSmallLayout = this.isSmallLayout;
		this.isSmallLayout = width < 600 && height > 100;
		if (this.isSmallLayout !== wasSmallLayout) {
			this.updateActions();
			if (this.filterActionBar) {
				dom.toggleClass(this.filterActionBar.getContainer(), 'hide', !this.isSmallLayout);
			}
		}
		const contentHeight = this.isSmallLayout ? height - 44 : height;
		if (this.tree) {
			this.tree.layout(contentHeight, width);
		}
		if (this.messageBoxContainer) {
			this.messageBoxContainer.style.height = `${contentHeight}px`;
		}
		this.filterAction.layout(this.isSmallLayout ? width : width - 200);
	}

	public focus(): void {
		if (this.tree && this.tree.getHTMLElement() === document.activeElement) {
			return;
		}

		if (this.isEmpty() && this.messageBoxContainer) {
			this.messageBoxContainer.focus();
		} else if (this.tree) {
			this.tree.getHTMLElement().focus();
		}
	}

	public focusFilter(): void {
		this.filterAction.focus();
	}

	public getActions(): IAction[] {
		if (this.isSmallLayout) {
			return [this.collapseAllAction];
		}
		return [this.filterAction, this.collapseAllAction];
	}

	public showQuickFixes(marker: Marker): void {
		const viewModel = this.markersViewModel.getViewModel(marker);
		if (viewModel) {
			viewModel.quickFixAction.run();
		}
	}

	public openFileAtElement(element: any, preserveFocus: boolean, sideByside: boolean, pinned: boolean): boolean {
		const { resource, selection, event, data } = element instanceof Marker ? { resource: element.resource, selection: element.range, event: 'problems.selectDiagnostic', data: this.getTelemetryData(element.marker) } :
			element instanceof RelatedInformation ? { resource: element.raw.resource, selection: element.raw, event: 'problems.selectRelatedInformation', data: this.getTelemetryData(element.marker) } : { resource: null, selection: null, event: null, data: null };
		if (resource && selection && event) {
			/* __GDPR__
			"problems.selectDiagnostic" : {
				"source": { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" },
				"code" : { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" }
			}
			*/
			/* __GDPR__
				"problems.selectRelatedInformation" : {
					"source": { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" },
					"code" : { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" }
				}
			*/
			this.telemetryService.publicLog(event, data);
			this.editorService.openEditor({
				resource,
				options: {
					selection,
					preserveFocus,
					pinned,
					revealIfVisible: true
				},
			}, sideByside ? SIDE_GROUP : ACTIVE_GROUP).then(editor => {
				if (editor && preserveFocus) {
					this.rangeHighlightDecorations.highlightRange({ resource, range: selection }, <ICodeEditor>editor.getControl());
				} else {
					this.rangeHighlightDecorations.removeHighlightRange();
				}
			});
			return true;
		} else {
			this.rangeHighlightDecorations.removeHighlightRange();
		}
		return false;
	}

	private refreshPanel(markerOrChange?: Marker | MarkerChangesEvent): void {
		if (this.isVisible() && this.tree) {
			this.cachedFilterStats = undefined;

			if (markerOrChange) {
				if (markerOrChange instanceof Marker) {
					this.tree.rerender(markerOrChange);
				} else {
					if (markerOrChange.added.length || markerOrChange.removed.length) {
						// Reset complete tree
						this.resetTree();
					} else {
						// Update resource
						for (const updated of markerOrChange.updated) {
							this.tree.setChildren(updated, createResourceMarkersIterator(updated));
						}
					}
				}
			} else {
				// Reset complete tree
				this.resetTree();
			}

			const { total, filtered } = this.getFilterStats();
			this.tree.toggleVisibility(total === 0 || filtered === 0);
			this.renderMessage();
			this._onDidFilter.fire();
		}
	}

	private onDidChangeViewState(marker?: Marker): void {
		this.refreshPanel(marker);
	}

	private resetTree(): void {
		if (!this.tree) {
			return;
		}
		let resourceMarkers: ResourceMarkers[] = [];
		if (this.filterAction.activeFile) {
			if (this.currentActiveResource) {
				const activeResourceMarkers = this.markersWorkbenchService.markersModel.getResourceMarkers(this.currentActiveResource);
				if (activeResourceMarkers) {
					resourceMarkers = [activeResourceMarkers];
				}
			}
		} else {
			resourceMarkers = this.markersWorkbenchService.markersModel.resourceMarkers;
		}
		this.tree.setChildren(null, Iterator.map(Iterator.fromArray(resourceMarkers), m => ({ element: m, children: createResourceMarkersIterator(m) })));
	}

	private updateFilter() {
		this.cachedFilterStats = undefined;
		this.filter.options = new FilterOptions(this.filterAction.filterText, this.getFilesExcludeExpressions(), this.filterAction.showWarnings, this.filterAction.showErrors, this.filterAction.showInfos);
		if (this.tree) {
			this.tree.refilter();
		}
		this._onDidFilter.fire();

		const { total, filtered } = this.getFilterStats();
		if (this.tree) {
			this.tree.toggleVisibility(total === 0 || filtered === 0);
		}
		this.renderMessage();
	}

	private getFilesExcludeExpressions(): { root: URI, expression: IExpression }[] | IExpression {
		if (!this.filterAction.excludedFiles) {
			return [];
		}

		const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
		return workspaceFolders.length
			? workspaceFolders.map(workspaceFolder => ({ root: workspaceFolder.uri, expression: this.getFilesExclude(workspaceFolder.uri) }))
			: this.getFilesExclude();
	}

	private getFilesExclude(resource?: URI): IExpression {
		return deepClone(this.configurationService.getValue('files.exclude', { resource })) || {};
	}

	private createFilterActionBar(parent: HTMLElement): void {
		this.filterActionBar = this._register(new ActionBar(parent, { actionViewItemProvider: action => this.getActionViewItem(action) }));
		dom.addClass(this.filterActionBar.getContainer(), 'markers-panel-filter-container');
		dom.toggleClass(this.filterActionBar.getContainer(), 'hide', !this.isSmallLayout);
	}

	private createMessageBox(parent: HTMLElement): void {
		this.messageBoxContainer = dom.append(parent, dom.$('.message-box-container'));
		this.messageBoxContainer.setAttribute('aria-labelledby', 'markers-panel-arialabel');
	}

	private createArialLabelElement(parent: HTMLElement): void {
		this.ariaLabelElement = dom.append(parent, dom.$(''));
		this.ariaLabelElement.setAttribute('id', 'markers-panel-arialabel');
		this.ariaLabelElement.setAttribute('aria-live', 'polite');
	}

	private createTree(parent: HTMLElement): void {
		const onDidChangeRenderNodeCount = new Relay<ITreeNode<any, any>>();

		const treeLabels = this._register(this.instantiationService.createInstance(ResourceLabels, this));

		const virtualDelegate = new VirtualDelegate(this.markersViewModel);
		const renderers = [
			this.instantiationService.createInstance(ResourceMarkersRenderer, treeLabels, onDidChangeRenderNodeCount.event),
			this.instantiationService.createInstance(MarkerRenderer, this.markersViewModel),
			this.instantiationService.createInstance(RelatedInformationRenderer)
		];
		const accessibilityProvider = this.instantiationService.createInstance(MarkersTreeAccessibilityProvider);

		const identityProvider = {
			getId(element: TreeElement) {
				return element.id;
			}
		};

		this.tree = this._register(this.instantiationService.createInstance(MarkersTree,
			'MarkersView',
			dom.append(parent, dom.$('.tree-container.show-file-icons')),
			virtualDelegate,
			renderers,
			{
				filter: this.filter,
				accessibilityProvider,
				identityProvider,
				dnd: new ResourceDragAndDrop(this.instantiationService),
				expandOnlyOnTwistieClick: (e: TreeElement) => e instanceof Marker && e.relatedInformation.length > 0,
				overrideStyles: {
					listBackground: PANEL_BACKGROUND
				}
			},
		));

		onDidChangeRenderNodeCount.input = this.tree.onDidChangeRenderNodeCount;

		const markerFocusContextKey = Constants.MarkerFocusContextKey.bindTo(this.tree.contextKeyService);
		const relatedInformationFocusContextKey = Constants.RelatedInformationFocusContextKey.bindTo(this.tree.contextKeyService);
		this._register(this.tree.onDidChangeFocus(focus => {
			markerFocusContextKey.set(focus.elements.some(e => e instanceof Marker));
			relatedInformationFocusContextKey.set(focus.elements.some(e => e instanceof RelatedInformation));
		}));

		const markersNavigator = this._register(new TreeResourceNavigator(this.tree, { openOnFocus: true }));
		this._register(Event.debounce(markersNavigator.onDidOpenResource, (last, event) => event, 75, true)(options => {
			this.openFileAtElement(options.element, !!options.editorOptions.preserveFocus, options.sideBySide, !!options.editorOptions.pinned);
		}));
		this._register(this.tree.onDidChangeCollapseState(({ node }) => {
			const { element } = node;
			if (element instanceof RelatedInformation && !node.collapsed) {
				/* __GDPR__
				"problems.expandRelatedInformation" : {
					"source": { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" },
					"code" : { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" }
				}
				*/
				this.telemetryService.publicLog('problems.expandRelatedInformation', this.getTelemetryData(element.marker));
			}
		}));

		this._register(this.tree.onContextMenu(this.onContextMenu, this));

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (this.filterAction.excludedFiles && e.affectsConfiguration('files.exclude')) {
				this.updateFilter();
			}
		}));

		// move focus to input, whenever a key is pressed in the panel container
		this._register(domEvent(parent, 'keydown')(e => {
			if (this.keybindingService.mightProducePrintableCharacter(new StandardKeyboardEvent(e))) {
				this.filterAction.focus();
			}
		}));

		this._register(Event.any<any>(this.tree.onDidChangeSelection, this.tree.onDidChangeFocus)(() => {
			const elements = [...this.tree!.getSelection(), ...this.tree!.getFocus()];
			for (const element of elements) {
				if (element instanceof Marker) {
					const viewModel = this.markersViewModel.getViewModel(element);
					if (viewModel) {
						viewModel.showLightBulb();
					}
				}
			}
		}));
	}

	private collapseAll(): void {
		if (this.tree) {
			this.tree.collapseAll();
			this.tree.setSelection([]);
			this.tree.setFocus([]);
			this.tree.getHTMLElement().focus();
			this.tree.focusFirst();
		}
	}

	private createListeners(): void {
		this._register(Event.any<MarkerChangesEvent | void>(this.markersWorkbenchService.markersModel.onDidChange, this.editorService.onDidActiveEditorChange)(changes => {
			if (changes) {
				this.onDidChangeModel(changes);
			} else {
				this.onActiveEditorChanged();
			}
		}));
		if (this.tree) {
			this._register(this.tree.onDidChangeSelection(() => this.onSelected()));
		}
		this._register(this.filterAction.onDidChange((event: IMarkersFilterActionChangeEvent) => {
			this.reportFilteringUsed();
			if (event.activeFile) {
				this.refreshPanel();
			} else if (event.filterText || event.excludedFiles || event.showWarnings || event.showErrors || event.showInfos) {
				this.updateFilter();
			}
		}));
	}

	private onDidChangeModel(change: MarkerChangesEvent) {
		const resourceMarkers = [...change.added, ...change.removed, ...change.updated];
		const resources: URI[] = [];
		for (const { resource } of resourceMarkers) {
			this.markersViewModel.remove(resource);
			const resourceMarkers = this.markersWorkbenchService.markersModel.getResourceMarkers(resource);
			if (resourceMarkers) {
				for (const marker of resourceMarkers.markers) {
					this.markersViewModel.add(marker);
				}
			}
			resources.push(resource);
		}
		this.currentResourceGotAddedToMarkersData = this.currentResourceGotAddedToMarkersData || this.isCurrentResourceGotAddedToMarkersData(resources);
		this.refreshPanel(change);
		this.updateRangeHighlights();
		if (this.currentResourceGotAddedToMarkersData) {
			this.autoReveal();
			this.currentResourceGotAddedToMarkersData = false;
		}
	}

	private isCurrentResourceGotAddedToMarkersData(changedResources: URI[]) {
		const currentlyActiveResource = this.currentActiveResource;
		if (!currentlyActiveResource) {
			return false;
		}
		const resourceForCurrentActiveResource = this.getResourceForCurrentActiveResource();
		if (resourceForCurrentActiveResource) {
			return false;
		}
		return changedResources.some(r => r.toString() === currentlyActiveResource.toString());
	}

	private onActiveEditorChanged(): void {
		this.setCurrentActiveEditor();
		if (this.filterAction.activeFile) {
			this.refreshPanel();
		}
		this.autoReveal();
	}

	private setCurrentActiveEditor(): void {
		const activeEditor = this.editorService.activeEditor;
		this.currentActiveResource = activeEditor ? withUndefinedAsNull(activeEditor.getResource()) : null;
	}

	private onSelected(): void {
		if (this.tree) {
			let selection = this.tree.getSelection();
			if (selection && selection.length > 0) {
				this.lastSelectedRelativeTop = this.tree!.getRelativeTop(selection[0]) || 0;
			}
		}
	}

	private isEmpty(): boolean {
		const { total, filtered } = this.getFilterStats();
		return total === 0 || filtered === 0;
	}

	private renderContent(): void {
		this.cachedFilterStats = undefined;
		this.resetTree();
		if (this.tree) {
			this.tree.toggleVisibility(this.isEmpty());
		}
		this.renderMessage();
	}

	private renderMessage(): void {
		if (!this.messageBoxContainer || !this.ariaLabelElement) {
			return;
		}
		dom.clearNode(this.messageBoxContainer);
		const { total, filtered } = this.getFilterStats();

		if (filtered === 0) {
			this.messageBoxContainer.style.display = 'block';
			this.messageBoxContainer.setAttribute('tabIndex', '0');
			if (this.filterAction.activeFile) {
				this.renderFilterMessageForActiveFile(this.messageBoxContainer);
			} else {
				if (total > 0) {
					this.renderFilteredByFilterMessage(this.messageBoxContainer);
				} else {
					this.renderNoProblemsMessage(this.messageBoxContainer);
				}
			}
		} else {
			this.messageBoxContainer.style.display = 'none';
			if (filtered === total) {
				this.ariaLabelElement.setAttribute('aria-label', localize('No problems filtered', "Showing {0} problems", total));
			} else {
				this.ariaLabelElement.setAttribute('aria-label', localize('problems filtered', "Showing {0} of {1} problems", filtered, total));
			}
			this.messageBoxContainer.removeAttribute('tabIndex');
		}
	}

	private renderFilterMessageForActiveFile(container: HTMLElement): void {
		if (this.currentActiveResource && this.markersWorkbenchService.markersModel.getResourceMarkers(this.currentActiveResource)) {
			this.renderFilteredByFilterMessage(container);
		} else {
			this.renderNoProblemsMessageForActiveFile(container);
		}
	}

	private renderFilteredByFilterMessage(container: HTMLElement) {
		const span1 = dom.append(container, dom.$('span'));
		span1.textContent = Messages.MARKERS_PANEL_NO_PROBLEMS_FILTERS;
		const link = dom.append(container, dom.$('a.messageAction'));
		link.textContent = localize('clearFilter', "Clear Filters");
		link.setAttribute('tabIndex', '0');
		const span2 = dom.append(container, dom.$('span'));
		span2.textContent = '.';
		dom.addStandardDisposableListener(link, dom.EventType.CLICK, () => this.clearFilters());
		dom.addStandardDisposableListener(link, dom.EventType.KEY_DOWN, (e: IKeyboardEvent) => {
			if (e.equals(KeyCode.Enter) || e.equals(KeyCode.Space)) {
				this.clearFilters();
				e.stopPropagation();
			}
		});
		this.ariaLabelElement!.setAttribute('aria-label', Messages.MARKERS_PANEL_NO_PROBLEMS_FILTERS);
	}

	private renderNoProblemsMessageForActiveFile(container: HTMLElement) {
		const span = dom.append(container, dom.$('span'));
		span.textContent = Messages.MARKERS_PANEL_NO_PROBLEMS_ACTIVE_FILE_BUILT;
		this.ariaLabelElement!.setAttribute('aria-label', Messages.MARKERS_PANEL_NO_PROBLEMS_ACTIVE_FILE_BUILT);
	}

	private renderNoProblemsMessage(container: HTMLElement) {
		const span = dom.append(container, dom.$('span'));
		span.textContent = Messages.MARKERS_PANEL_NO_PROBLEMS_BUILT;
		this.ariaLabelElement!.setAttribute('aria-label', Messages.MARKERS_PANEL_NO_PROBLEMS_BUILT);
	}

	private clearFilters(): void {
		this.filterAction.filterText = '';
		this.filterAction.excludedFiles = false;
		this.filterAction.showErrors = true;
		this.filterAction.showWarnings = true;
		this.filterAction.showInfos = true;
	}

	private autoReveal(focus: boolean = false): void {
		// No need to auto reveal if active file filter is on
		if (this.filterAction.activeFile || !this.tree) {
			return;
		}
		let autoReveal = this.configurationService.getValue<boolean>('problems.autoReveal');
		if (typeof autoReveal === 'boolean' && autoReveal) {
			let currentActiveResource = this.getResourceForCurrentActiveResource();
			if (currentActiveResource) {
				if (!this.tree.isCollapsed(currentActiveResource) && this.hasSelectedMarkerFor(currentActiveResource)) {
					this.tree.reveal(this.tree.getSelection()[0], this.lastSelectedRelativeTop);
					if (focus) {
						this.tree.setFocus(this.tree.getSelection());
					}
				} else {
					this.tree.expand(currentActiveResource);
					this.tree.reveal(currentActiveResource, 0);

					if (focus) {
						this.tree.setFocus([currentActiveResource]);
						this.tree.setSelection([currentActiveResource]);
					}
				}
			} else if (focus) {
				this.tree.setSelection([]);
				this.tree.focusFirst();
			}
		}
	}

	private getResourceForCurrentActiveResource(): ResourceMarkers | null {
		return this.currentActiveResource ? this.markersWorkbenchService.markersModel.getResourceMarkers(this.currentActiveResource) : null;
	}

	private hasSelectedMarkerFor(resource: ResourceMarkers): boolean {
		if (this.tree) {
			let selectedElement = this.tree.getSelection();
			if (selectedElement && selectedElement.length > 0) {
				if (selectedElement[0] instanceof Marker) {
					if (resource.resource.toString() === (<Marker>selectedElement[0]).marker.resource.toString()) {
						return true;
					}
				}
			}
		}
		return false;
	}

	private updateRangeHighlights() {
		this.rangeHighlightDecorations.removeHighlightRange();
		if (this.tree && this.tree.getHTMLElement() === document.activeElement) {
			this.highlightCurrentSelectedMarkerRange();
		}
	}

	private highlightCurrentSelectedMarkerRange() {
		const selections = this.tree ? this.tree.getSelection() : [];

		if (selections.length !== 1) {
			return;
		}

		const selection = selections[0];

		if (!(selection instanceof Marker)) {
			return;
		}

		this.rangeHighlightDecorations.highlightRange(selection);
	}

	private onContextMenu(e: ITreeContextMenuEvent<TreeElement | null>): void {
		const element = e.element;
		if (!element) {
			return;
		}

		e.browserEvent.preventDefault();
		e.browserEvent.stopPropagation();

		this.contextMenuService.showContextMenu({
			getAnchor: () => e.anchor!,
			getActions: () => this.getMenuActions(element),
			getActionViewItem: (action) => {
				const keybinding = this.keybindingService.lookupKeybinding(action.id);
				if (keybinding) {
					return new ActionViewItem(action, action, { label: true, keybinding: keybinding.getLabel() });
				}
				return undefined;
			},
			onHide: (wasCancelled?: boolean) => {
				if (wasCancelled) {
					this.tree!.domFocus();
				}
			}
		});
	}

	private getMenuActions(element: TreeElement): IAction[] {
		const result: IAction[] = [];

		if (element instanceof Marker) {
			const viewModel = this.markersViewModel.getViewModel(element);
			if (viewModel) {
				const quickFixActions = viewModel.quickFixAction.quickFixes;
				if (quickFixActions.length) {
					result.push(...quickFixActions);
					result.push(new Separator());
				}
			}
		}

		const menu = this.menuService.createMenu(MenuId.ProblemsPanelContext, this.tree!.contextKeyService);
		const groups = menu.getActions();
		menu.dispose();

		for (let group of groups) {
			const [, actions] = group;
			result.push(...actions);
			result.push(new Separator());
		}

		result.pop(); // remove last separator
		return result;
	}

	public getFocusElement() {
		return this.tree ? this.tree.getFocus()[0] : undefined;
	}

	public getActionViewItem(action: IAction): IActionViewItem | undefined {
		if (action.id === MarkersFilterAction.ID) {
			return this.instantiationService.createInstance(MarkersFilterActionViewItem, this.filterAction, this);
		}
		return super.getActionViewItem(action);
	}

	getFilterOptions(): FilterOptions {
		return this.filter.options;
	}

	getFilterStats(): { total: number; filtered: number; } {
		if (!this.cachedFilterStats) {
			this.cachedFilterStats = this.computeFilterStats();
		}

		return this.cachedFilterStats;
	}

	private computeFilterStats(): { total: number; filtered: number; } {
		let filtered = 0;
		if (this.tree) {
			const root = this.tree.getNode();

			for (const resourceMarkerNode of root.children) {
				for (const markerNode of resourceMarkerNode.children) {
					if (resourceMarkerNode.visible && markerNode.visible) {
						filtered++;
					}
				}
			}
		}

		return { total: this.markersWorkbenchService.markersModel.total, filtered };
	}

	private getTelemetryData({ source, code }: IMarker): any {
		return { source, code };
	}

	private reportFilteringUsed(): void {
		const data = {
			errors: this.filterAction.showErrors,
			warnings: this.filterAction.showWarnings,
			infos: this.filterAction.showInfos,
			activeFile: this.filterAction.activeFile,
			excludedFiles: this.filterAction.excludedFiles,
		};
		/* __GDPR__
			"problems.filter" : {
				"errors" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"warnings": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"infos": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"activeFile": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"excludedFiles": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
			}
		*/
		this.telemetryService.publicLog('problems.filter', data);
	}

	saveState(): void {
		this.panelState['filter'] = this.filterAction.filterText;
		this.panelState['filterHistory'] = this.filterAction.filterHistory;
		this.panelState['showErrors'] = this.filterAction.showErrors;
		this.panelState['showWarnings'] = this.filterAction.showWarnings;
		this.panelState['showInfos'] = this.filterAction.showInfos;
		this.panelState['useFilesExclude'] = this.filterAction.excludedFiles;
		this.panelState['activeFile'] = this.filterAction.activeFile;
		this.panelState['multiline'] = this.markersViewModel.multiline;

		super.saveState();
	}

}

class MarkersTree extends WorkbenchObjectTree<TreeElement, FilterData> {

	constructor(
		user: string,
		readonly container: HTMLElement,
		delegate: IListVirtualDelegate<TreeElement>,
		renderers: ITreeRenderer<TreeElement, FilterData, any>[],
		options: IWorkbenchObjectTreeOptions<TreeElement, FilterData>,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IAccessibilityService accessibilityService: IAccessibilityService
	) {
		super(user, container, delegate, renderers, options, contextKeyService, listService, themeService, configurationService, keybindingService, accessibilityService);
	}

	layout(height: number, width: number): void {
		this.container.style.height = `${height}px`;
		super.layout(height, width);
	}

	toggleVisibility(hide: boolean): void {
		dom.toggleClass(this.container, 'hidden', hide);
	}

}

registerThemingParticipant((theme: ITheme, collector: ICssStyleCollector) => {

	// Lightbulb Icon
	const editorLightBulbForegroundColor = theme.getColor(editorLightBulbForeground);
	if (editorLightBulbForegroundColor) {
		collector.addRule(`
		.monaco-workbench .markers-panel-container .codicon-lightbulb {
			color: ${editorLightBulbForegroundColor};
		}`);
	}

	// Lightbulb Auto Fix Icon
	const editorLightBulbAutoFixForegroundColor = theme.getColor(editorLightBulbAutoFixForeground);
	if (editorLightBulbAutoFixForegroundColor) {
		collector.addRule(`
		.monaco-workbench .markers-panel-container .codicon-lightbulb-autofix {
			color: ${editorLightBulbAutoFixForegroundColor};
		}`);
	}

});
