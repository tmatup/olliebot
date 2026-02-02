import { createContext, useContext, useState, useCallback } from 'react';

// Available modes
export const MODES = {
  CHAT: 'chat',
  EVAL: 'eval',
};

const ModeContext = createContext(null);

export function ModeProvider({ children }) {
  const [mode, setMode] = useState(MODES.CHAT);

  const switchToChat = useCallback(() => setMode(MODES.CHAT), []);
  const switchToEval = useCallback(() => setMode(MODES.EVAL), []);

  const value = {
    mode,
    setMode,
    switchToChat,
    switchToEval,
    isChat: mode === MODES.CHAT,
    isEval: mode === MODES.EVAL,
  };

  return (
    <ModeContext.Provider value={value}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  const context = useContext(ModeContext);
  if (!context) {
    throw new Error('useMode must be used within a ModeProvider');
  }
  return context;
}
