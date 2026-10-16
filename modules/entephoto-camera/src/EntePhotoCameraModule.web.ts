import { registerWebModule, NativeModule } from 'expo';

// EntePhotoCameraModule is not available on the web platform.
class EntePhotoCameraModule extends NativeModule<Record<string, never>> {
  getStatus(): string {
    return 'ready';
  }
  getConnectionState(): string {
    return 'idle';
  }
  startSearch(): void {}
  stopSearch(): void {}
  disconnect(): void {}
}

export default registerWebModule(EntePhotoCameraModule, 'EntePhotoCameraModule');
