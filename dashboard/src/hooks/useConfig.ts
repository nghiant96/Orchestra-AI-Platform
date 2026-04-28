import { useState, useEffect, useCallback } from 'react';
import type { SystemConfig } from '../types/index.js';

export const useConfig = () => {
  const [config, setConfig] = useState<SystemConfig | null>(null);

  const fetchConfig = useCallback(() => {
    fetch('/config')
      .then(res => res.json())
      .then(data => setConfig(data))
      .catch(err => console.error('Failed to fetch config:', err));
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return {
    config,
    refresh: fetchConfig
  };
};
