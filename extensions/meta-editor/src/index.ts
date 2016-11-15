import { types } from 'nmm-api';

import MetaEditorIcon from './views/MetaEditorIcon';

import * as path from 'path';

function main(context: types.IExtensionContext) {
  context.registerIcon('downloaditem-icons', MetaEditorIcon, () => ({
    key: 'meta-editor-icon',
  }));

  context.registerStyle(path.join(__dirname, 'metaeditor.less'));

  return true;
}

export default main;