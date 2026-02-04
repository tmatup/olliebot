import { createContext, useContext, useState } from 'react';

// Available modes
export const MODES = {
  CHAT: 'chat',
  EVAL: 'eval',
};

const ModeContext = createContext(null);

export function ModeProvider({ children }) {
  const [mode, setMode] = useState(MODES.CHAT);

  const switchToChat = () => setMode(MODES.CHAT);
  const switchToEval = () => setMode(MODES.EVAL);

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
