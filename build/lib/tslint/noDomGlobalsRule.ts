/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ts from 'typescript';
import * as Lint from 'tslint';
import * as minimatch from 'minimatch';
import { AbstractGlobalsRuleWalker } from './abstractGlobalsRule';

interface NoDOMGlobalsRuleConfig {
	target: string;
	allowed: string[];
}

export class Rule extends Lint.Rules.AbstractRule {

	apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
		const configs = <NoDOMGlobalsRuleConfig[]>this.getOptions().ruleArguments;

		for (const config of configs) {
			if (minimatch(sourceFile.fileName, config.target)) {
				return this.applyWithWalker(new NoDOMGlobalsRuleWalker(sourceFile, this.getOptions(), config));
			}
		}

		return [];
	}
}

class NoDOMGlobalsRuleWalker extends AbstractGlobalsRuleWalker {

	getDisallowedGlobals(): string[] {
		// intentionally not complete
		return [
			"window",
			"document",
			"HTMLElement"
		];
	}
}
