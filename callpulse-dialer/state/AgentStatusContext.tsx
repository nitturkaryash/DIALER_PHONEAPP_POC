import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
  AuthError,
  clearAgentStatus,
  getAgentStatusCodes,
  getCurrentAgentStatus,
  getToken,
  selectAgentStatus,
} from "../services/api";
import type { AgentStatusCode, AgentStatusCurrent } from "../types";

type AgentStatusContextValue = {
  codes: AgentStatusCode[];
  current: AgentStatusCurrent | null;
  isOnBreak: boolean;
  currentCode: AgentStatusCode | null;
  elapsedSeconds: number;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  selectCode: (codeId: string) => Promise<void>;
  clearCurrent: () => Promise<void>;
};

const AgentStatusContext = createContext<AgentStatusContextValue | null>(null);

function isoToMs(value?: string | null): number {
  if (!value) return Date.now();
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? Date.now() : t;
}

type ProviderProps = {
  children: React.ReactNode;
  /** Bump this counter from outside to force a re-fetch (e.g. on login). */
  authVersion?: number;
};

export function AgentStatusProvider({ children, authVersion = 0 }: ProviderProps) {
  const [codes, setCodes] = useState<AgentStatusCode[]>([]);
  const [current, setCurrent] = useState<AgentStatusCurrent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const token = await getToken();
      if (!token) {
        setCodes([]);
        setCurrent(null);
        return;
      }
      const [codeList, currentStatus] = await Promise.all([
        getAgentStatusCodes(token).catch(() => [] as AgentStatusCode[]),
        getCurrentAgentStatus(token).catch(() => null),
      ]);
      setCodes(codeList);
      setCurrent(currentStatus);
    } catch (e) {
      if (e instanceof AuthError) {
        setCodes([]);
        setCurrent(null);
        return;
      }
      setError(e instanceof Error ? e.message : "Unable to load agent status");
    } finally {
      setLoading(false);
    }
  }, []);

  // refresh on mount + whenever the parent bumps authVersion (i.e. login event)
  useEffect(() => {
    refresh();
  }, [refresh, authVersion]);

  // tick a `now` value when on break so the elapsed timer animates
  useEffect(() => {
    if (current && !current.ended_at) {
      tickerRef.current = setInterval(() => setNow(Date.now()), 1000);
      return () => {
        if (tickerRef.current) clearInterval(tickerRef.current);
        tickerRef.current = null;
      };
    }
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    return undefined;
  }, [current]);

  const selectCode = useCallback(async (codeId: string) => {
    const token = await getToken();
    if (!token) throw new AuthError();
    await selectAgentStatus(token, codeId);
    await refresh();
  }, [refresh]);

  const clearCurrent = useCallback(async () => {
    const token = await getToken();
    if (!token) throw new AuthError();
    await clearAgentStatus(token);
    await refresh();
  }, [refresh]);

  const value = useMemo<AgentStatusContextValue>(() => {
    const isOnBreak = Boolean(current && !current.ended_at);
    const currentCode = current
      ? codes.find((c) => c.id === current.agent_status_id) || null
      : null;
    const elapsedSeconds = current
      ? Math.max(0, Math.floor((now - isoToMs(current.started_at)) / 1000))
      : 0;
    return {
      codes,
      current,
      isOnBreak,
      currentCode,
      elapsedSeconds,
      loading,
      error,
      refresh,
      selectCode,
      clearCurrent,
    };
  }, [codes, current, now, loading, error, refresh, selectCode, clearCurrent]);

  return <AgentStatusContext.Provider value={value}>{children}</AgentStatusContext.Provider>;
}

export function useAgentStatus(): AgentStatusContextValue {
  const ctx = useContext(AgentStatusContext);
  if (!ctx) {
    throw new Error("useAgentStatus must be used inside <AgentStatusProvider>");
  }
  return ctx;
}
