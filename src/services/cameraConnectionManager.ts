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
import { notificationService } from './notifications/notificationService';

export type GalleryCameraState =
  | 'searching'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'permission_required';

export type DiscoveryOutcome = 'idle' | 'searching' | 'found' | 'not_found';

const DISCOVERY_TIMEOUT_MS = 10_000;
let discoveryTimer: ReturnType<typeof setTimeout> | null = null;

interface CameraConnectionStore {
  state: GalleryCameraState;
  model: string | null;
  discoveryOutcome: DiscoveryOutcome;
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
  discoveryOutcome: 'idle',
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

function setDiscoveryOutcome(outcome: DiscoveryOutcome) {
  if (store.discoveryOutcome !== outcome) {
    store.discoveryOutcome = outcome;
    notifyListeners();
  }
}

function clearDiscoveryTimer() {
  if (discoveryTimer !== null) {
    clearTimeout(discoveryTimer);
    discoveryTimer = null;
  }
}

function handleDiscoveryTimeout() {
  discoveryTimer = null;

  // Verify the camera is still genuinely in searching state
  const currentNative = safeGetNativeState();
  if (
    store.state !== 'searching' ||
    currentNative === 'connected' ||
    currentNative === 'connecting' ||
    currentNative === 'reconnecting' ||
    currentNative === 'permission_required'
  ) {
    // Camera is connected, connecting, or permission is requested — do not interrupt
    if (currentNative === 'connected' || store.state === 'connected') {
      setDiscoveryOutcome('found');
    }
    return;
  }

  console.log(
    '[CameraConnectionManager] 10s discovery timeout reached with no camera found. Stopping search.',
  );
  // Record not_found outcome separately from native connection state
  setDiscoveryOutcome('not_found');
  notificationService.dismissCamera();

  try {
    nativeStopSearch();
  } catch (e) {
    console.warn('[CameraConnectionManager] stopSearch error on timeout:', e);
  }

  const postStop = safeGetNativeState();
  updateState(postStop);
}

function startDiscoveryTimer() {
  clearDiscoveryTimer();
  discoveryTimer = setTimeout(() => {
    handleDiscoveryTimeout();
  }, DISCOVERY_TIMEOUT_MS);
}

function syncNotificationForState(state: GalleryCameraState, model: string | null) {
  switch (state) {
    case 'searching':
      notificationService.showCameraSearching();
      break;
    case 'connected':
      notificationService.showCameraConnected(model);
      break;
    case 'disconnected':
    case 'permission_required':
      notificationService.dismissCamera();
      break;
    default:
      // connecting / reconnecting: preserve ongoing notification state
      break;
  }
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
    syncNotificationForState(store.state, store.model);
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
    if (
      normalized === 'connecting' ||
      normalized === 'connected' ||
      normalized === 'reconnecting' ||
      normalized === 'permission_required'
    ) {
      clearDiscoveryTimer();
      if (normalized === 'connected') {
        setDiscoveryOutcome('found');
      }
    }
    updateState(normalized);
  });
  store.subscriptions.push(stateSub);

  // Subscribe to device found
  const foundSub = addDeviceFoundListener(event => {
    console.log('[CameraConnectionManager] Device found:', event.deviceName);
    clearDiscoveryTimer();
    setDiscoveryOutcome('found');
    updateState('connected', event.deviceName);
  });
  store.subscriptions.push(foundSub);

  // Subscribe to device disconnected
  const discSub = addDeviceDisconnectedListener(event => {
    console.log('[CameraConnectionManager] Device disconnected, reason:', event.reason);
    if (store.state === 'connected') {
      setDiscoveryOutcome('idle');
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
        const normalized = normalizeState(current);
        if (
          normalized === 'connecting' ||
          normalized === 'connected' ||
          normalized === 'reconnecting' ||
          normalized === 'permission_required'
        ) {
          clearDiscoveryTimer();
          if (normalized === 'connected') {
            setDiscoveryOutcome('found');
          }
        }
        updateState(normalized);
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

function getDiscoveryOutcomeSnapshot(): DiscoveryOutcome {
  ensureInitialized();
  return store.discoveryOutcome;
}

// ── Stable Camera Actions ──────────────────────────────────────────────────

function startSearch(forceRestart: boolean = false): void {
  ensureInitialized();
  const currentNative = safeGetNativeState();
  if (currentNative === 'connected') {
    // Native RemoteShooting session is already alive — never clobber with 'searching'
    clearDiscoveryTimer();
    setDiscoveryOutcome('found');
    updateState('connected');
    return;
  }
  if (
    currentNative === 'connecting' ||
    currentNative === 'reconnecting' ||
    currentNative === 'permission_required'
  ) {
    // In-flight connection attempt or permission request — preserve native status
    clearDiscoveryTimer();
    updateState(currentNative);
    return;
  }

  if (!forceRestart && store.state === 'searching' && discoveryTimer !== null) {
    // A discovery attempt is already actively in progress with an active timer.
    // Prevent overlapping timers or resets from repeated renders.
    return;
  }

  // Camera is disconnected or idle — begin genuine new discovery attempt
  clearDiscoveryTimer();
  setDiscoveryOutcome('searching');
  updateState('searching');
  startDiscoveryTimer();

  // Prompt for notification permission on Android 13+ at user interaction point
  notificationService.ensurePermission().catch(() => {});

  try {
    nativeStartSearch();
    const postSearch = safeGetNativeState();
    if (postSearch !== 'disconnected' && postSearch !== 'searching') {
      if (
        postSearch === 'connecting' ||
        postSearch === 'connected' ||
        postSearch === 'reconnecting' ||
        postSearch === 'permission_required'
      ) {
        clearDiscoveryTimer();
        if (postSearch === 'connected') {
          setDiscoveryOutcome('found');
        }
      }
      updateState(postSearch);
    }
  } catch (e) {
    console.warn('[CameraConnectionManager] startSearch error:', e);
  }
}

function stopSearch(): void {
  ensureInitialized();
  clearDiscoveryTimer();
  if (store.discoveryOutcome === 'searching') {
    setDiscoveryOutcome('idle');
  }
  notificationService.dismissCamera();
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
  clearDiscoveryTimer();
  setDiscoveryOutcome('idle');
  notificationService.dismissCamera();
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
    if (
      current === 'connecting' ||
      current === 'connected' ||
      current === 'reconnecting' ||
      current === 'permission_required'
    ) {
      clearDiscoveryTimer();
      if (current === 'connected') {
        setDiscoveryOutcome('found');
      }
    }
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
  const discoveryOutcome = useSyncExternalStore(subscribeToStore, getDiscoveryOutcomeSnapshot);

  return {
    connectionState,
    cameraModel,
    discoveryOutcome,
    isNotFound: discoveryOutcome === 'not_found',
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
  getDiscoveryOutcome: (): DiscoveryOutcome => {
    ensureInitialized();
    return store.discoveryOutcome;
  },
  startSearch,
  stopSearch,
  disconnect: disconnectCamera,
  reconcile,
};
