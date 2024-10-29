import React, { createContext, useContext, useState } from 'react';
import { Mode } from '../components/ModeSelector';

interface ModeContextType {
  selectedMode: Mode;
  setSelectedMode: (mode: Mode) => void;
}

const ModeContext = createContext<ModeContextType | undefined>(undefined);

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [selectedMode, setSelectedMode] = useState<Mode>('customer');

  return (
    <ModeContext.Provider value={{ selectedMode, setSelectedMode }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  const context = useContext(ModeContext);
  if (context === undefined) {
    throw new Error('useMode must be used within a ModeProvider');
  }
  return context;
}