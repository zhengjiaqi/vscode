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
	(<any> process).send({pppppppp:1});
	console.log('=========init=========')
	process.on('message', function(m) {
		console.log('CHILD got message:', m);
	});
	process.on('message', msg => {
		console.log('-----message-res:', msg);
		const eventName = msg.eventName;
		if(eventName && eventListenerMap[eventName]) {
			eventListenerMap[eventName].forEach(async cb => {
				const data = await cb(msg.data);
				(<any> process).send({eventName, data});
			})
		}
		resolveMap[eventName] && resolveMap[eventName](msg.data);
	});
	// process.on('message', msg => {
	// 	console.log('-----message-res:', msg);
	// 	const eventName = msg.eventName;
	// 	if(eventName && eventListenerMap[eventName]) {
	// 		eventListenerMap[eventName].forEach(async cb => {
	// 			const data = await cb();
	// 			(<any> process).send({eventName, data});
	// 		})
	// 	}
	// 	resolveMap[eventName] && resolveMap[eventName](msg.data);
	// });
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


export let extHostContext = {
	aaa:1,
	test,
	send(eventName: string, data: object): Promise<any> {
		console.log('---send:', eventName, data)
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
