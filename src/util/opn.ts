import * as Promise from 'bluebird';
import {} from 'ffi';
import opn = require('opn');
import * as refT from 'ref';

let voidPtr: refT.Type;
let shell32;

export class Win32Error extends Error {
  private mCode: number;
  constructor(message: string, code: number) {
    super(`${message} (${code})`);
    this.name = this.constructor.name;
    this.mCode = code;
  }

  public get code(): number {
    return this.mCode;
  }
}

function initTypes() {
  if ((shell32 !== undefined) || (process.platform !== 'win32')) {
    return;
  }

  const ref = require('ref');

  voidPtr = ref.refType(ref.types.void);

  if (shell32 === undefined) {
    const ffi = require('ffi');
    const ref = require('ref');
    shell32 = new ffi.Library('Shell32', {
      ShellExecuteA: [ref.types.int32, [voidPtr, ref.types.CString, ref.types.CString,
                                        ref.types.CString, ref.types.CString, ref.types.int32]],
    });
  }
}

function open(target: string, wait?: boolean): Promise<void> {
  initTypes();

  // TODO: can't implement wait behaviour with ShellExecute, would require ShellExecuteEx
  //   and then we can't get at error codes because GetLastError doesn't work with ffi...
  if ((shell32 !== undefined) && !wait) {
    return new Promise<void>((resolve, reject) => {
      shell32.ShellExecuteA.async(null, 'open', target, null,
        null, 5, (execErr: any, res: any) => {
          if (execErr !== null) {
            return reject(execErr);
          }
          if (res <= 32) {
            return reject(new Win32Error('ShellExecute failed', res));
          }
          return resolve();
        });
    });
  } else {
    return Promise.resolve(opn(target, {
      wait,
    })).then(() => null);
  }
}

export default open;
