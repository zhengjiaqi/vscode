/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ts from 'typescript';
import * as Lint from 'tslint';
import * as minimatch from 'minimatch';
import { AbstractGlobalsRuleWalker } from './abstractGlobalsRule';

interface NoNodejsGlobalsConfig {
	target: string;
	allowed: string[];
}

export class Rule extends Lint.Rules.AbstractRule {

	apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
		const configs = <NoNodejsGlobalsConfig[]>this.getOptions().ruleArguments;

		for (const config of configs) {
			if (minimatch(sourceFile.fileName, config.target)) {
				return this.applyWithWalker(new NoNodejsGlobalsRuleWalker(sourceFile, this.getOptions(), config));
			}
		}

		return [];
	}
}

class NoNodejsGlobalsRuleWalker extends AbstractGlobalsRuleWalker {

	getDisallowedGlobals(): string[] {
		// https://nodejs.org/api/globals.html#globals_global_objects
		return [
			"NodeJS",
			"Buffer",
			"__dirname",
			"__filename",
			"clearImmediate",
			"exports",
			"global",
			"module",
			"process",
			"setImmediate"
		];
	}
}
