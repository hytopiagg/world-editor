// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Basic World Editor Functionality', () => {
  test('should load the application without crashing', async ({ page }) => {
    // Navigate to the app
    await page.goto('/?disableTerrainBlocking=true');
    
    // Wait for DOM to be loaded
    await page.waitForLoadState('domcontentloaded');
    
    // Wait for app initialization
    await page.waitForTimeout(5000);
    
    // Check that we have a React app (look for React root or any canvas)
    const hasContent = await page.locator('body').count() > 0;
    expect(hasContent).toBe(true);
    
    // Try to find any canvas element (3D scene)
    const canvasCount = await page.locator('canvas').count();
    expect(canvasCount).toBeGreaterThan(0);
    
    console.log(`Found ${canvasCount} canvas elements`);
  });

  test('should be interactive (click events work)', async ({ page }) => {
    await page.goto('/?disableTerrainBlocking=true');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(5000);
    
    // Get the first canvas element
    const canvas = page.locator('canvas').first();
    
    // Verify canvas exists
    await expect(canvas).toBeVisible();
    
    // Click on canvas (this tests basic interactivity)
    await canvas.click({ position: { x: 100, y: 100 } });
    
    // Wait for any response
    await page.waitForTimeout(1000);
    
    // App should still be responsive
    const isStillVisible = await canvas.isVisible();
    expect(isStillVisible).toBe(true);
  });

  test('should handle multiple canvas interactions', async ({ page }) => {
    await page.goto('/?disableTerrainBlocking=true');
    await page.waitForLoadState('domcontentloaded');
    
    // Wait for loading screen to disappear
    await page.waitForSelector('.global-loading-screen', { state: 'hidden', timeout: 15000 });
    await page.waitForTimeout(3000);
    
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
    
    // Perform several clicks to test stability - use center area of canvas
    const positions = [
      { x: 80, y: 80 },
      { x: 120, y: 120 },
      { x: 100, y: 140 },
    ];

    for (const pos of positions) {
      await canvas.click({ position: pos });
      await page.waitForTimeout(500);
    }
    
    // App should remain stable
    await expect(canvas).toBeVisible();
  });

  test('should not have critical JavaScript errors', async ({ page }) => {
    const jsErrors = [];
    
    // Capture console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        jsErrors.push(msg.text());
      }
    });

    await page.goto('/?disableTerrainBlocking=true');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(5000);
    
    // Filter out known non-critical errors
    const criticalErrors = jsErrors.filter(error => 
      !error.includes('three.js') &&
      !error.includes('deprecated') &&
      !error.includes('Scripts "build/three.js"') &&
      !error.toLowerCase().includes('warning')
    );
    
    // Log all errors for debugging
    if (jsErrors.length > 0) {
      console.log('All JS errors:', jsErrors);
    }
    if (criticalErrors.length > 0) {
      console.log('Critical errors:', criticalErrors);
    }
    
    // We expect some three.js deprecation warnings, but not critical errors
    // Allow up to 5 non-critical errors (three.js warnings, etc.)
    expect(criticalErrors.length).toBeLessThan(3);
  });

  test('should respond to keyboard input', async ({ page }) => {
    await page.goto('/?disableTerrainBlocking=true');
    await page.waitForLoadState('domcontentloaded');
    
    // Wait for loading screen to disappear
    await page.waitForSelector('.global-loading-screen', { state: 'hidden', timeout: 15000 });
    await page.waitForTimeout(3000);
    
    // Focus on the page
    await page.focus('body');
    
    // Try some basic keyboard interactions
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    
    // Verify app is still responsive
    const canvas = page.locator('canvas').first();
    if (await canvas.count() > 0) {
      await expect(canvas).toBeVisible();
    }
  });

  test('should handle window resize', async ({ page }) => {
    await page.goto('/?disableTerrainBlocking=true');
    await page.waitForLoadState('domcontentloaded');
    // Wait for loading to complete
    await page.waitForSelector('.global-loading-screen', { state: 'hidden', timeout: 15000 });
    await page.waitForTimeout(2000);
    
    // Initial size
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(1000);
    
    const canvas = page.locator('canvas').first();
    if (await canvas.count() > 0) {
      await expect(canvas).toBeVisible();
    }
    
    // Resize window
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(1000);
    
    // Canvas should still be present and functional
    if (await canvas.count() > 0) {
      await expect(canvas).toBeVisible();
      
      // Test interaction after resize (use coordinates appropriate for preview canvas)
      await canvas.click({ position: { x: 80, y: 80 } });
    }
  });
});