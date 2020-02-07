/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as assert from 'assert';
import severity from 'vs/base/common/severity';
import { DebugModel, StackFrame, Thread } from 'vs/workbench/contrib/debug/common/debugModel';
import { MockRawSession, MockDebugAdapter } from 'vs/workbench/contrib/debug/test/common/mockDebug';
import { SimpleReplElement, RawObjectReplElement, ReplEvaluationInput, ReplModel, ReplEvaluationResult } from 'vs/workbench/contrib/debug/common/replModel';
import { RawDebugSession } from 'vs/workbench/contrib/debug/browser/rawDebugSession';
import { timeout } from 'vs/base/common/async';
import { createMockSession } from 'vs/workbench/contrib/debug/test/browser/callStack.test';

suite('Debug - REPL', () => {
	let model: DebugModel;
	let rawSession: MockRawSession;

	setup(() => {
		model = new DebugModel([], [], [], [], [], <any>{ isDirty: (e: any) => false });
		rawSession = new MockRawSession();
	});

	test('repl output', () => {
		const session = createMockSession(model);
		const repl = new ReplModel();
		repl.appendToRepl(session, 'first line\n', severity.Error);
		repl.appendToRepl(session, 'second line ', severity.Error);
		repl.appendToRepl(session, 'third line ', severity.Error);
		repl.appendToRepl(session, 'fourth line', severity.Error);

		let elements = <SimpleReplElement[]>repl.getReplElements();
		assert.equal(elements.length, 2);
		assert.equal(elements[0].value, 'first line\n');
		assert.equal(elements[0].severity, severity.Error);
		assert.equal(elements[1].value, 'second line third line fourth line');
		assert.equal(elements[1].severity, severity.Error);

		repl.appendToRepl(session, '1', severity.Warning);
		elements = <SimpleReplElement[]>repl.getReplElements();
		assert.equal(elements.length, 3);
		assert.equal(elements[2].value, '1');
		assert.equal(elements[2].severity, severity.Warning);

		const keyValueObject = { 'key1': 2, 'key2': 'value' };
		repl.appendToRepl(session, new RawObjectReplElement('fakeid', 'fake', keyValueObject), severity.Info);
		const element = <RawObjectReplElement>repl.getReplElements()[3];
		assert.equal(element.value, 'Object');
		assert.deepEqual(element.valueObj, keyValueObject);

		repl.removeReplExpressions();
		assert.equal(repl.getReplElements().length, 0);

		repl.appendToRepl(session, '1\n', severity.Info);
		repl.appendToRepl(session, '2', severity.Info);
		repl.appendToRepl(session, '3\n4', severity.Info);
		repl.appendToRepl(session, '5\n', severity.Info);
		repl.appendToRepl(session, '6', severity.Info);
		elements = <SimpleReplElement[]>repl.getReplElements();
		assert.equal(elements.length, 3);
		assert.equal(elements[0], '1\n');
		assert.equal(elements[1], '23\n45\n');
		assert.equal(elements[2], '6');
	});

	test('repl merging', () => {
		// 'mergeWithParent' should be ignored when there is no parent.
		const parent = createMockSession(model, 'parent', { repl: 'mergeWithParent' });
		const child1 = createMockSession(model, 'child1', { parentSession: parent, repl: 'separate' });
		const child2 = createMockSession(model, 'child2', { parentSession: parent, repl: 'mergeWithParent' });
		const grandChild = createMockSession(model, 'grandChild', { parentSession: child2, repl: 'mergeWithParent' });
		const child3 = createMockSession(model, 'child3', { parentSession: parent });

		let parentChanges = 0;
		parent.onDidChangeReplElements(() => ++parentChanges);

		parent.appendToRepl('1\n', severity.Info);
		assert.equal(parentChanges, 1);
		assert.equal(parent.getReplElements().length, 1);
		assert.equal(child1.getReplElements().length, 0);
		assert.equal(child2.getReplElements().length, 1);
		assert.equal(grandChild.getReplElements().length, 1);
		assert.equal(child3.getReplElements().length, 0);

		grandChild.appendToRepl('1\n', severity.Info);
		assert.equal(parentChanges, 2);
		assert.equal(parent.getReplElements().length, 2);
		assert.equal(child1.getReplElements().length, 0);
		assert.equal(child2.getReplElements().length, 2);
		assert.equal(grandChild.getReplElements().length, 2);
		assert.equal(child3.getReplElements().length, 0);

		child3.appendToRepl('1\n', severity.Info);
		assert.equal(parentChanges, 2);
		assert.equal(parent.getReplElements().length, 2);
		assert.equal(child1.getReplElements().length, 0);
		assert.equal(child2.getReplElements().length, 2);
		assert.equal(grandChild.getReplElements().length, 2);
		assert.equal(child3.getReplElements().length, 1);

		child1.appendToRepl('1\n', severity.Info);
		assert.equal(parentChanges, 2);
		assert.equal(parent.getReplElements().length, 2);
		assert.equal(child1.getReplElements().length, 1);
		assert.equal(child2.getReplElements().length, 2);
		assert.equal(grandChild.getReplElements().length, 2);
		assert.equal(child3.getReplElements().length, 1);
	});

	test('repl expressions', () => {
		const session = createMockSession(model);
		assert.equal(session.getReplElements().length, 0);
		model.addSession(session);

		session['raw'] = <any>rawSession;
		const thread = new Thread(session, 'mockthread', 1);
		const stackFrame = new StackFrame(thread, 1, <any>undefined, 'app.js', 'normal', { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 }, 1);
		const replModel = new ReplModel();
		replModel.addReplExpression(session, stackFrame, 'myVariable').then();
		replModel.addReplExpression(session, stackFrame, 'myVariable').then();
		replModel.addReplExpression(session, stackFrame, 'myVariable').then();

		assert.equal(replModel.getReplElements().length, 3);
		replModel.getReplElements().forEach(re => {
			assert.equal((<ReplEvaluationInput>re).value, 'myVariable');
		});

		replModel.removeReplExpressions();
		assert.equal(replModel.getReplElements().length, 0);
	});

	test('repl ordering', async () => {
		const session = createMockSession(model);
		model.addSession(session);

		const adapter = new MockDebugAdapter();
		const raw = new RawDebugSession(adapter, undefined!, undefined!, undefined!, undefined!, undefined!, undefined!);
		session.initializeForTest(raw);

		await session.addReplExpression(undefined, 'before.1');
		assert.equal(session.getReplElements().length, 3);
		assert.equal((<ReplEvaluationInput>session.getReplElements()[0]).value, 'before.1');
		assert.equal((<SimpleReplElement>session.getReplElements()[1]).value, 'before.1');
		assert.equal((<ReplEvaluationResult>session.getReplElements()[2]).value, '=before.1');

		await session.addReplExpression(undefined, 'after.2');
		await timeout(0);
		assert.equal(session.getReplElements().length, 6);
		assert.equal((<ReplEvaluationInput>session.getReplElements()[3]).value, 'after.2');
		assert.equal((<ReplEvaluationResult>session.getReplElements()[4]).value, '=after.2');
		assert.equal((<SimpleReplElement>session.getReplElements()[5]).value, 'after.2');
	});
});
