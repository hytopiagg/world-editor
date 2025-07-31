import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
// Mock external ESM-only libraries that aren’t needed for this isolated test.
jest.mock('@hcaptcha/react-hcaptcha', () => () => null);
// Mock BlockTypesManager to avoid webpack-specific require.context
jest.mock('../js/managers/BlockTypesManager', () => ({
    blockTypes: [],
    getCustomBlocks: () => [],
    processCustomBlock: jest.fn(),
    removeCustomBlock: jest.fn(),
    updateCustomBlockName: jest.fn(),
}));
// Mock heavy three.js example modules
jest.mock('three/examples/jsm/loaders/GLTFLoader', () => ({ GLTFLoader: jest.fn() }));
jest.mock('three/examples/jsm/utils/BufferGeometryUtils', () => ({ mergeGeometries: jest.fn() }));
jest.mock('three/examples/jsm/controls/OrbitControls', () => ({ OrbitControls: jest.fn() }));
// Mock components that depend on EnvironmentBuilder or other heavy logic
const componentStubs = [
    'AIAssistantPanel',
    'BlockOptionsSection',
    'ComponentOptionsSection',
    'DebugInfo',
    'GroundToolOptionsSection',
    'ModelOptionsSection',
    'SettingsMenu',
    'WallToolOptionsSection',
    'SelectionToolOptionsSection',
    'TerrainToolOptionsSection',
    'ReplaceToolOptionsSection',
    'SkyboxOptionsSection',
];
for (const comp of componentStubs) {
    jest.mock(`../js/components/${comp}`, () => () => null);
}
// Mock EnvironmentBuilder exports
jest.mock('../js/EnvironmentBuilder', () => ({ environmentModels: [] }));

// CollapsibleSection uses react-icons, which work fine under JSDOM without additional mocks.

// Dynamically import the component from its module. This avoids potential circular
// dependencies between test and component code in the commonjs build Jest uses.
// Import the module and grab the named export.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CollapsibleSection } = require('../js/components/BlockToolOptions');

// Type guard to ensure we actually have the component
if (!CollapsibleSection) {
    throw new Error('CollapsibleSection export not found – check BlockToolOptions.tsx.');
}

describe('CollapsibleSection component', () => {
    const TITLE = 'Section Title';
    const CONTENT_TEXT = 'Hello world';

    function renderComponent() {
        return render(
            <CollapsibleSection title={TITLE}>
                <p data-testid="content">{CONTENT_TEXT}</p>
            </CollapsibleSection>
        );
    }

    it('shows its children content by default', () => {
        renderComponent();
        expect(screen.getByTestId('content')).toBeInTheDocument();
    });

    it('hides content when header is clicked and shows it again when clicked twice', () => {
        renderComponent();
        const headerButton = screen.getByRole('button', { name: /section title/i });

        // First click – collapse
        fireEvent.click(headerButton);
        expect(screen.queryByTestId('content')).not.toBeInTheDocument();

        // Second click – expand again
        fireEvent.click(headerButton);
        expect(screen.getByTestId('content')).toBeInTheDocument();
    });
});
