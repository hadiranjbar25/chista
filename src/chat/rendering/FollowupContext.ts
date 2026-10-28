import { createContext } from 'react';

export const FollowupContext = createContext<(prompt: string) => void>(() => {});
