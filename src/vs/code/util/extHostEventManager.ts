import { ChildProcess } from 'child_process';

interface IEventListenerMap {
	[key: string]: Array<Function>;
}
interface IResolveMap {
	[key: string]: Function;
}

let eventListenerMap: IEventListenerMap = {};
let resolveMap: IResolveMap = {};

let cacheExtensionHostProcess: ChildProcess;

export function handleExtHostEvent(extensionHostProcess: ChildProcess) {
	cacheExtensionHostProcess = extensionHostProcess;
	extensionHostProcess.on('message', msg => {
		const eventName = msg.eventName;
		if(eventName && eventListenerMap[eventName]) {
			eventListenerMap[eventName].forEach(async cb => {
				const data = await cb(msg.data);
				cacheExtensionHostProcess.send({eventName, data});
			})
		}
		resolveMap[eventName] && resolveMap[eventName](msg.data);
	});
}

export function on(eventName: string, cb: Function) {
	if(!eventListenerMap[eventName]){
		eventListenerMap[eventName] = [];
	}
	eventListenerMap[eventName].push(cb);
}

export function send(eventName: string, data: Function) {
	return new Promise((resolve, reject) => {
		cacheExtensionHostProcess.send({eventName, data});
		resolveMap[eventName] = resolve;
	})
}
