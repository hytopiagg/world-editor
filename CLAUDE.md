# HYTOPIA World Editor Commands & Conventions

## Build & Development Commands
- `npm start` - Run development server (localhost:3000)
- `npm run build` - Build optimized production bundle
- `npm test` - Run tests in watch mode
- `npm test -- --testPathPattern=path/to/test` - Run specific test file

## Code Style Guidelines
- **Imports**: Group imports: React first, third-party libraries, then local imports
- **Components**: Use functional components with React hooks
- **Naming**: PascalCase for components, camelCase for functions/variables, UPPER_CASE for constants
- **Documentation**: JSDoc-style comments for classes/functions
- **File Structure**: Group related files in appropriate subdirectories under src/js/
- **Error Handling**: Log errors with console.error(), provide user-friendly alerts for UI errors
- **React Patterns**: Use memo for performance-critical components, explicit prop types
- **Tool Architecture**: All tools extend BaseTool class, implementing required lifecycle methods
- **State Management**: Use React hooks (useState/useRef) for component state
- **CSS**: Component-specific CSS files in src/css/ with matching component names