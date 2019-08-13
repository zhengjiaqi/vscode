/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./icons/icons';
import 'vs/css!./icons/icons-animations';
import { escape } from 'vs/base/common/strings';

function expand(text: string): string {
	return text.replace(/\$\(((.+?)(~(.*?))?)\)/g, (_match, _g1, name, _g3, animation) => {
		return `<span class="icons icon-${name} ${animation ? `icon-animation-${animation}` : ''}"></span>`;
	});
}

export function renderIcons(label: string): string {
	return expand(escape(label));
}

export class IconsLabel {

	constructor(
		private readonly _container: HTMLElement
	) { }

	set text(text: string) {
		this._container.innerHTML = renderIcons(text || '');
	}

	set title(title: string) {
		this._container.title = title;
	}
}
