import {setInstanceId, setWarnedAdmin} from '../actions/app';
import {} from '../reducers/index';
import {IState} from '../types/IState';
import commandLine, {IParameters} from '../util/commandLine';
import { ProcessCanceled } from '../util/CustomErrors';
import { } from '../util/delayed';
import * as develT from '../util/devel';
import { terminate, toError } from '../util/errorHandling';
import ExtensionManagerT from '../util/ExtensionManager';
import * as fs from '../util/fs';
import lazyRequire from '../util/lazyRequire';
import LevelPersist, { DatabaseLocked } from '../util/LevelPersist';
import {log, setLogPath, setupLogging} from '../util/log';
import { showError } from '../util/message';
import { StateError } from '../util/reduxSanity';
import { allHives, createVortexStore, currentStatePath, extendStore,
         importState, insertPersistor, markImported } from '../util/store';
import {} from '../util/storeHelper';
import SubPersistor from '../util/SubPersistor';

import MainWindowT from './MainWindow';
import SplashScreenT from './SplashScreen';
import TrayIconT from './TrayIcon';

import * as Promise from 'bluebird';
import crashDump from 'crash-dump';
import {app, dialog, ipcMain} from 'electron';
import * as isAdmin from 'is-admin';
import * as _ from 'lodash';
import * as path from 'path';
import { allow } from 'permissions';
import * as Redux from 'redux';
import * as uuidT from 'uuid';

const uuid = lazyRequire<typeof uuidT>(() => require('uuid'));

function last(array: any[]): any {
  if (array.length === 0) {
    return undefined;
  }
  return array[array.length - 1];
}

class Application {
  private mBasePath: string;
  private mStore: Redux.Store<IState>;
  private mLevelPersistors: LevelPersist[] = [];
  private mArgs: IParameters;
  private mMainWindow: MainWindowT;
  private mExtensions: ExtensionManagerT;
  private mTray: TrayIconT;

  constructor(args: IParameters) {
    this.mArgs = args;

    ipcMain.on('show-window', () => this.showMainWindow());

    app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

    this.mBasePath = app.getPath('userData');
    fs.ensureDirSync(this.mBasePath);

    const tempPath = path.join(app.getPath('userData'), 'temp');
    app.setPath('temp', tempPath);
    fs.ensureDirSync(path.join(tempPath, 'dumps'));

    crashDump(path.join(tempPath, 'dumps', `crash-main-${Date.now()}.dmp`));

    this.setupAppEvents(args);
  }

  private startUi(): Promise<void> {
    const MainWindow = require('./MainWindow').default;
    this.mMainWindow = new MainWindow(this.mStore);
    return this.mMainWindow.create(this.mStore).then(webContents => {
      this.mExtensions.setupApiMain(this.mStore, webContents);
      return this.applyArguments(this.mArgs);
    });
  }

  private startSplash(): Promise<SplashScreenT> {
    const SplashScreen = require('./SplashScreen').default;
    const splash = new SplashScreen();
    return splash.create()
      .then(() => splash);
  }

  private setupAppEvents(args: IParameters) {
    app.on('window-all-closed', () => {
      log('info', 'clean application end');
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', () => {
      if (this.mMainWindow !== undefined) {
        this.mMainWindow.create(this.mStore);
      }
    });

    app.on('ready', () => {
      if (args.get) {
        this.handleGet(args.get, args.shared);
      } else if (args.set) {
        this.handleSet(args.set, args.shared);
      } else if (args.del) {
        this.handleDel(args.del, args.shared);
      } else {
        this.regularStart(args);
      }
    });

    app.on('web-contents-created', (event: Electron.Event, contents: Electron.WebContents) => {
      contents.on('will-attach-webview', this.attachWebView);
    });
  }

  private attachWebView = (event: Electron.Event,
                           webPreferences: Electron.WebPreferences & { preloadURL: string },
                           params) => {
    // disallow creation of insecure webviews

    delete webPreferences.preload;
    delete webPreferences.preloadURL;

    webPreferences.nodeIntegration = false;
  }

  private genHandleError() {
    return (error: any) => {
      terminate(toError(error), this.mStore.getState());
    };
  }

  private regularStart(args: IParameters): Promise<void> {
    let splash: SplashScreenT;

    return this.testShouldQuit(args.wait ? 10 : -1)
        .then(() => {
          setupLogging(app.getPath('userData'), process.env.NODE_ENV === 'development');
          log('info', '--------------------------');
          log('info', 'Vortex Version', app.getVersion());
          return this.startSplash();
        })
        // start initialization
        .then(splashIn => {
          splash = splashIn;
          return this.createStore();
        })
        .then(() => this.warnAdmin())
        .then(() => {
          // as soon as we have a store, install an extended error handler that has
          // access to application state
          const handleError = this.genHandleError();
          process.removeAllListeners('uncaughtException');
          process.removeAllListeners('unhandledRejection');
          process.on('uncaughtException', handleError);
          process.on('unhandledRejection', handleError);
        })
        .then(() => this.initDevel())
        .then(() => this.startUi())
        .then(() => this.createTray())
        // end initialization
        .then(() => {
          this.connectTrayAndWindow();
          return splash.fadeOut();
        })
        .catch(ProcessCanceled, () => {
          app.quit();
        })
        .catch(DatabaseLocked, () => {
          dialog.showErrorBox('Startup failed', 'Vortex seems to be running already. '
            + 'If you can\'t see it, please check the task manager.');
          app.quit();
        })
        .catch((err) => {
          terminate({
            message: 'Startup failed',
            details: err.message,
            stack: err.stack,
          }, this.mStore !== undefined ? this.mStore.getState() : {});
        });
  }

  private warnAdmin(): Promise<void> {
    const state: IState = this.mStore.getState();
    if (state.app.warnedAdmin > 0) {
      return Promise.resolve();
    }
    return isAdmin()
      .then(admin => {
        if (!admin) {
          return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
          dialog.showMessageBox(null, {
            title: 'Admin rights detected',
            message:
              'Vortex is not intended to be run as administrator!\n'
              + 'If you\'re doing this because you have permission problems, please '
              + 'stop, you\'re just making it worse.\n'
              + 'File permissions can be changed, so that the tools can be run with a '
              + 'regular account. '
              + 'Vortex will try its best to help you with that.\n'
              + 'If you choose to continue I won\'t bother you again but please '
              + 'don\'t report any permission problems to us because they are '
              + 'of your own making.',
            buttons: [
              'Quit',
              'Ignore',
            ],
            noLink: true,
          }, (response: number) => {
            if (response === 0) {
              app.quit();
            } else {
              this.mStore.dispatch(setWarnedAdmin(1));
              resolve();
            }
          });
        });
      });
  }

  private splitPath(statePath: string): string[] {
    return statePath.match(/(\\.|[^.])+/g).map(input => input.replace(/\\(.)/, '$1'));
  }

  private handleGet(getPath: string | boolean, shared: boolean): Promise<void> {
    if (typeof(getPath) === 'boolean') {
      fs.writeSync(1, 'Usage: vortex --get <path>\n');
      app.quit();
      return;
    }

    const vortexPath = process.env.NODE_ENV === 'development'
        ? 'vortex_devel'
        : 'vortex';

    const dbpath = shared
      ? path.join(process.env.ProgramData, 'vortex', currentStatePath)
      : path.join(process.env['APPDATA'], vortexPath, currentStatePath);
    const pathArray = this.splitPath(getPath);

    let persist: LevelPersist;

    return LevelPersist.create(dbpath)
      .then(persistIn => {
        persist = persistIn;
        return persist.getAllKeys();
      })
      .then(keys => {
        const matches = keys
          .filter(key => _.isEqual(key.slice(0, pathArray.length), pathArray));
        return Promise.map(matches, match => persist.getItem(match)
          .then(value => `${match.join('.')} = ${value}`));
      }).then(output => { process.stdout.write(output.join('\n') + '\n'); })
      .catch(err => { process.stderr.write(err.message + '\n'); })
      .finally(() => {
        app.quit();
      });
  }

  private handleSet(setParameters: string[], shared: boolean): Promise<void> {
    if (setParameters.length !== 2) {
      process.stdout.write('Usage: vortex --set <path>=<value>\n');
      app.quit();
      return;
    }

    const vortexPath = process.env.NODE_ENV === 'development'
        ? 'vortex_devel'
        : 'vortex';

    const dbpath = shared
      ? path.join(process.env.ProgramData, 'vortex', currentStatePath)
      : path.join(process.env['APPDATA'], vortexPath, currentStatePath);
    const pathArray = this.splitPath(setParameters[0]);

    let persist: LevelPersist;

    return LevelPersist.create(dbpath)
      .then(persistIn => {
        persist = persistIn;
        return persist.getItem(pathArray);
      })
      .then(oldValue => {
        const newValue = setParameters[1].length === 0
          ? undefined
          : (oldValue === undefined) || (typeof(oldValue) === 'object')
            ? JSON.parse(setParameters[1])
            : oldValue.constructor(setParameters[1]);
        return persist.setItem(pathArray, newValue);
      }).then(() => { process.stdout.write('changed\n'); })
      .catch(err => { process.stderr.write(err.message + '\n'); })
      .finally(() => {
        app.quit();
      });
  }

  private handleDel(delPath: string, shared: boolean): Promise<void> {
    const vortexPath = process.env.NODE_ENV === 'development'
        ? 'vortex_devel'
        : 'vortex';

    const dbpath = shared
      ? path.join(process.env.ProgramData, 'vortex', currentStatePath)
      : path.join(process.env['APPDATA'], vortexPath, currentStatePath);
    const pathArray = this.splitPath(delPath);

    let persist: LevelPersist;

    let found = false;

    return LevelPersist.create(dbpath)
      .then(persistIn => {
        persist = persistIn;
        return persist.getAllKeys();
      })
      .filter((key: string[]) => _.isEqual(key.slice(0, pathArray.length), pathArray))
      .map((key: string[]) => {
        // tslint:disable-next-line:no-console
        console.log('removing', key.join('.'));
        found = true;
        return persist.removeItem(key);
      })
      .then(() => {
        if (!found) {
          process.stdout.write('not found\n');
        }
      })
      .catch(err => { process.stderr.write(err.message + '\n'); })
      .finally(() => {
        app.quit();
      });
  }

  private createTray(): Promise<void> {
    const TrayIcon = require('./TrayIcon').default;
    this.mTray = new TrayIcon(this.mExtensions.getApi());
    return Promise.resolve();
  }

  private connectTrayAndWindow() {
    const state: IState = this.mStore.getState();
    if (this.mTray.initialized && state.settings.window.minimizeToTray) {
      this.mMainWindow.connectToTray(this.mTray);
    }
  }

  private multiUserPath() {
    if (process.platform === 'win32') {
      const muPath = path.join(process.env.ProgramData, 'vortex');
      try {
        fs.ensureDirSync(muPath);
      } catch (err) {
        // not sure why this would happen, ensureDir isn't supposed to report a problem if
        // the directory exists, but there was a single report of EEXIST in this place.
        // Probably a bug related to the filesystem used in C:\ProgramData, we had similar
        // problems with OneDrive paths
        if (err.code !== 'EEXIST') {
          throw err;
        }
      }
      return muPath;
    } else {
      log('error', 'Multi-User mode not implemented outside windows');
      return app.getPath('userData');
    }
  }

  private createStore(): Promise<void> {
    const newStore = createVortexStore(this.sanityCheckCB);

    // 1. load only user settings to determine if we're in multi-user mode
    // 2. load app settings to determine which extensions to load
    // 3. load extensions, then load all settings, including extensions
    return LevelPersist.create(path.join(this.mBasePath, currentStatePath))
      .then(levelPersistor => {
        this.mLevelPersistors.push(levelPersistor);
        return insertPersistor(
          'user', new SubPersistor(levelPersistor, 'user'));
      })
      .then(() => {
        const multiUser = newStore.getState().user.multiUser;
        const dataPath = multiUser
          ? this.multiUserPath()
          : app.getPath('userData');
        app.setPath('userData', dataPath);
        this.mBasePath = dataPath;
        const created = fs.ensureDirSync(dataPath);
        if (multiUser && created) {
          allow(dataPath, 'group', 'rwx');
        }

        log('info', `using ${dataPath} as the storage directory`);
        if (multiUser) {
          setLogPath(dataPath);
          return LevelPersist.create(path.join(dataPath, currentStatePath))
            .then(levelPersistor => {
              this.mLevelPersistors.push(levelPersistor);
            });
        } else {
          return Promise.resolve();
        }
      })
      .then(() => insertPersistor('app', new SubPersistor(last(this.mLevelPersistors), 'app')))
      .then(() => {
        if (newStore.getState().app.instanceId === undefined) {
          const newId = uuid.v4();
          newStore.dispatch(setInstanceId(newId));
        }
        const ExtensionManager = require('../util/ExtensionManager').default;
        this.mExtensions = new ExtensionManager(newStore);
        const reducer = require('../reducers/index').default;
        newStore.replaceReducer(reducer(this.mExtensions.getReducers()));
        return Promise.mapSeries(allHives(this.mExtensions), hive =>
          insertPersistor(hive, new SubPersistor(last(this.mLevelPersistors), hive)));
      })
      .then(() => importState(this.mBasePath))
      .then(oldState => {
        // mark as imported first, otherwise we risk importing again overwriting data.
        // this way we risk not importing but since the old state is still there, that
        // can be repaired
        return oldState !== undefined ?
                   markImported(this.mBasePath)
                       .then(() => {
                         newStore.dispatch({
                           type: '__hydrate',
                           payload: oldState,
                         });
                       }) :
                   Promise.resolve();
      })
      .then(() => {
        this.mStore = newStore;
        this.mExtensions.setStore(newStore);
        return extendStore(newStore, this.mExtensions);
      })
      .then(() => this.mExtensions.doOnce());
  }

  private sanityCheckCB = (err: StateError) => {
    showError(this.mStore.dispatch,
      'An invalid state change was prevented, this was probably caused by a bug', err);
  }

  private initDevel(): Promise<void> {
    if (process.env.NODE_ENV === 'development') {
      const {installDevelExtensions} = require('../util/devel') as typeof develT;
      return installDevelExtensions();
    } else {
      return Promise.resolve();
    }
  }

  private showMainWindow() {
    const windowMetrics = this.mStore.getState().settings.window;
    const maximized: boolean = windowMetrics.maximized || false;
    this.mMainWindow.show(maximized);
  }

  private testShouldQuit(retries: number): Promise<void> {
    // different modes: if retries were set, the caller wants to start a
    // "primary" instance and is willing to wait. In that case we don't act as
    // a secondary instance that sends off it's arguments to the first
    const remoteCallback = (retries === -1) ?
                               (secondaryArgv, workingDirectory) => {
                                 // this is called inside the primary process
                                 // with the parameters of
                                 // the secondary one whenever an additional
                                 // instance is started
                                 this.applyArguments(commandLine(secondaryArgv));
                               } :
                               () => undefined;

    const shouldQuit: boolean = app.makeSingleInstance(remoteCallback);

    if (shouldQuit) {
      if (retries > 0) {
        return require('../util/delayed').delayed(100).then(() => this.testShouldQuit(retries - 1));
      }
      app.quit();
      return Promise.reject(new ProcessCanceled('should quit'));
    }

    return Promise.resolve();
  }

  private applyArguments(args: IParameters) {
    if (args.download) {
      const prom: Promise<void> = (this.mMainWindow === undefined)
        // give the main instance a moment to fully start up
        ? require('../util/delayed').delayed(2000)
        : Promise.resolve(undefined);

      prom.then(() => {
        if (this.mMainWindow !== undefined) {
          this.mMainWindow.sendExternalURL(args.download);
        } else {
          // TODO: this instructions aren't very correct because we know Vortex doesn't have
          // a UI and needs to be shut down from the task manager
          dialog.showErrorBox('Vortex unresponsive',
            'Vortex appears to frozen, please close Vortex and try again');
        }
      });
    }
  }
}

export default Application;
