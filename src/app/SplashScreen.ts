import {delayed} from '../util/delayed';
import getVortexPath from '../util/getVortexPath';

class SplashScreen {
  private mWindow: Electron.BrowserWindow = null;

  public fadeOut() {
    // apparently we can't prevent the user from closing the splash with alt-f4...
    if ((this.mWindow === null) || this.mWindow.isDestroyed()) {
      return Promise.resolve();
    }
    // ensure the splash screen remains visible
    this.mWindow.setAlwaysOnTop(true);

    // don't fade out immediately, otherwise the it looks odd
    // as the main window appears at the same time
    return delayed(200)
        .then(() => this.mWindow.webContents.send('fade-out'))
        // wait for the fade out animation to finish before destroying
        // the window
        .then(() => delayed(500))
        .then(() => {
          this.mWindow.close();
          this.mWindow = null;
        });
  }

  public create(): Promise<void> {
    const BrowserWindow: typeof Electron.BrowserWindow = require('electron').BrowserWindow;

    return new Promise<void>((resolve, reject) => {
      const onReady = () => {
        this.mWindow.show();
        resolve();
      };

      this.mWindow = new BrowserWindow({
        frame: false,
        width: 700,
        height: 232,
        transparent: true,
        show: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,

        skipTaskbar: true,
        webPreferences: {
          javascript: false,
          webgl: false,
          backgroundThrottling: false,
          sandbox: false,
        },
      });
      this.mWindow.loadURL(`file://${getVortexPath('base')}/splash.html`);
      this.mWindow.once('ready-to-show', onReady);
    });
  }

}

export default SplashScreen;
