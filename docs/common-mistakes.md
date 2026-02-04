# Common Mistakes & How to Avoid Them

This document captures common mistakes made during development and their solutions.

---

## React Performance Mistakes

### 1. Forgetting Custom Comparison Functions for memo()

**Mistake:** Using `memo()` without a custom comparison function.

```jsx
// BAD - React Compiler may not honor default shallow comparison
export const MyComponent = memo(function MyComponent({ data, onSelect }) {
  // ...
});
```

**Solution:** Always add explicit comparison for memoized components.

```jsx
// GOOD - Explicit comparison, don't compare callbacks
export const MyComponent = memo(function MyComponent({ data, onSelect }) {
  // ...
}, (prevProps, nextProps) => {
  return prevProps.data === nextProps.data;
  // Don't compare onSelect - callbacks may have new references
});
```

### 2. Not Wrapping Callbacks in useCallback

**Mistake:** Passing inline functions to memoized children.

```jsx
// BAD - New function reference on every render
<MemoizedChild onClose={() => setOpen(false)} />
```

**Solution:** Use `useCallback` for stable references.

```jsx
// GOOD - Stable reference
const handleClose = useCallback(() => setOpen(false), []);
<MemoizedChild onClose={handleClose} />
```

### 3. State in Parent Causing Child Re-renders

**Mistake:** Managing input state in parent component.

```jsx
// BAD - Parent re-renders on every keystroke
function Parent() {
  const [input, setInput] = useState('');
  return <MemoizedChild value={input} onChange={setInput} />;
}
```

**Solution:** Extract input into its own component (ChatInput pattern).

```jsx
// GOOD - Input manages its own state
function InputComponent({ onSubmit }) {
  const [input, setInput] = useState('');
  return <input value={input} onChange={e => setInput(e.target.value)} />;
}
```

### 4. Trusting HMR for Memoization Testing

**Mistake:** Thinking memoization is broken when it's just HMR artifacts.

**Solution:** Always do a full build + page refresh when debugging memoization issues.

---

## CSS Mistakes

### 1. Forgetting Scrollbar Styling

**Mistake:** Adding `overflow-y: auto` without styling the scrollbar.

```css
/* BAD - Uses ugly default scrollbar */
.my-container {
  overflow-y: auto;
}
```

**Solution:** Add matching scrollbar styles.

```css
/* GOOD - Consistent with app theme */
.my-container {
  overflow-y: auto;
}

.my-container::-webkit-scrollbar {
  width: 6px;
}

.my-container::-webkit-scrollbar-track {
  background: var(--bg-secondary);
}

.my-container::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}

.my-container::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}
```

### 2. Fixed Positioning Without Viewport Calculation

**Mistake:** Using fixed position without proper coordinate calculation.

```jsx
// BAD - Position relative to wrong reference point
setMenuPosition({ top: element.offsetTop, left: element.offsetLeft });
```

**Solution:** Use `getBoundingClientRect()` for viewport-relative positioning.

```jsx
// GOOD - Correct viewport-relative coordinates
const rect = element.getBoundingClientRect();
setMenuPosition({ top: rect.top, left: rect.left });
```

### 3. Not Limiting Expandable Content

**Mistake:** Allowing accordions/expandable sections to take unlimited space.

```css
/* BAD - Can push other content off screen */
.accordion-container {
  /* no max-height */
}
```

**Solution:** Add max-height and overflow.

```css
/* GOOD - Limited to half the parent */
.accordion-container {
  max-height: 50%;
  overflow-y: auto;
}
```

---

## Component Structure Mistakes

### 1. Inline Callbacks in JSX

**Mistake:** Defining callbacks inline in render.

```jsx
// BAD - Creates new function reference every render
<EvalResults onClose={() => { setResults(null); setJobId(null); }} />
```

**Solution:** Extract to a named, memoized callback.

```jsx
// GOOD - Stable reference
const handleCloseResults = useCallback(() => {
  setResults(null);
  setJobId(null);
}, []);

<EvalResults onClose={handleCloseResults} />
```

### 2. Functions in useEffect Dependencies Without useCallback

**Mistake:** Using a function in useEffect deps that isn't memoized.

```jsx
// BAD - Causes infinite loop or unnecessary re-runs
const loadData = async () => { /* ... */ };

useEffect(() => {
  loadData();
}, [loadData]); // loadData changes every render!
```

**Solution:** Wrap the function in useCallback.

```jsx
// GOOD - Stable function reference
const loadData = useCallback(async () => { /* ... */ }, []);

useEffect(() => {
  loadData();
}, [loadData]);
```

### 3. Using State Directly in useCallback Instead of Refs

**Mistake:** Including state in useCallback dependencies.

```jsx
// BAD - Callback changes when currentId changes
const handleSubmit = useCallback(() => {
  sendMessage({ id: currentId });
}, [currentId]); // Callback recreated when currentId changes
```

**Solution:** Use refs to access current state without dependencies.

```jsx
// GOOD - Stable callback, reads current value via ref
const currentIdRef = useRef(currentId);
useEffect(() => { currentIdRef.current = currentId; }, [currentId]);

const handleSubmit = useCallback(() => {
  sendMessage({ id: currentIdRef.current });
}, []); // Empty deps = stable callback
```

---

## Git Mistakes

### 1. Using --amend After Failed Pre-commit Hook

**Mistake:** Using `git commit --amend` after a pre-commit hook failure.

The hook failure means the commit never happened, so `--amend` modifies the PREVIOUS commit!

**Solution:** After fixing hook issues, create a NEW commit.

```bash
# After pre-commit hook fails and you fix the issues:
git add .
git commit -m "Fix: ..."  # NEW commit, not --amend
```

### 2. Force Pushing to Main

**Mistake:** Using `git push --force` on main/master branch.

**Solution:** Never force push to shared branches. Use `--force-with-lease` if absolutely necessary, and prefer creating a new commit instead.

---

## Debugging Mistakes

### 1. Using console.log in Component Body with React Compiler

**Mistake:** Expecting console.log to run on every render.

```jsx
// BAD - React Compiler may optimize this away
function MyComponent() {
  console.log('render'); // May not log!
  return <div>...</div>;
}
```

**Solution:** Use comparison function logging or React DevTools Profiler.

```jsx
// GOOD - Comparison function always runs
export const MyComponent = memo(function MyComponent(props) {
  return <div>...</div>;
}, (prevProps, nextProps) => {
  console.log('props comparison running');
  return prevProps.data === nextProps.data;
});
```

---

## Quick Reference: The Memoization Checklist

When a memoized component still re-renders:

- [ ] Is `memo()` actually wrapping the component?
- [ ] Does it have a custom comparison function?
- [ ] Are callbacks wrapped in `useCallback()`?
- [ ] Are objects/arrays props wrapped in `useMemo()`?
- [ ] Did you do a full build + refresh (not just HMR)?
- [ ] If component renders a list, are list items also memoized?
