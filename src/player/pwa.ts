import { registerSW } from 'virtual:pwa-register';
import type { ReligiousPeriod } from '../domain/types';
import type { PlayerScheduler } from './scheduler';
import { scheduleDailyReload } from './reload';

const UPDATE_CHECK_MS = 6 * 60 * 60_000;

export function registerPlayerPwa(
  scheduler: PlayerScheduler,
  getPeriods: () => readonly ReligiousPeriod[],
): () => void {
  let updatePending = false;
  let applyUpdate: (reloadPage?: boolean) => Promise<void> = async () => undefined;
  let stopUpdateChecks: (() => void) | null = null;

  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      updatePending = true;
    },
    onRegisteredSW(_scriptUrl, registration) {
      if (!registration) return;
      stopUpdateChecks?.();
      stopUpdateChecks = scheduler.every(() => {
        void registration.update().catch(() => undefined);
      }, UPDATE_CHECK_MS);
    },
  });

  const stopReload = scheduleDailyReload(scheduler, getPeriods, () => {
    if (updatePending) {
      updatePending = false;
      void applyUpdate(true).catch(() => window.location.reload());
    } else {
      window.location.reload();
    }
  });

  return () => {
    stopReload();
    stopUpdateChecks?.();
  };
}
