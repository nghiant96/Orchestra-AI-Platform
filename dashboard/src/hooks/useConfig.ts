import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import type { SystemConfig, ConfigFormData } from '../types/index.js';
import { apiFetch, apiJson } from '../utils/api';

export const useConfig = () => {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchConfig = useCallback(() => {
    apiJson<SystemConfig>(`/config?t=${Date.now()}`)
      .then((data) => {
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
      const res = await apiFetch('/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        fetchConfig();
        toast.success("Configuration updated successfully");
        return { ok: true };
      } else {
        const err = await res.json();
        toast.error(`Update failed: ${err.error}`);
        return { ok: false, error: err.error };
      }
    } catch (error) {
      console.error('Failed to update config:', error);
      toast.error("Network error while updating configuration");
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
