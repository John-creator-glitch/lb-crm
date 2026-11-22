import { createContext, useContext } from 'react';
/** true when the desktop menu is collapsed to icons. Pages use it to decide how many columns fit. */
export const SidebarCollapsedContext = createContext(false);
export const useSidebarCollapsed = () => useContext(SidebarCollapsedContext);
