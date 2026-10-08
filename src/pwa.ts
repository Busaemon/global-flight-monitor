type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export type PwaState = {
  canInstall: boolean;
  installed: boolean;
  updateAvailable: boolean;
  updating: boolean;
  registrationFailed: boolean;
  updateFailed: boolean;
  installFailed: boolean;
};

const listeners = new Set<() => void>();
let installPrompt: InstallPromptEvent | null = null;
let registration: ServiceWorkerRegistration | null = null;
let registrationStarted = false;
let reloadRequested = false;
let updateTimeout: ReturnType<typeof setTimeout> | undefined;
const standaloneDisplay = window.matchMedia('(display-mode: standalone)');

function isInstalled() {
  return standaloneDisplay.matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

let state: PwaState = {
  canInstall: false,
  installed: isInstalled(),
  updateAvailable: false,
  updating: false,
  registrationFailed: false,
  updateFailed: false,
  installFailed: false,
};

function setState(changes: Partial<PwaState>) {
  state = { ...state, ...changes };
  listeners.forEach((listener) => listener());
}

export function subscribePwa(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getPwaState() {
  return state;
}

window.addEventListener('beforeinstallprompt', (event) => {
  const prompt = event as InstallPromptEvent;
  if (typeof prompt.prompt !== 'function' || !prompt.userChoice) return;
  event.preventDefault();
  installPrompt = prompt;
  setState({ canInstall: true, installFailed: false });
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  setState({ installed: true, canInstall: false, installFailed: false });
});

standaloneDisplay.addEventListener('change', () => setState({ installed: isInstalled() }));

export async function installPwa() {
  const prompt = installPrompt;
  if (!prompt) return;
  installPrompt = null;
  setState({ canInstall: false, installFailed: false });
  try {
    await prompt.prompt();
    await prompt.userChoice;
  } catch {
    setState({ installFailed: true });
  }
}

export function applyPwaUpdate() {
  const worker = registration?.waiting;
  if (state.updating || !state.updateAvailable) return;
  if (!worker) {
    // Another open SKYTRACE window may already have activated the new worker.
    window.location.reload();
    return;
  }
  reloadRequested = true;
  setState({ updating: true, updateFailed: false });
  worker.postMessage({ type: 'SKIP_WAITING' });
  clearTimeout(updateTimeout);
  updateTimeout = setTimeout(() => {
    reloadRequested = false;
    setState({ updating: false, updateFailed: true });
  }, 10_000);
}

async function registerWorker() {
  try {
    registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });
    if (registration.waiting) setState({ updateAvailable: true });

    const watchInstalling = () => {
      const worker = registration?.installing;
      if (!worker) return;
      const onStateChange = () => {
        if (worker.state === 'installed') {
          setState({
            updateAvailable: Boolean(navigator.serviceWorker.controller),
            registrationFailed: false,
          });
        } else if (worker.state === 'redundant' && !navigator.serviceWorker.controller) {
          setState({ registrationFailed: true });
        }
      };
      worker.addEventListener('statechange', onStateChange);
      onStateChange();
    };
    watchInstalling();
    registration.addEventListener('updatefound', watchInstalling);

    let lastUpdateCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastUpdateCheck < 15 * 60_000) return;
      lastUpdateCheck = Date.now();
      void registration?.update().catch(() => {});
    });
  } catch {
    setState({ registrationFailed: true });
  }
}

export function registerPwa() {
  if (registrationStarted || !import.meta.env.PROD || !window.isSecureContext
    || !('serviceWorker' in navigator)) return;
  registrationStarted = true;
  let previousController = navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const changedFromPrevious = previousController
      && previousController !== navigator.serviceWorker.controller;
    previousController = navigator.serviceWorker.controller;
    if (reloadRequested) {
      reloadRequested = false;
      clearTimeout(updateTimeout);
      window.location.reload();
    } else if (changedFromPrevious) {
      setState({ updateAvailable: true, updating: false, updateFailed: false });
    }
  });
  if (document.readyState === 'complete') void registerWorker();
  else window.addEventListener('load', () => { void registerWorker(); }, { once: true });
}
