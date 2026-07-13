/**
 * Grok Zephyr - Main Entry Point
 *
 * Thin bootstrap — application lifecycle lives in src/app/App.ts.
 */

import { OnboardingManager } from '@/ui/OnboardingManager.js';
import { App } from '@/app/App.js';

import './styles.css';
import './styles/onboarding.css';
import './styles/fleet-cockpit.css';

function main(): void {
  const onboarding = new OnboardingManager();
  onboarding.showIfNew();

  const app = new App();
  void app.initialize().catch((err: unknown) => {
    console.error(err);
  });

  window.addEventListener('beforeunload', () => {
    app.destroy();
  });

  (window as unknown as { zephyr: App }).zephyr = app;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}

export { App, App as GrokZephyrApp } from '@/app/App.js';
export default App;
