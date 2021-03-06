/// <reference types="node" />
/// <reference types="bluebird" />
import * as Bluebird from 'bluebird';
export declare class Win32Error extends Error {
    private mCode;
    constructor(message: string, code: number);
    readonly code: number;
}
/**
 * run a function as an elevated process (windows only!).
 * This is quite a hack because obviously windows doesn't allow us to elevate a
 * running process so instead we have to store the function code into a file and start a
 * new node process elevated to execute that script.
 *
 * IMPORTANT As a consequence the function can not bind any parameters
 *
 * @param {string} ipcPath a unique identifier for a local ipc channel that can be used to
 *                 communicate with the elevated process (as stdin/stdout can not be)
 *                 redirected
 * @param {Function} func The closure to run in the elevated process. Try to avoid
 *                        'fancy' code. This function receives two parameters, one is an ipc stream,
 *                        connected to the path specified in the first parameter.
 *                        The second function is a require function which you need to use instead of
 *                        the global require. Regular require calls will not work in production
 *                        builds
 * @param {Object} args arguments to be passed into the elevated process
 * @returns {Bluebird<any>} a promise that will be resolved as soon as the process is started
 *                          (which happens after the user confirmed elevation)
 */
declare function runElevated(ipcPath: string, func: (ipc: any, req: NodeRequireFunction) => void | Promise<void> | Bluebird<void>, args?: any): Bluebird<any>;
export default runElevated;
