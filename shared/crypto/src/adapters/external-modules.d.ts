// Ambient declarations for the platform libsodium bindings. The adapters cast
// these to the `Sodium` interface, so a structural `any` here is enough for any
// consumer's tsc to resolve the imports regardless of which package is installed
// in that project (web installs libsodium-wrappers-sumo; mobile installs
// react-native-libsodium). The real modules are resolved by each bundler.
declare module 'react-native-libsodium';
declare module 'libsodium-wrappers-sumo';
