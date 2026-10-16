import { useSyncExternalStore } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  getConnectionState,
  startSearch as nativeStartSearch,
  stopSearch as nativeStopSearch,
  disconnect as nativeDisconnect,
  reconcileState as nativeReconcileState,
  addConnectionStateListener,
  addDeviceFoundListener,
  addDeviceDisconnectedListener,
} from 'entephoto-camera';
import type { ConnectionState } from 'entephoto-camera';

export type GalleryCameraState =
  | 'searching'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'permission_required';

interface CameraConnectionStore {
  state: GalleryCameraState;
  model: string | null;
  listeners: Set<() => void>;
  initialized: boolean;
  subscriptions: { remove: () => void }[];
}

function normalizeState(state: ConnectionState): GalleryCameraState {
  switch (state) {
    case 'connected':
      return 'connected';
    case 'connecting':
      return 'connecting';
    case 'reconnecting':
      return 'reconnecting';
    case 'searching':
      return 'searching';
    case 'permission_required':
      return 'permission_required';
    case 'disconnected':
    case 'idle':
    case 'error':
    default:
      return 'disconnected';
  }
}

const store: CameraConnectionStore = {
  state: 'disconnected',
  model: null,
  listeners: new Set(),
  initialized: false,
  subscriptions: [],
};

function notifyListeners() {
  store.listeners.forEach(listener => {
    try {
      listener();
    } catch (e) {
      console.warn('[CameraConnectionManager] Error in listener:', e);
    }
  });
}

function updateState(newState: GalleryCameraState, newModel?: string | null) {
  let changed = false;
  if (store.state !== newState) {
    store.state = newState;
    changed = true;
  }
  if (newModel !== undefined && store.model !== newModel) {
    store.model = newModel;
    changed = true;
  }
  if (changed) {
    notifyListeners();
  }
}

/**
 * Initializes native event listeners once for the app lifetime.
 */
function ensureInitialized() {
  if (store.initialized) return;
  store.initialized = true;

  try {
    const rawState = getConnectionState();
    store.state = normalizeState(rawState);
  } catch (e) {
    console.warn('[CameraConnectionManager] Failed to get initial native connection state:', e);
  }

  // Subscribe to native state changes
  const stateSub = addConnectionStateListener(event => {
    console.log('[CameraConnectionManager] Native state changed:', event.state);
    const normalized = normalizeState(event.state);
    updateState(normalized);
  });
  store.subscriptions.push(stateSub);

  // Subscribe to device found
  const foundSub = addDeviceFoundListener(event => {
    console.log('[CameraConnectionManager] Device found:', event.deviceName);
    updateState('connected', event.deviceName);
  });
  store.subscriptions.push(foundSub);

  // Subscribe to device disconnected
  const discSub = addDeviceDisconnectedListener(event => {
    console.log('[CameraConnectionManager] Device disconnected, reason:', event.reason);
    if (store.state === 'connected') {
      updateState('disconnected', null);
    }
  });
  store.subscriptions.push(discSub);

  // AppState listener for foreground reconciliation
  const appStateSub = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
    if (nextAppState === 'active') {
      console.log('[CameraConnectionManager] App returned to active — reconciling native state');
      try {
        nativeReconcileState();
        const current = getConnectionState();
        updateState(normalizeState(current));
      } catch (err) {
        console.warn('[CameraConnectionManager] Reconcile error:', err);
      }
    }
  });
  store.subscriptions.push({ remove: () => appStateSub.remove() });
}

function subscribeToStore(onStoreChange: () => void): () => void {
  ensureInitialized();
  store.listeners.add(onStoreChange);
  return () => {
    store.listeners.delete(onStoreChange);
  };
}

function safeGetNativeState(): GalleryCameraState {
  try {
    const rawState = getConnectionState();
    return normalizeState(rawState);
  } catch (e) {
    console.warn('[CameraConnectionManager] getConnectionState failed:', e);
    return 'disconnected';
  }
}

function getStateSnapshot(): GalleryCameraState {
  ensureInitialized();
  return store.state;
}

function getModelSnapshot(): string | null {
  ensureInitialized();
  return store.model;
}

// ── Stable Camera Actions ──────────────────────────────────────────────────

function startSearch(): void {
  ensureInitialized();
  const currentNative = safeGetNativeState();
  if (currentNative === 'connected') {
    // Native RemoteShooting session is already alive — never clobber with 'searching'
    updateState('connected');
    return;
  }
  if (
    currentNative === 'connecting' ||
    currentNative === 'reconnecting' ||
    currentNative === 'permission_required'
  ) {
    // In-flight connection attempt or permission request — preserve native status
    updateState(currentNative);
    return;
  }

  // Camera is disconnected or idle — begin search
  updateState('searching');
  try {
    nativeStartSearch();
    const postSearch = safeGetNativeState();
    if (postSearch !== 'disconnected' && postSearch !== 'searching') {
      updateState(postSearch);
    }
  } catch (e) {
    console.warn('[CameraConnectionManager] startSearch error:', e);
  }
}

function stopSearch(): void {
  ensureInitialized();
  try {
    nativeStopSearch();
    const current = safeGetNativeState();
    updateState(current);
  } catch (e) {
    console.warn('[CameraConnectionManager] stopSearch error:', e);
  }
}

function disconnectCamera(): void {
  ensureInitialized();
  try {
    updateState('disconnected', null);
    nativeDisconnect();
  } catch (e) {
    console.warn('[CameraConnectionManager] disconnect error:', e);
  }
}

function reconcile(): void {
  ensureInitialized();
  try {
    nativeReconcileState();
    const current = safeGetNativeState();
    updateState(current);
  } catch (e) {
    console.warn('[CameraConnectionManager] reconcile error:', e);
  }
}

/**
 * React hook to observe authoritative native camera connection state.
 * Returns stable action callbacks across renders.
 */
export function useCameraConnection() {
  const connectionState = useSyncExternalStore(subscribeToStore, getStateSnapshot);
  const cameraModel = useSyncExternalStore(subscribeToStore, getModelSnapshot);

  return {
    connectionState,
    cameraModel,
    isConnected: connectionState === 'connected',
    isReconnecting: connectionState === 'reconnecting',
    isSearching: connectionState === 'searching',
    isConnecting: connectionState === 'connecting',
    isPermissionRequired: connectionState === 'permission_required',
    isDisconnected: connectionState === 'disconnected',
    startSearch,
    stopSearch,
    disconnectCamera,
    reconcile,
  };
}

export const cameraConnectionManager = {
  getState: (): GalleryCameraState => {
    ensureInitialized();
    return store.state;
  },
  getModel: (): string | null => store.model,
  startSearch,
  stopSearch,
  disconnect: disconnectCamera,
  reconcile,
};
