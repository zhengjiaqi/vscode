
let context: Context;
let webViewContext: WebViewContext;

/**
 * 获取开发者工具上下文
 *
 * @return {Object} context 开发者工具上下文
 */
export function getContext(): Context {
	console.log('----ooogetContext:', context)
    return context;
}

/**
 * 设置开发者工具上下文
 *
 * @param {Object} context 开发者工具上下文
 * @return {Object} context 开发者工具上下文
 */
export function setContext(ctx: Context): Context {
	context = ctx;
	console.log('###setContext:', context)
    return context;
}

/*
 * 获取webView上下文
 *
 * @return {Object} webViewContext webView上下文
 */
export function getWebViewContext(): WebViewContext {
    return webViewContext;
}

/**
 * 设置webView上下文
 *
 * @param {Object} ctx webView上下文
 * @return {Object} webViewContext webView上下文
 */
export function setWebViewContext(ctx: WebViewContext) {
    webViewContext = ctx;
    return webViewContext;
}
