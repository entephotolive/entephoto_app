const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = path.resolve(__dirname);
const config = getDefaultConfig(projectRoot);

// Allow Metro to follow Windows junctions/symlinks (needed for C:\pc → E:\Desktop\... junction)
config.resolver = {
  ...config.resolver,

  // Add .mjs so Metro can parse ESM modules on any platform
  sourceExts: [...(config.resolver.sourceExts ?? []), 'mjs'],

  // Redirect `lucide-react-native` to its CJS barrel for ALL platforms.
  //
  // Why: lucide-react-native v1.43 ships an ESM barrel (dist/esm/lucide-react-native.mjs)
  // that re-exports from individual ./icons/*.mjs files. Some of those files are missing
  // (e.g. album.mjs) because the icon was removed but the barrel wasn't updated.
  // Metro picks up the ESM entrypoint via package.json "exports", then fails when
  // it tries to resolve the missing individual icon files.
  //
  // The CJS barrel (dist/cjs/lucide-react-native.js) is a single self-contained file
  // and works correctly on all platforms (Android, iOS, web).
  resolveRequest: (context, moduleName, platform) => {
    if (moduleName === 'lucide-react-native') {
      return {
        filePath: path.resolve(
          projectRoot,
          'node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
        ),
        type: 'sourceFile',
      };
    }
    // Default resolution for everything else
    return context.resolveRequest(context, moduleName, platform);
  },
};

// Watch both the junction path and the real path
config.watchFolders = [projectRoot];

module.exports = withNativeWind(config, { input: './global.css' });
