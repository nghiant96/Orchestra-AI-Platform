import { useState, useEffect, useCallback } from 'react';
import type { SystemConfig, ConfigFormData } from '../types';

export const useConfig = () => {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchConfig = useCallback(() => {
    fetch(`/config?t=${Date.now()}`)
      .then(res => res.json())
      .then(data => {
        setConfig(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch config:', err);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const updateConfig = async (formData: ConfigFormData) => {
    try {
      const res = await fetch('/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        fetchConfig();
        return { ok: true };
      } else {
        const err = await res.json();
        return { ok: false, error: err.error };
      }
    } catch (error) {
      console.error('Failed to update config:', error);
      return { ok: false, error: 'Failed to update configuration' };
    }
  };

  return {
    config,
    loading,
    fetchConfig,
    updateConfig
  };
};
