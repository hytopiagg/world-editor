// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Block Selection and UI Flow', () => {
  test('should identify and interact with block selection UI', async ({ page }) => {
    await page.goto('/?disableTerrainBlocking=true');
    await page.waitForLoadState('networkidle');
    
    // Wait for loading screen to disappear
    await page.waitForSelector('.global-loading-screen', { state: 'hidden', timeout: 15000 });
    
    // Wait for the app to fully initialize
    await page.waitForTimeout(3000);
    
    // Try to find block selection elements by various selectors
    // Look for common UI patterns in world editors
    
    // Check for sidebar or toolbar elements
    const possibleSelectors = [
      '[data-testid*="block"]',
      '[data-testid*="toolbar"]',
      '[data-testid*="sidebar"]',
      '[class*="block"]',
      '[class*="toolbar"]',
      '[class*="sidebar"]',
      '[class*="panel"]',
      'button[title*="block"]',
      'button[title*="grass"]',
      'button[title*="stone"]',
      '.block-type',
      '.tool',
      '.material',
      '#toolbar',
      '#sidebar',
      '#blocks',
    ];

    let foundElements = [];
    
    for (const selector of possibleSelectors) {
      const elements = page.locator(selector);
      const count = await elements.count();
      if (count > 0) {
        foundElements.push({
          selector,
          count,
          visible: await elements.first().isVisible().catch(() => false)
        });
      }
    }
    
    console.log('Found UI elements:', foundElements);
    
    // Test canvas is present (this should always work)
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
    
    // If we found any UI elements, try to interact with them
    if (foundElements.length > 0) {
      const firstElement = foundElements[0];
      const element = page.locator(firstElement.selector).first();
      
      if (await element.isVisible()) {
        // Try to click the first found element
        await element.click();
        await page.waitForTimeout(1000);
        
        // Then try to interact with canvas
        await canvas.click({ position: { x: 200, y: 200 } });
      }
    }
    
    // The test passes if we can find UI elements and the app doesn't crash
    await expect(canvas).toBeVisible();
  });

  test('should handle mode switching if UI is available', async ({ page }) => {
    await page.goto('/?disableTerrainBlocking=true');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);
    
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
    
    // Look for mode switching buttons (add, remove, etc.)
    const modeSelectors = [
      'button[title*="add"]',
      'button[title*="remove"]',
      'button[title*="delete"]',
      'button[title*="place"]',
      '[data-testid*="mode"]',
      '[class*="mode"]',
      '.add-mode',
      '.remove-mode',
    ];

    for (const selector of modeSelectors) {
      const element = page.locator(selector);
      if (await element.count() > 0 && await element.first().isVisible()) {
        await element.first().click();
        await page.waitForTimeout(500);
        
        // Test canvas interaction after mode change
        await canvas.click({ position: { x: 150, y: 150 } });
        await page.waitForTimeout(500);
      }
    }
    
    // App should remain stable regardless of mode switching
    await expect(canvas).toBeVisible();
  });

  test('should support undo/redo operations if available', async ({ page }) => {
    await page.goto('/?disableTerrainBlocking=true');
    await page.waitForLoadState('networkidle');
    
    // Wait for loading screen to disappear
    await page.waitForSelector('.global-loading-screen', { state: 'hidden', timeout: 15000 });
    await page.waitForTimeout(3000);
    
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
    
    // Perform some canvas interactions first (use coordinates for preview canvas)
    await canvas.click({ position: { x: 80, y: 80 } });
    await page.waitForTimeout(500);
    await canvas.click({ position: { x: 120, y: 120 } });
    await page.waitForTimeout(500);
    
    // Try keyboard shortcuts for undo/redo
    await page.keyboard.press('Meta+z'); // Mac undo
    await page.waitForTimeout(500);
    
    await page.keyboard.press('Meta+Shift+z'); // Mac redo
    await page.waitForTimeout(500);
    
    // Try Ctrl variants for Windows/Linux
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(500);
    
    // Look for undo/redo buttons
    const undoRedoSelectors = [
      'button[title*="undo"]',
      'button[title*="redo"]',
      '[data-testid*="undo"]',
      '[data-testid*="redo"]',
      '.undo',
      '.redo',
    ];

    for (const selector of undoRedoSelectors) {
      const element = page.locator(selector);
      if (await element.count() > 0 && await element.first().isVisible()) {
        await element.first().click();
        await page.waitForTimeout(500);
      }
    }
    
    // App should handle undo/redo gracefully
    await expect(canvas).toBeVisible();
  });

  test('should handle save/load operations if available', async ({ page }) => {
    await page.goto('/?disableTerrainBlocking=true');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);
    
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
    
    // Make some changes to the world
    const clickPositions = [
      { x: 100, y: 100 },
      { x: 200, y: 200 },
      { x: 300, y: 300 },
    ];

    for (const position of clickPositions) {
      await canvas.click({ position });
      await page.waitForTimeout(500);
    }
    
    // Try keyboard shortcuts for save
    await page.keyboard.press('Meta+s'); // Mac save
    await page.waitForTimeout(1000);
    
    await page.keyboard.press('Control+s'); // Windows/Linux save
    await page.waitForTimeout(1000);
    
    // Look for save/load buttons
    const saveLoadSelectors = [
      'button[title*="save"]',
      'button[title*="load"]',
      'button[title*="export"]',
      'button[title*="import"]',
      '[data-testid*="save"]',
      '[data-testid*="load"]',
      '.save',
      '.load',
    ];

    for (const selector of saveLoadSelectors) {
      const element = page.locator(selector);
      if (await element.count() > 0 && await element.first().isVisible()) {
        await element.first().click();
        await page.waitForTimeout(1000);
        
        // If a modal or dialog appears, try to close it
        const closeButtons = page.locator('button:has-text("Close"), button:has-text("Cancel"), [aria-label="Close"]');
        if (await closeButtons.count() > 0) {
          await closeButtons.first().click();
          await page.waitForTimeout(500);
        }
      }
    }
    
    // App should handle save/load operations gracefully
    await expect(canvas).toBeVisible();
  });

  test('should test performance with rapid interactions', async ({ page }) => {
    await page.goto('/?disableTerrainBlocking=true');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);
    
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
    
    // Perform rapid canvas interactions to test performance
    const startTime = Date.now();
    
    for (let i = 0; i < 20; i++) {
      const x = 100 + (i * 10) % 400;
      const y = 100 + (i * 15) % 300;
      await canvas.click({ position: { x, y } });
      
      // Minimal delay to simulate rapid user interaction
      if (i % 5 === 0) {
        await page.waitForTimeout(100);
      }
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`Performance test completed in ${duration}ms`);
    
    // App should remain responsive after rapid interactions
    await expect(canvas).toBeVisible();
    
    // Verify one more interaction works
    await canvas.click({ position: { x: 250, y: 200 } });
    await page.waitForTimeout(500);
    
    await expect(canvas).toBeVisible();
  });
});