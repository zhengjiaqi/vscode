interface IResolveMap {
	[key: string]: Function;
}
interface IEventListenerMap {
	[key: string]: Array<Function>;
}

// let context: Context;
let resolveMap: IResolveMap = {};
let eventListenerMap: IEventListenerMap = {};


(function init(){
	(<any> process).send({test:1});
	process.on('message', msg => {
		console.log('-----message-res:', msg);
		const eventName = msg.eventName;
		if(eventName && eventListenerMap[eventName]) {
			eventListenerMap[eventName].forEach(async cb => {
				const data = await cb();
				(<any> process).send({eventName, data});
			})
		}
		resolveMap[eventName] && resolveMap[eventName](msg.data);
	});
})();


// /**
//  * 获取开发者工具上下文
//  *
//  * @return {Object} context 开发者工具上下文
//  */
// export function getContext(): Context {
//     return context;
// }

// /**
//  * 设置开发者工具上下文
//  *
//  * @param {Object} context 开发者工具上下文
//  * @return {Object} context 开发者工具上下文
//  */
// export function setContext(ctx: Context): Context {
// 	context = ctx;
//     return context;
// }

// /*
//  * 获取webView上下文
//  *
//  * @return {Object} webViewContext webView上下文
//  */
// export function getExtHostContext() {
//     return extHostContext;
// }

function test() {

}

let extHostContext1 = {
	send(eventName: string, data: object): Promise<any> {
		return new Promise((resolve, reject) => {
			(<any> process).send({eventName, data});
			resolveMap[eventName] = resolve;
		})
	},
	on(eventName: string, cb: Function) {
		if(!eventListenerMap[eventName]){
			eventListenerMap[eventName] = [];
		}
		eventListenerMap[eventName].push(cb);
	}
};

console.log('###context-extHostContext1-1:', extHostContext1)
console.log('###context-extHostContext1-1.send:', extHostContext1.send)


export let extHostContext = {
	aaa:1,
	test,
	send(eventName: string, data: object): Promise<any> {
		return new Promise((resolve, reject) => {
			(<any> process).send({eventName, data});
			resolveMap[eventName] = resolve;
		})
	},
	on(eventName: string, cb: Function) {
		if(!eventListenerMap[eventName]){
			eventListenerMap[eventName] = [];
		}
		eventListenerMap[eventName].push(cb);
	}
};

console.log('###context-extHostContext:', extHostContext)
console.log('###context-extHostContext.send:', extHostContext.send)

console.log('###context-extHostContext1:', extHostContext1)
console.log('###context-extHostContext1.send:', extHostContext1.send)
