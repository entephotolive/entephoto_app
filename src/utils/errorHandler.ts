/**
 * Global Error and Unhandled Promise Rejection Handler
 */

export function setupGlobalErrorHandlers(): void {
  const globalAny = globalThis as any;

  // 1. Unhandled synchronous / fatal JS errors
  if (globalAny.ErrorUtils) {
    const defaultHandler =
      typeof globalAny.ErrorUtils.getGlobalHandler === 'function'
        ? globalAny.ErrorUtils.getGlobalHandler()
        : null;

    globalAny.ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
      console.error(
        `🚨 [GlobalErrorHandler] Uncaught ${isFatal ? 'FATAL ' : ''}JS Exception:`,
        error,
        error?.stack ? `\nStack: ${error.stack}` : '',
      );
      if (defaultHandler) {
        defaultHandler(error, isFatal);
      }
    });
  }

  // 2. Unhandled Promise Rejections
  try {
    // React Native's bundled Promise library support
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tracking = require('promise/setimmediate/rejection-tracking');
    if (tracking && typeof tracking.enable === 'function') {
      tracking.enable({
        allRejections: true,
        onUnhandled: (id: any, rejection: any) => {
          console.error(
            `🚨 [GlobalPromiseHandler] Unhandled Promise Rejection (id: ${id}):`,
            rejection,
            rejection?.stack ? `\nStack: ${rejection.stack}` : '',
          );
        },
        onHandled: () => {},
      });
    }
  } catch (e) {
    console.warn('[GlobalErrorHandler] Could not initialize promise rejection tracking:', e);
  }
}
