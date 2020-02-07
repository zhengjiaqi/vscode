/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { EncodingMode } from 'vs/workbench/common/editor';
import { TextFileEditorModel } from 'vs/workbench/services/textfile/common/textFileEditorModel';
import { ITextFileService, ModelState, snapshotToString } from 'vs/workbench/services/textfile/common/textfiles';
import { createFileInput, TestFileService, TestTextFileService, workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';
import { toResource } from 'vs/base/test/common/utils';
import { TextFileEditorModelManager } from 'vs/workbench/services/textfile/common/textFileEditorModelManager';
import { FileOperationResult, FileOperationError, IFileService } from 'vs/platform/files/common/files';
import { IModelService } from 'vs/editor/common/services/modelService';
import { timeout } from 'vs/base/common/async';
import { ModesRegistry } from 'vs/editor/common/modes/modesRegistry';
import { assertIsDefined } from 'vs/base/common/types';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';

class ServiceAccessor {
	constructor(
		@ITextFileService public readonly textFileService: TestTextFileService,
		@IModelService public readonly modelService: IModelService,
		@IFileService public readonly fileService: TestFileService,
		@IWorkingCopyService public readonly workingCopyService: IWorkingCopyService
	) {
	}
}

function getLastModifiedTime(model: TextFileEditorModel): number {
	const stat = model.getStat();

	return stat ? stat.mtime : -1;
}

class TestTextFileEditorModel extends TextFileEditorModel {

	isReadonly(): boolean {
		return true;
	}
}

suite('Files - TextFileEditorModel', () => {

	let instantiationService: IInstantiationService;
	let accessor: ServiceAccessor;
	let content: string;

	setup(() => {
		instantiationService = workbenchInstantiationService();
		accessor = instantiationService.createInstance(ServiceAccessor);
		content = accessor.fileService.getContent();
	});

	teardown(() => {
		(<TextFileEditorModelManager>accessor.textFileService.files).dispose();
		accessor.fileService.setContent(content);
	});

	test('basic events', async function () {
		const model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		let onDidLoadCounter = 0;
		model.onDidLoad(() => onDidLoadCounter++);

		await model.load();

		assert.equal(onDidLoadCounter, 1);

		let onDidChangeContentCounter = 0;
		model.onDidChangeContent(() => onDidChangeContentCounter++);

		let onDidChangeDirtyCounter = 0;
		model.onDidChangeDirty(() => onDidChangeDirtyCounter++);

		model.textEditorModel?.setValue('bar');

		assert.equal(onDidChangeContentCounter, 1);
		assert.equal(onDidChangeDirtyCounter, 1);

		model.textEditorModel?.setValue('foo');

		assert.equal(onDidChangeContentCounter, 2);
		assert.equal(onDidChangeDirtyCounter, 1);

		await model.revert();

		assert.equal(onDidChangeDirtyCounter, 2);

		model.dispose();
	});

	test('save', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.load();

		assert.equal(accessor.workingCopyService.dirtyCount, 0);

		model.textEditorModel!.setValue('bar');
		assert.ok(getLastModifiedTime(model) <= Date.now());
		assert.ok(model.hasState(ModelState.DIRTY));

		assert.equal(accessor.workingCopyService.dirtyCount, 1);
		assert.equal(accessor.workingCopyService.isDirty(model.resource), true);

		let savedEvent = false;
		model.onDidSave(e => savedEvent = true);

		let workingCopyEvent = false;
		accessor.workingCopyService.onDidChangeDirty(e => {
			if (e.resource.toString() === model.resource.toString()) {
				workingCopyEvent = true;
			}
		});

		const pendingSave = model.save();
		assert.ok(model.hasState(ModelState.PENDING_SAVE));

		await pendingSave;

		assert.ok(model.getLastSaveAttemptTime() <= Date.now());
		assert.ok(model.hasState(ModelState.SAVED));
		assert.ok(!model.isDirty());
		assert.ok(savedEvent);
		assert.ok(workingCopyEvent);

		assert.equal(accessor.workingCopyService.dirtyCount, 0);
		assert.equal(accessor.workingCopyService.isDirty(model.resource), false);

		model.dispose();
		assert.ok(!accessor.modelService.getModel(model.resource));
	});

	test('save - touching also emits saved event', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.load();

		let savedEvent = false;
		model.onDidSave(e => savedEvent = true);

		let workingCopyEvent = false;
		accessor.workingCopyService.onDidChangeDirty(e => {
			if (e.resource.toString() === model.resource.toString()) {
				workingCopyEvent = true;
			}
		});

		await model.save({ force: true });

		assert.ok(savedEvent);
		assert.ok(!workingCopyEvent);

		model.dispose();
		assert.ok(!accessor.modelService.getModel(model.resource));
	});

	test('save error (generic)', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.load();

		model.textEditorModel!.setValue('bar');

		let saveErrorEvent = false;
		model.onDidSaveError(e => saveErrorEvent = true);

		accessor.fileService.writeShouldThrowError = new Error('failed to write');
		try {
			const pendingSave = model.save();
			assert.ok(model.hasState(ModelState.PENDING_SAVE));

			await pendingSave;

			assert.ok(model.hasState(ModelState.ERROR));
			assert.ok(model.isDirty());
			assert.ok(saveErrorEvent);

			assert.equal(accessor.workingCopyService.dirtyCount, 1);
			assert.equal(accessor.workingCopyService.isDirty(model.resource), true);

			model.dispose();
		} finally {
			accessor.fileService.writeShouldThrowError = undefined;
		}
	});

	test('save error (conflict)', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.load();

		model.textEditorModel!.setValue('bar');

		let saveErrorEvent = false;
		model.onDidSaveError(e => saveErrorEvent = true);

		accessor.fileService.writeShouldThrowError = new FileOperationError('save conflict', FileOperationResult.FILE_MODIFIED_SINCE);
		try {
			const pendingSave = model.save();
			assert.ok(model.hasState(ModelState.PENDING_SAVE));

			await pendingSave;

			assert.ok(model.hasState(ModelState.CONFLICT));
			assert.ok(model.isDirty());
			assert.ok(saveErrorEvent);

			assert.equal(accessor.workingCopyService.dirtyCount, 1);
			assert.equal(accessor.workingCopyService.isDirty(model.resource), true);

			model.dispose();
		} finally {
			accessor.fileService.writeShouldThrowError = undefined;
		}
	});

	test('setEncoding - encode', function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		let encodingEvent = false;
		model.onDidChangeEncoding(e => encodingEvent = true);

		model.setEncoding('utf8', EncodingMode.Encode); // no-op
		assert.equal(getLastModifiedTime(model), -1);

		assert.ok(!encodingEvent);

		model.setEncoding('utf16', EncodingMode.Encode);

		assert.ok(encodingEvent);

		assert.ok(getLastModifiedTime(model) <= Date.now()); // indicates model was saved due to encoding change

		model.dispose();
	});

	test('setEncoding - decode', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		model.setEncoding('utf16', EncodingMode.Decode);

		await timeout(0);
		assert.ok(model.isResolved()); // model got loaded due to decoding
		model.dispose();
	});

	test('create with mode', async function () {
		const mode = 'text-file-model-test';
		ModesRegistry.registerLanguage({
			id: mode,
		});

		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', mode);

		await model.load();

		assert.equal(model.textEditorModel!.getModeId(), mode);

		model.dispose();
		assert.ok(!accessor.modelService.getModel(model.resource));
	});

	test('disposes when underlying model is destroyed', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.load();

		model.textEditorModel!.dispose();
		assert.ok(model.isDisposed());
	});

	test('Load does not trigger save', async function () {
		const model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index.txt'), 'utf8', undefined);
		assert.ok(model.hasState(ModelState.SAVED));

		model.onDidSave(e => assert.fail());
		model.onDidChangeDirty(e => assert.fail());

		await model.load();
		assert.ok(model.isResolved());
		model.dispose();
		assert.ok(!accessor.modelService.getModel(model.resource));
	});

	test('Load returns dirty model as long as model is dirty', async function () {
		const model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.load();
		model.textEditorModel!.setValue('foo');
		assert.ok(model.isDirty());
		assert.ok(model.hasState(ModelState.DIRTY));

		await model.load();
		assert.ok(model.isDirty());
		model.dispose();
	});

	test('Revert', async function () {
		let eventCounter = 0;

		const model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		model.onDidRevert(e => eventCounter++);

		let workingCopyEvent = false;
		accessor.workingCopyService.onDidChangeDirty(e => {
			if (e.resource.toString() === model.resource.toString()) {
				workingCopyEvent = true;
			}
		});

		await model.load();
		model.textEditorModel!.setValue('foo');
		assert.ok(model.isDirty());

		assert.equal(accessor.workingCopyService.dirtyCount, 1);
		assert.equal(accessor.workingCopyService.isDirty(model.resource), true);

		await model.revert();
		assert.ok(!model.isDirty());
		assert.equal(model.textEditorModel!.getValue(), 'Hello Html');
		assert.equal(eventCounter, 1);

		assert.ok(workingCopyEvent);
		assert.equal(accessor.workingCopyService.dirtyCount, 0);
		assert.equal(accessor.workingCopyService.isDirty(model.resource), false);

		model.dispose();
	});

	test('Revert (soft)', async function () {
		let eventCounter = 0;

		const model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		model.onDidRevert(e => eventCounter++);

		let workingCopyEvent = false;
		accessor.workingCopyService.onDidChangeDirty(e => {
			if (e.resource.toString() === model.resource.toString()) {
				workingCopyEvent = true;
			}
		});

		await model.load();
		model.textEditorModel!.setValue('foo');
		assert.ok(model.isDirty());

		assert.equal(accessor.workingCopyService.dirtyCount, 1);
		assert.equal(accessor.workingCopyService.isDirty(model.resource), true);

		await model.revert({ soft: true });
		assert.ok(!model.isDirty());
		assert.equal(model.textEditorModel!.getValue(), 'foo');
		assert.equal(eventCounter, 1);

		assert.ok(workingCopyEvent);
		assert.equal(accessor.workingCopyService.dirtyCount, 0);
		assert.equal(accessor.workingCopyService.isDirty(model.resource), false);

		model.dispose();
	});

	test('Load and undo turns model dirty', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);
		await model.load();
		accessor.fileService.setContent('Hello Change');

		await model.load();
		model.textEditorModel!.undo();
		assert.ok(model.isDirty());

		assert.equal(accessor.workingCopyService.dirtyCount, 1);
		assert.equal(accessor.workingCopyService.isDirty(model.resource), true);
	});

	test('Update Dirty', async function () {
		let eventCounter = 0;

		const model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		model.setDirty(true);
		assert.ok(!model.isDirty()); // needs to be resolved

		await model.load();
		model.textEditorModel!.setValue('foo');
		assert.ok(model.isDirty());

		await model.revert({ soft: true });
		assert.ok(!model.isDirty());

		model.onDidChangeDirty(e => eventCounter++);

		let workingCopyEvent = false;
		accessor.workingCopyService.onDidChangeDirty(e => {
			if (e.resource.toString() === model.resource.toString()) {
				workingCopyEvent = true;
			}
		});

		model.setDirty(true);
		assert.ok(model.isDirty());
		assert.equal(eventCounter, 1);
		assert.ok(workingCopyEvent);

		model.setDirty(false);
		assert.ok(!model.isDirty());
		assert.equal(eventCounter, 2);

		model.dispose();
	});

	test('No Dirty for readonly models', async function () {
		let workingCopyEvent = false;
		accessor.workingCopyService.onDidChangeDirty(e => {
			if (e.resource.toString() === model.resource.toString()) {
				workingCopyEvent = true;
			}
		});

		const model = instantiationService.createInstance(TestTextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.load();
		model.textEditorModel!.setValue('foo');
		assert.ok(!model.isDirty());

		await model.revert({ soft: true });
		assert.ok(!model.isDirty());

		assert.ok(!workingCopyEvent);

		model.dispose();
	});

	test('File not modified error is handled gracefully', async function () {
		let model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.load();

		const mtime = getLastModifiedTime(model);
		accessor.textFileService.setResolveTextContentErrorOnce(new FileOperationError('error', FileOperationResult.FILE_NOT_MODIFIED_SINCE));

		model = await model.load() as TextFileEditorModel;

		assert.ok(model);
		assert.equal(getLastModifiedTime(model), mtime);
		model.dispose();
	});

	test('Load error is handled gracefully if model already exists', async function () {
		let model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.load();
		accessor.textFileService.setResolveTextContentErrorOnce(new FileOperationError('error', FileOperationResult.FILE_NOT_FOUND));

		model = await model.load() as TextFileEditorModel;
		assert.ok(model);
		model.dispose();
	});

	test('save() and isDirty() - proper with check for mtimes', async function () {
		const input1 = createFileInput(instantiationService, toResource.call(this, '/path/index_async2.txt'));
		const input2 = createFileInput(instantiationService, toResource.call(this, '/path/index_async.txt'));

		const model1 = await input1.resolve() as TextFileEditorModel;
		const model2 = await input2.resolve() as TextFileEditorModel;

		model1.textEditorModel!.setValue('foo');

		const m1Mtime = assertIsDefined(model1.getStat()).mtime;
		const m2Mtime = assertIsDefined(model2.getStat()).mtime;
		assert.ok(m1Mtime > 0);
		assert.ok(m2Mtime > 0);

		assert.ok(accessor.textFileService.isDirty(toResource.call(this, '/path/index_async2.txt')));
		assert.ok(!accessor.textFileService.isDirty(toResource.call(this, '/path/index_async.txt')));

		model2.textEditorModel!.setValue('foo');
		assert.ok(accessor.textFileService.isDirty(toResource.call(this, '/path/index_async.txt')));

		await timeout(10);
		await accessor.textFileService.save(toResource.call(this, '/path/index_async.txt'));
		await accessor.textFileService.save(toResource.call(this, '/path/index_async2.txt'));
		assert.ok(!accessor.textFileService.isDirty(toResource.call(this, '/path/index_async.txt')));
		assert.ok(!accessor.textFileService.isDirty(toResource.call(this, '/path/index_async2.txt')));
		assert.ok(assertIsDefined(model1.getStat()).mtime > m1Mtime);
		assert.ok(assertIsDefined(model2.getStat()).mtime > m2Mtime);
		assert.ok(model1.getLastSaveAttemptTime() > m1Mtime);
		assert.ok(model2.getLastSaveAttemptTime() > m2Mtime);

		model1.dispose();
		model2.dispose();
	});

	test('Save Participant', async function () {
		let eventCounter = 0;
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		model.onDidSave(e => {
			assert.equal(snapshotToString(model.createSnapshot()!), 'bar');
			assert.ok(!model.isDirty());
			eventCounter++;
		});

		accessor.textFileService.saveParticipant = {
			participate: model => {
				assert.ok(model.isDirty());
				model.textEditorModel!.setValue('bar');
				assert.ok(model.isDirty());
				eventCounter++;
				return Promise.resolve();
			}
		};

		await model.load();
		model.textEditorModel!.setValue('foo');

		await model.save();
		model.dispose();
		assert.equal(eventCounter, 2);
	});

	test('Save Participant, async participant', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		accessor.textFileService.saveParticipant = {
			participate: (model) => {
				return timeout(10);
			}
		};

		await model.load();
		model.textEditorModel!.setValue('foo');

		const now = Date.now();
		await model.save();
		assert.ok(Date.now() - now >= 10);
		model.dispose();
	});

	test('Save Participant, bad participant', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		accessor.textFileService.saveParticipant = {
			participate: (model) => {
				return Promise.reject(new Error('boom'));
			}
		};

		await model.load();
		model.textEditorModel!.setValue('foo');

		await model.save();
		model.dispose();
	});
});
