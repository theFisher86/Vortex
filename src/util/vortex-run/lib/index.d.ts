/// <reference types="node" />
/// <reference types="jest" />
import runElevated, { Win32Error } from './elevated';
import runThreaded from './thread';
declare const dynreq: NodeRequire;
export { runElevated, runThreaded, dynreq, Win32Error };
