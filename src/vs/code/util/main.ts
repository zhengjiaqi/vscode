import {on} from './extHostEventManager';
import {setContext, setWebViewContext} from './context';
import {editorFeaturePv} from './statistics';


console.log('----------init-----------------')

export async function mainInit() {
	const webViewContext = window.context;
    const event = webViewContext.event;
    const domReadyRes = await event.send('domReady');
	const context = domReadyRes[0];
	console.log('###context:', context)
	window.renderContext = context;
	setContext(context);
	setWebViewContext(webViewContext);

	on('getSdkPath', () => {
		return context.sdk.typings.current.path;
	})

	on('docs-search.show', (data: any) => {
		console.log('---docs-search.show:', data)
		return webViewContext.event.send('docs-search.show', data);
	})

	on('js-intellisense-statistics', (data: any) => {
		editorFeaturePv(data.actionName);
	})
}
