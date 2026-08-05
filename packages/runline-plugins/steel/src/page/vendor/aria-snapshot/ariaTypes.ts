/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Trimmed from playwright packages/isomorphic/ariaSnapshot.ts — see README.md.
// Kept: the aria tree node types, hasPointerCursor, findNewNode.
// Dropped: the YAML template parser used for assertion matching.

// https://www.w3.org/TR/wai-aria-1.2/#role_definitions

export type AriaRole = 'alert' | 'alertdialog' | 'application' | 'article' | 'banner' | 'blockquote' | 'button' | 'caption' | 'cell' | 'checkbox' | 'code' | 'columnheader' | 'combobox' |
  'complementary' | 'contentinfo' | 'definition' | 'deletion' | 'dialog' | 'directory' | 'document' | 'emphasis' | 'feed' | 'figure' | 'form' | 'generic' | 'grid' |
  'gridcell' | 'group' | 'heading' | 'img' | 'insertion' | 'link' | 'list' | 'listbox' | 'listitem' | 'log' | 'main' | 'mark' | 'marquee' | 'math' | 'meter' | 'menu' |
  'menubar' | 'menuitem' | 'menuitemcheckbox' | 'menuitemradio' | 'navigation' | 'none' | 'note' | 'option' | 'paragraph' | 'presentation' | 'progressbar' | 'radio' | 'radiogroup' |
  'region' | 'row' | 'rowgroup' | 'rowheader' | 'scrollbar' | 'search' | 'searchbox' | 'separator' | 'slider' |
  'spinbutton' | 'status' | 'strong' | 'subscript' | 'superscript' | 'switch' | 'tab' | 'table' | 'tablist' | 'tabpanel' | 'term' | 'textbox' | 'time' | 'timer' |
  'toolbar' | 'tooltip' | 'tree' | 'treegrid' | 'treeitem';

export type AriaProps = {
  checked?: boolean | 'mixed';
  disabled?: boolean;
  expanded?: boolean;
  active?: boolean;
  invalid?: boolean | 'grammar' | 'spelling';
  level?: number;
  pressed?: boolean | 'mixed';
  selected?: boolean;
};

export type AriaBox = {
  visible: boolean;
  inline: boolean;
  cursor?: string;
};

export type AriaNode = AriaProps & {
  role: AriaRole | 'fragment' | 'iframe';
  name: string;
  ref?: string;
  children: (AriaNode | string)[];
  box: AriaBox;
  receivesPointerEvents: boolean;
  props: Record<string, string>;
};

export function hasPointerCursor(ariaNode: AriaNode): boolean {
  return ariaNode.box.cursor === 'pointer';
}

export function findNewNode(from: AriaNode | undefined, to: AriaNode): AriaNode | undefined {
  type ByRoleAndName = Map<string, Map<string, { node: AriaNode, sizeAndPosition: number }>>;

  function fillMap(root: AriaNode, map: ByRoleAndName, position: number) {
    let size = 1;
    let childPosition = position + size;
    for (const child of root.children || []) {
      if (typeof child === 'string') {
        size++;
        childPosition++;
      } else {
        size += fillMap(child, map, childPosition);
        childPosition += size;
      }
    }
    if (!['none', 'presentation', 'fragment', 'iframe', 'generic'].includes(root.role) && root.name) {
      let byRole = map.get(root.role);
      if (!byRole) {
        byRole = new Map();
        map.set(root.role, byRole);
      }
      const existing = byRole.get(root.name);
      // This heuristic prioritizes elements at the top of the page, even if somewhat smaller.
      const sizeAndPosition = size * 100 - position;
      if (!existing || existing.sizeAndPosition < sizeAndPosition)
        byRole.set(root.name, { node: root, sizeAndPosition });
    }
    return size;
  }

  const fromMap: ByRoleAndName = new Map();
  if (from)
    fillMap(from, fromMap, 0);

  const toMap: ByRoleAndName = new Map();
  fillMap(to, toMap, 0);

  const result: { node: AriaNode, sizeAndPosition: number }[] = [];
  for (const [role, byRole] of toMap) {
    for (const [name, byName] of byRole) {
      const inFrom = fromMap.get(role)?.get(name);
      if (!inFrom)
        result.push(byName);
    }
  }
  result.sort((a, b) => b.sizeAndPosition - a.sizeAndPosition);
  return result[0]?.node;
}
