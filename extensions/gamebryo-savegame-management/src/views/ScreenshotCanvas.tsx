import { ISavegame } from '../types/ISavegame';

import { Dimensions } from 'gamebryo-savegame';
import * as React from 'react';

interface ICanvasProps {
  save: ISavegame;
}

// current typings know neither the function nor the return value
declare var createImageBitmap: (imgData: ImageData) => Promise<any>;

class ScreenshotCanvas extends React.Component<ICanvasProps, {}> {
  private screenshotCanvas: HTMLCanvasElement;

  public componentDidMount() {
    let ctx: CanvasRenderingContext2D = this.screenshotCanvas.getContext('2d');
    let imgData: ImageData = ctx.createImageData(
      this.screenshotCanvas.width, this.screenshotCanvas.height);

    this.props.save.savegameBind.screenshot(imgData.data);
    createImageBitmap(imgData)
    .then((bitmap) => {
      ctx.drawImage(bitmap, 0, 0);
    });
  }

  public render(): JSX.Element {
    let {save} = this.props;
    if (save === undefined) {
      return null;
    }
    let dim: Dimensions = (save.attributes as any).screenshot;
    return (<canvas
      id='screenshot-canvas'
      ref={this.refCanvas}
      width={dim.width}
      height={dim.height}
    />);
  }

  private refCanvas = (ref) => {
    this.screenshotCanvas = ref;
  }
}

export default ScreenshotCanvas;