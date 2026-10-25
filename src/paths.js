import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOST_NAME = 'com.dogeuni.agent';
export const DEFAULT_EXTENSION_ID = 'mfdcchljfhgjjpmlnplfdeianllkempb';

/** `~/.dogeuni`, overridable with DOGEUNI_HOME (tests use a temp dir). */
export function dogeuniHome(env = process.env) {
  const override = env.DOGEUNI_HOME;
  return path.resolve(override && override.length > 0 ? override : path.join(os.homedir(), '.dogeuni'));
}

export const socketPath = (home) => path.join(home, 'agent.sock');
export const credentialsPath = (home) => path.join(home, 'credentials.json');
export const launcherPath = (home) => path.join(home, 'host');

/**
 * Create the home dir if needed and force it to 0700. Refuses a path that is
 * not a directory or is owned by another user.
 * @param {string} home
 */
export function ensureHomeDir(home) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(home);
  if (!st.isDirectory()) throw new Error(`${home} is not a directory`);
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
    throw new Error(`${home} is owned by another user`);
  }
  if ((st.mode & 0o777) !== 0o700) fs.chmodSync(home, 0o700);
}

/**
 * Chrome's per-user NativeMessagingHosts directory.
 * @param {NodeJS.Platform} platform
 */
export function defaultHostsDir(platform = process.platform) {
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
  }
  if (platform === 'linux') {
    return path.join(os.homedir(), '.config', 'google-chrome', 'NativeMessagingHosts');
  }
  return null;
}
