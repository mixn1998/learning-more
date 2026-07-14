import { createContext, useContext, useEffect, type Dispatch, type SetStateAction } from 'react';

export type AppShellHeaderStatus = Readonly<{
  tone: 'success' | 'warning' | 'danger' | 'readonly';
  text: string;
}>;

export const AppShellHeaderStatusContext = createContext<
  Dispatch<SetStateAction<AppShellHeaderStatus | undefined>>
>(() => undefined);

export const AppShellBrandSubtitleContext = createContext<
  Dispatch<SetStateAction<string | undefined>>
>(() => undefined);

export function useAppShellBrandSubtitle(subtitle: string | undefined) {
  const setSubtitle = useContext(AppShellBrandSubtitleContext);

  useEffect(() => {
    setSubtitle(subtitle);
    return () => setSubtitle(undefined);
  }, [setSubtitle, subtitle]);
}

export function useAppShellHeaderStatus(status: AppShellHeaderStatus | undefined) {
  const setStatus = useContext(AppShellHeaderStatusContext);
  const tone = status?.tone;
  const value = status?.text;

  useEffect(() => {
    const next = tone === undefined || value === undefined ? undefined : { tone, text: value };
    setStatus(next);
    return () => setStatus(undefined);
  }, [setStatus, tone, value]);
}
