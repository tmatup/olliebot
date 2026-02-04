# React Compiler & Memoization: What We Learned

This document captures lessons learned from implementing React Compiler (babel-plugin-react-compiler) and understanding when manual memoization is still required.

## TL;DR

React Compiler does NOT eliminate the need for `memo()`, `useCallback()`, and `useMemo()`. In our testing, it only fixed ~20% of unnecessary re-renders. Manual optimization is still required for many common patterns.

---

## What React Compiler Actually Does

React Compiler (formerly "React Forget") performs **static analysis** to automatically memoize:
- Values computed inside components
- Intermediate results and expressions
- Some callback functions within a component

### What It Does NOT Do

1. **Does not memoize list items** - Components rendered via `.map()` are not automatically memoized
2. **Does not prevent parent→child re-renders** - When a parent re-renders, children still re-render unless wrapped in `memo()`
3. **Does not guarantee stable callback references across component boundaries** - Callbacks passed as props may still need `useCallback()`

---

## When You Still Need Manual Memoization

### 1. `React.memo()` - Still Required for List Items

**Problem:** React Compiler does not memoize individual items within lists.

```jsx
// This will STILL re-render all items when parent re-renders
{projects.map((project) => (
  <ProjectItem key={project.id} project={project} />
))}
```

**Solution:** Wrap list item components in `memo()` with a custom comparison function:

```jsx
const ProjectItem = memo(function ProjectItem({ project, onSelect }) {
  return <div onClick={() => onSelect(project.id)}>{project.name}</div>;
}, (prevProps, nextProps) => {
  return (
    prevProps.project === nextProps.project &&
    prevProps.onSelect === nextProps.onSelect
  );
});
```

**Why custom comparison?** The default `memo()` shallow comparison wasn't working reliably with React Compiler in our testing. Explicit comparison functions provide more predictable behavior.

### 2. `useCallback()` - Still Required for Callback Props

**Problem:** Inline arrow functions create new references on every render, breaking child memoization.

```jsx
// BAD - creates new function reference every render
<RAGProjects onToggle={() => toggleAccordion('ragProjects')} />

// GOOD - stable function reference
const handleToggleRagProjects = useCallback(() => {
  toggleAccordion('ragProjects');
}, [toggleAccordion]);

<RAGProjects onToggle={handleToggleRagProjects} />
```

**When useCallback is required:**
- Callback is passed to a memoized child component
- Callback is used as a dependency in `useEffect` or other hooks
- Callback is passed to components that render lists

### 3. `useMemo()` - Still Useful for Expensive Computations

**Problem:** React Compiler may not optimize all expensive computations, especially those with complex dependencies.

```jsx
// May benefit from explicit useMemo
const filteredItems = useMemo(() => {
  return items.filter(item => item.category === selectedCategory)
              .sort((a, b) => a.name.localeCompare(b.name));
}, [items, selectedCategory]);
```

**When useMemo is recommended:**
- Computationally expensive operations (sorting, filtering large arrays)
- Creating objects/arrays passed as props to memoized children
- Values used as dependencies in effects

---

## Patterns That Break Memoization

### 1. Inline Objects/Arrays as Props

```jsx
// BAD - new object reference every render
<Component style={{ color: 'red' }} />
<Component items={[1, 2, 3]} />

// GOOD - stable references
const style = useMemo(() => ({ color: 'red' }), []);
const items = useMemo(() => [1, 2, 3], []);
```

### 2. Functions Defined Inside Render

```jsx
// BAD - new function every render
<Button onClick={() => handleClick(id)} />

// GOOD - stable callback
const handleButtonClick = useCallback(() => handleClick(id), [id]);
<Button onClick={handleButtonClick} />
```

### 3. State Object Property Access

```jsx
// When any accordion changes, ALL children see a "new" prop
const [expandedAccordions, setExpandedAccordions] = useState({});

// Each child gets expanded={expandedAccordions.someKey}
// Even though their specific key didn't change, parent re-renders
```

---

## Our Implementation Strategy

### Components with Custom memo() Comparisons

| Component | Why Custom Comparison Needed |
|-----------|------------------------------|
| `RAGProjects` | Renders list of projects, receives callback props |
| `BrowserSessions` | Renders list of sessions, receives callback props |
| `MessageContent` | Rendered in a list of messages |

### Callbacks Wrapped with useCallback()

| Callback | Location | Dependencies |
|----------|----------|--------------|
| `toggleAccordion` | App.jsx | `[]` (uses functional setState) |
| `handleToggleRagProjects` | App.jsx | `[toggleAccordion]` |
| `handleToggleBrowserSessions` | App.jsx | `[toggleAccordion]` |
| `handleSelectBrowserSession` | App.jsx | `[]` |
| `handleCloseBrowserSession` | App.jsx | `[sendMessage]` |
| `handleIndexProject` | App.jsx | `[]` |
| `handleUploadToProject` | App.jsx | `[]` |
| `sendMessage` | useWebSocket.js | `[]` |

### Key Technique: Functional State Updates

To avoid dependencies on state in callbacks:

```jsx
// BAD - depends on state, callback changes when state changes
const handleClose = useCallback((id) => {
  if (selectedId === id) setSelectedId(null);
}, [selectedId]); // selectedId in deps = new function when it changes

// GOOD - no state dependency, stable callback
const handleClose = useCallback((id) => {
  setSelectedId((prev) => prev === id ? null : prev);
}, []); // empty deps = stable function
```

---

## React 19 Benefits (Non-Compiler)

While React Compiler didn't solve our re-render issues, React 19 provides other benefits:

1. **`ref` as a prop** - No more `forwardRef()` wrapper needed
2. **`use()` hook** - For promises and context
3. **`useActionState`** - For form actions
4. **`useOptimistic`** - For optimistic UI updates
5. **Better error handling** - Improved error boundaries
6. **Document metadata** - `<title>`, `<meta>` in components

---

## Debugging Re-renders

### Custom Comparison with Logging

```jsx
const MyComponent = memo(function MyComponent(props) {
  // component code
}, (prevProps, nextProps) => {
  const keys = Object.keys(prevProps);
  const changed = keys.filter(k => prevProps[k] !== nextProps[k]);
  if (changed.length > 0) {
    console.log('[MyComponent] props changed:', changed);
  }
  return changed.length === 0;
});
```

### React DevTools Profiler

Enable "Highlight updates when components render" to visually see re-renders.

---

## References

- [React Compiler Documentation](https://react.dev/learn/react-compiler)
- [GitHub Issue #33628 - Compiler doesn't memoize list items](https://github.com/facebook/react/issues/33628)
- [I tried React Compiler today](https://www.developerway.com/posts/i-tried-react-compiler)
- [How to stop re-rendering lists in React](https://alexsidorenko.com/blog/react-list-rerender)
- [The Uphill Battle of Memoization](https://tkdodo.eu/blog/the-uphill-battle-of-memoization)

---

## Conclusion

React Compiler is not a silver bullet. For production apps with complex component trees and lists, you still need:

1. **`memo()`** with custom comparison for list item components
2. **`useCallback()`** for callbacks passed to memoized children
3. **`useMemo()`** for expensive computations and object/array props
4. **Functional state updates** to keep callback dependencies minimal

The compiler helps with simple cases but doesn't replace understanding React's rendering behavior.
