
import { GrokZephyrApp } from '@/app/GrokZephyrApp.js';
import { OnboardingManager } from '@/ui/OnboardingManager.js';

function main(): void {
  // Show onboarding if first time
  const onboarding = new OnboardingManager();
  onboarding.showIfNew();

  const app = new GrokZephyrApp();
  app.appBootManager.initialize().catch(console.error);
  
  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    app.destroy();
  });
  
  // Expose for debugging
  (window as unknown as { zephyr: GrokZephyrApp }).zephyr = app;
}

// Start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}

export default GrokZephyrApp;
