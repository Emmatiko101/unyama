import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import createDebug from 'debug';

const debug = createDebug('actual:config');
const debugSensitive = createDebug('actual-sensitive:config');

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
debug(`project root: '${projectRoot}'`);
export const sqlDir = path.join(projectRoot, 'src', 'sql');

let defaultDataDir = fs.existsSync('/data') ? '/data' : projectRoot;

if (process.env.AUTUMN_DATA_DIR) {
  defaultDataDir = process.env.AUTUMN_DATA_DIR;
}

debug(`default data directory: '${defaultDataDir}'`);

function parseJSON(path, allowMissing = false) {
  let text;
  try {
    text = fs.readFileSync(path, 'utf8');
  } catch (e) {
    if (allowMissing) {
      debug(`config file '${path}' not found, ignoring.`);
      return {};
    }
    throw e;
  }
  return JSON.parse(text);
}

let userConfig;
if (process.env.AUTUMN_CONFIG_PATH) {
  debug(
    `loading config from AUTUMN_CONFIG_PATH: '${process.env.AUTUMN_CONFIG_PATH}'`,
  );
  userConfig = parseJSON(process.env.AUTUMN_CONFIG_PATH);

  defaultDataDir = userConfig.dataDir ?? defaultDataDir;
} else {
  let configFile = path.join(projectRoot, 'config.json');

  if (!fs.existsSync(configFile)) {
    configFile = path.join(defaultDataDir, 'config.json');
  }

  debug(`loading config from default path: '${configFile}'`);
  userConfig = parseJSON(configFile, true);
}

/** @type {Omit<import('./config-types.js').Config, 'mode' | 'dataDir' | 'serverFiles' | 'userFiles'>} */
let defaultConfig = {
  loginMethod: 'password',
  // assume local networks are trusted for header authentication
  trustedProxies: [
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    'fc00::/7',
    '::1/128',
  ],
  port: 5006,
  hostname: '::',
  webRoot: path.join(
    projectRoot,
    'node_modules',
    '@actual-app',
    'web',
    'build',
  ),
  upload: {
    fileSizeSyncLimitMB: 20,
    syncEncryptedFileSizeLimitMB: 50,
    fileSizeLimitMB: 20,
  },
  projectRoot,
  multiuser: false,
  token_expiration: 'never',
};

/** @type {import('./config-types.js').Config} */
let config;
if (process.env.NODE_ENV === 'test') {
  config = {
    mode: 'test',
    dataDir: projectRoot,
    serverFiles: path.join(projectRoot, 'test-server-files'),
    userFiles: path.join(projectRoot, 'test-user-files'),
    ...defaultConfig,
  };
} else {
  config = {
    mode: 'development',
    ...defaultConfig,
    dataDir: defaultDataDir,
    serverFiles: path.join(defaultDataDir, 'server-files'),
    userFiles: path.join(defaultDataDir, 'user-files'),
    ...(userConfig || {}),
  };
}

const finalConfig = {
  ...config,
  loginMethod: process.env.AUTUMN_LOGIN_METHOD
    ? process.env.AUTUMN_LOGIN_METHOD.toLowerCase()
    : config.loginMethod,
  multiuser: process.env.AUTUMN_MULTIUSER
    ? (() => {
        const value = process.env.AUTUMN_MULTIUSER.toLowerCase();
        if (!['true', 'false'].includes(value)) {
          throw new Error('AUTUMN_MULTIUSER must be either "true" or "false"');
        }
        return value === 'true';
      })()
    : config.multiuser,
  trustedProxies: process.env.AUTUMN_TRUSTED_PROXIES
    ? process.env.AUTUMN_TRUSTED_PROXIES.split(',').map((q) => q.trim())
    : config.trustedProxies,
  port: +process.env.AUTUMN_PORT || +process.env.PORT || config.port,
  hostname: process.env.AUTUMN_HOSTNAME || config.hostname,
  serverFiles: process.env.AUTUMN_SERVER_FILES || config.serverFiles,
  userFiles: process.env.AUTUMN_USER_FILES || config.userFiles,
  webRoot: process.env.AUTUMN_WEB_ROOT || config.webRoot,
  https:
    process.env.AUTUMN_HTTPS_KEY && process.env.AUTUMN_HTTPS_CERT
      ? {
          key: process.env.AUTUMN_HTTPS_KEY.replace(/\\n/g, '\n'),
          cert: process.env.AUTUMN_HTTPS_CERT.replace(/\\n/g, '\n'),
          ...(config.https || {}),
        }
      : config.https,
  upload:
    process.env.AUTUMN_UPLOAD_FILE_SYNC_SIZE_LIMIT_MB ||
    process.env.AUTUMN_UPLOAD_SYNC_ENCRYPTED_FILE_SYNC_SIZE_LIMIT_MB ||
    process.env.AUTUMN_UPLOAD_FILE_SIZE_LIMIT_MB
      ? {
          fileSizeSyncLimitMB:
            +process.env.AUTUMN_UPLOAD_FILE_SYNC_SIZE_LIMIT_MB ||
            +process.env.AUTUMN_UPLOAD_FILE_SIZE_LIMIT_MB ||
            config.upload.fileSizeSyncLimitMB,
          syncEncryptedFileSizeLimitMB:
            +process.env.AUTUMN_UPLOAD_SYNC_ENCRYPTED_FILE_SYNC_SIZE_LIMIT_MB ||
            +process.env.AUTUMN_UPLOAD_FILE_SIZE_LIMIT_MB ||
            config.upload.syncEncryptedFileSizeLimitMB,
          fileSizeLimitMB:
            +process.env.AUTUMN_UPLOAD_FILE_SIZE_LIMIT_MB ||
            config.upload.fileSizeLimitMB,
        }
      : config.upload,
  openId: (() => {
    if (
      !process.env.AUTUMN_OPENID_DISCOVERY_URL &&
      !process.env.AUTUMN_OPENID_AUTHORIZATION_ENDPOINT
    ) {
      return config.openId;
    }
    const baseConfig = process.env.AUTUMN_OPENID_DISCOVERY_URL
      ? { issuer: process.env.AUTUMN_OPENID_DISCOVERY_URL }
      : {
          ...(() => {
            const required = {
              authorization_endpoint:
                process.env.AUTUMN_OPENID_AUTHORIZATION_ENDPOINT,
              token_endpoint: process.env.AUTUMN_OPENID_TOKEN_ENDPOINT,
              userinfo_endpoint: process.env.AUTUMN_OPENID_USERINFO_ENDPOINT,
            };
            const missing = Object.entries(required)
              .filter(([_, value]) => !value)
              .map(([key]) => key);
            if (missing.length > 0) {
              throw new Error(
                `Missing required OpenID configuration: ${missing.join(', ')}`,
              );
            }
            return {};
          })(),
          issuer: {
            name: process.env.AUTUMN_OPENID_PROVIDER_NAME,
            authorization_endpoint:
              process.env.AUTUMN_OPENID_AUTHORIZATION_ENDPOINT,
            token_endpoint: process.env.AUTUMN_OPENID_TOKEN_ENDPOINT,
            userinfo_endpoint: process.env.AUTUMN_OPENID_USERINFO_ENDPOINT,
          },
        };
    return {
      ...baseConfig,
      client_id:
        process.env.AUTUMN_OPENID_CLIENT_ID ?? config.openId?.client_id,
      client_secret:
        process.env.AUTUMN_OPENID_CLIENT_SECRET ?? config.openId?.client_secret,
      server_hostname:
        process.env.AUTUMN_OPENID_SERVER_HOSTNAME ??
        config.openId?.server_hostname,
    };
  })(),
  token_expiration: process.env.AUTUMN_TOKEN_EXPIRATION
    ? process.env.AUTUMN_TOKEN_EXPIRATION
    : config.token_expiration,
};
debug(`using port ${finalConfig.port}`);
debug(`using hostname ${finalConfig.hostname}`);
debug(`using data directory ${finalConfig.dataDir}`);
debug(`using server files directory ${finalConfig.serverFiles}`);
debug(`using user files directory ${finalConfig.userFiles}`);
debug(`using web root directory ${finalConfig.webRoot}`);
debug(`using login method ${finalConfig.loginMethod}`);
debug(`using trusted proxies ${finalConfig.trustedProxies.join(', ')}`);

if (finalConfig.https) {
  debug(`using https key: ${'*'.repeat(finalConfig.https.key.length)}`);
  debugSensitive(`using https key ${finalConfig.https.key}`);
  debug(`using https cert: ${'*'.repeat(finalConfig.https.cert.length)}`);
  debugSensitive(`using https cert ${finalConfig.https.cert}`);
}

if (finalConfig.upload) {
  debug(`using file sync limit ${finalConfig.upload.fileSizeSyncLimitMB}mb`);
  debug(
    `using sync encrypted file limit ${finalConfig.upload.syncEncryptedFileSizeLimitMB}mb`,
  );
  debug(`using file limit ${finalConfig.upload.fileSizeLimitMB}mb`);
}

export default finalConfig;