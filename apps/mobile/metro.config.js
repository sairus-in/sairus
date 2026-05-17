const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// pnpm hoists packages to workspace root; Metro's entry-point resolver only
// checks the project-local node_modules, so we redirect every lookup to the
// workspace root as a fallback.
config.resolver.extraNodeModules = new Proxy(
  {},
  {
    get: (_, name) =>
      path.resolve(workspaceRoot, `node_modules/${String(name)}`),
  }
);
config.resolver.blockList = exclusionList([
  /apps[/\\]mobile[/\\]android[/\\]\.gradle[/\\].*/,
]);

module.exports = config;
