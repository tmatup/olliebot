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

**Problem:** Inline functions create new references on every render, which breaks `memo()`.

**Example of the problem:**

```jsx
// Parent component re-renders (e.g., user types in input)
function App() {
  const [input, setInput] = useState('');

  // WITHOUT useCallback: new function created EVERY render
  const handleToggle = () => toggleAccordion('rag');

  // Even though RAGProjects is wrapped in memo(),
  // it re-renders because handleToggle is a "new" prop every time
  return <RAGProjects onToggle={handleToggle} />
}
```

**The chain of events:**
1. User types → `input` state changes → App re-renders
2. App re-renders → `handleToggle` is recreated (new function reference)
3. `memo()` compares props: `prevProps.onToggle !== nextProps.onToggle` (different references!)
4. RAGProjects re-renders even though nothing meaningful changed

**Solution with useCallback:**

```jsx
const handleToggle = useCallback(() => {
  toggleAccordion('rag');
}, []); // Same function reference across renders
```

Now `memo()` sees `prevProps.onToggle === nextProps.onToggle` and skips the re-render.

**Why doesn't React Compiler fix this?**

React Compiler memoizes values **inside** a component, but it doesn't guarantee that memoized values stay stable **across the parent-child boundary** when passed as props. The [GitHub issue #33628](https://github.com/facebook/react/issues/33628) confirms this is a known limitation.

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
| `SourcePanel` | Receives citations prop |
| `SourceCard` | Rendered in a list of sources |
| `ChatInput` | Receives many callback props |
| `EvalSidebar` | Receives callback props for selection |
| `EvalRunner` | Receives callback props, renders EvalJsonEditor |
| `EvalJsonEditor` | Receives onSave callback |
| `EvalResults` | Receives onClose callback |
| `EvalInputBar` | Manages local input state (same pattern as ChatInput) |

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
| `handleSubmit` | App.jsx | `[sendMessage]` (uses refs for other deps) |
| `handlePaste` | App.jsx | `[]` |
| `removeAttachment` | App.jsx | `[]` |
| `handleSelectEvaluation` | App.jsx | `[navigate]` |
| `handleSelectSuite` | App.jsx | `[navigate]` |
| `handleSelectResult` | App.jsx | `[navigate]` |
| `handleEvalBack` | App.jsx | `[navigate]` |
| `handleCloseBrowserPreview` | App.jsx | `[]` |
| `loadEvaluationDetails` | EvalRunner.jsx | `[]` |
| `handleSave` | EvalRunner.jsx | `[]` |
| `handleCloseResults` | EvalRunner.jsx | `[]` |
| `runEvaluation` | EvalRunner.jsx | `[]` (uses ref for evaluation) |

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

## Debugging Re-renders: Step-by-Step Walkthrough

This section shows how to debug and fix a component that's not memoizing correctly, using `SourcePanel` as a real example.

### Step 1: Identify the Problem

**Symptoms:**
- Component re-renders when typing in an unrelated input
- Component re-renders when scrolling
- React DevTools Profiler shows unexpected renders

**How to detect:**

~~Add a console.log at the top of the component~~ - **This doesn't work with React Compiler!**

```jsx
// DON'T DO THIS - React Compiler may optimize this away
function SourcePanel({ citations }) {
  console.log('[SourcePanel] render'); // May not log!
  // ...
}
```

**Why it doesn't work:** React Compiler transforms the component code. It may:
- Move code around during optimization
- Memoize sections so they don't run every render
- Skip calling the function body entirely for cached renders

**Instead, use React DevTools:**
1. Open React DevTools → Profiler tab
2. Click gear icon → Enable "Highlight updates when components render"
3. Interact with the app - components that re-render will flash

Or skip to **Step 2** (comparison function logging) which always works.

**⚠️ HMR Warning:** Hot Module Replacement can cause false positives when debugging memoization. HMR may:
- Keep old component instances with stale comparison functions
- Hold references to old callback versions
- Not properly update memo() wrappers

**Always do a full build + page refresh** before concluding that memoization isn't working. Many "bugs" are actually HMR artifacts that disappear after a fresh load.

### Step 2: Add Debug Comparison Function

Replace simple `memo()` with a custom comparison that logs which props changed:

```jsx
// BEFORE: Simple memo (might not work with React Compiler)
export const SourcePanel = memo(function SourcePanel({ citations }) {
  // ...
});

// AFTER: Debug version with logging
export const SourcePanel = memo(function SourcePanel({ citations }) {
  // ...
}, (prevProps, nextProps) => {
  const keys = ['citations']; // List all prop names
  const changed = keys.filter(k => prevProps[k] !== nextProps[k]);
  if (changed.length > 0) {
    console.log('[SourcePanel] props changed:', changed);
  }
  return changed.length === 0;
});
```

### Step 3: Analyze the Output

Run the app and trigger the re-render (e.g., type in input). Check console:

```
[SourcePanel] props changed: ['citations']  // Props ARE changing
```
or
```
[SourcePanel] render                         // No log = comparison not even running
```

**If props are changing:** The parent is passing new object references. Go to Step 4.

**If comparison isn't running:** The parent component itself is recreating the child element. Check if SourcePanel is rendered inside a `.map()` or conditional.

### Step 4: Trace Back to Parent

Find where the component is used:

```jsx
// In App.jsx or parent component
<SourcePanel citations={msg.citations} />
```

Check if `msg.citations` is being recreated on every render:
- Is `msg` from state that's being spread/copied?
- Is there a `.map()` creating new objects?

### Step 5: Fix the Issues

**Issue 1: Missing custom comparison**

```jsx
// Add explicit comparison
export const SourcePanel = memo(function SourcePanel({ citations }) {
  // ...
}, (prevProps, nextProps) => {
  return prevProps.citations === nextProps.citations;
});
```

**Issue 2: List items not memoized**

```jsx
// BEFORE: SourceCard is not memoized
function SourceCard({ index, source }) {
  return <div>...</div>;
}

// AFTER: Wrap in memo with comparison
const SourceCard = memo(function SourceCard({ index, source }) {
  return <div>...</div>;
}, (prevProps, nextProps) => {
  return (
    prevProps.index === nextProps.index &&
    prevProps.source === nextProps.source
  );
});
```

**Issue 3: Inline functions in parent**

```jsx
// BEFORE: Inline function creates new reference
<SourcePanel onClose={() => setShowSources(false)} />

// AFTER: Stable callback
const handleClose = useCallback(() => setShowSources(false), []);
<SourcePanel onClose={handleClose} />
```

### Step 6: Verify the Fix

1. Keep the debug logging temporarily
2. Trigger the action that caused re-renders
3. Confirm no more `props changed` logs appear
4. Remove debug logging before committing

### Step 7: Remove Debug Code

```jsx
// Final version: custom comparison without logging
export const SourcePanel = memo(function SourcePanel({ citations }) {
  // component code
}, (prevProps, nextProps) => {
  return prevProps.citations === nextProps.citations;
});
```

---

## Quick Debugging Checklist

When a memoized component still re-renders:

- [ ] Is `memo()` actually wrapping the component?
- [ ] Add custom comparison function (default may not work with React Compiler)
- [ ] Check if any props are objects/arrays being recreated
- [ ] Check if any props are callbacks without `useCallback()`
- [ ] If component renders a list, are list items also memoized?
- [ ] Is the component rendered inside a `.map()` in the parent?

### React DevTools Profiler

Enable "Highlight updates when components render" to visually see re-renders.

---

## Case Study: Fixing Eval Tab Re-renders

This section documents the systematic fix of re-render issues in the Eval tab components.

### Problem

When typing in the EvalJsonEditor text box, all Eval components (EvalSidebar, EvalRunner, EvalJsonEditor) were re-rendering unnecessarily.

### Analysis

| Component | Had memo() | Had Custom Comparison | Issues Found |
|-----------|------------|----------------------|--------------|
| EvalSidebar | ✓ | ✗ | Missing custom comparison |
| EvalRunner | ✓ | ✗ | Missing custom comparison, inline callbacks, non-memoized functions |
| EvalJsonEditor | ✓ | ✗ | Missing custom comparison |
| EvalResults | ✓ | ✗ | Missing custom comparison |

### Fixes Applied

**1. Added custom comparison functions to all components:**

```jsx
// EvalSidebar - only compare selection state, not callbacks
}, (prevProps, nextProps) => {
  return (
    prevProps.selectedEvaluation === nextProps.selectedEvaluation &&
    prevProps.selectedSuite === nextProps.selectedSuite &&
    prevProps.selectedResult === nextProps.selectedResult
  );
});

// EvalRunner - only compare value props
}, (prevProps, nextProps) => {
  return (
    prevProps.evaluation === nextProps.evaluation &&
    prevProps.suite === nextProps.suite &&
    prevProps.viewingResults === nextProps.viewingResults
  );
});

// EvalJsonEditor - only compare data props
}, (prevProps, nextProps) => {
  return (
    prevProps.evaluation === nextProps.evaluation &&
    prevProps.evalDetails === nextProps.evalDetails
  );
});

// EvalResults - only compare results
}, (prevProps, nextProps) => {
  return prevProps.results === nextProps.results;
});
```

**2. Wrapped callbacks in useCallback (EvalRunner):**

```jsx
// loadEvaluationDetails - used in useEffect deps
const loadEvaluationDetails = useCallback(async (path) => {
  // ... fetch logic
}, []);

// handleSave - passed to EvalJsonEditor
const handleSave = useCallback((updatedEval) => {
  setEvalDetails(updatedEval);
}, []);

// handleCloseResults - passed to EvalResults
const handleCloseResults = useCallback(() => {
  setResults(null);
  setJobId(null);
}, []);
```

**3. Fixed inline callback:**

```jsx
// BEFORE: Inline function creates new reference every render
<EvalResults
  results={results}
  onClose={() => {
    setResults(null);
    setJobId(null);
  }}
/>

// AFTER: Stable callback reference
<EvalResults
  results={results}
  onClose={handleCloseResults}
/>
```

### Key Takeaways

1. **Custom comparison functions should NOT compare callback props** - callbacks may have new references but same behavior, and comparing them defeats the purpose of memoization.

2. **Look for functions used in useEffect dependency arrays** - these need useCallback to prevent infinite re-render loops or unnecessary effect triggers.

3. **Look for inline callbacks passed to memoized children** - these break memoization and should be extracted to useCallback.

4. **Apply fixes systematically** - check all memoized components in a feature area, not just the one you notice re-rendering.

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
