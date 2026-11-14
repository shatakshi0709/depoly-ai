/**
 * @file useDesktopNotifications.js
 * @description Hook bridging Web App UI with Electron Native Desktop APIs.
 * Course Subject: Interactive System Development (Electron IPC & Native OS Integration)
 */

import { useEffect } from 'react';
import { DEPLOYMENT_STATUS } from '@deplo/shared';

function isElectron() {
  return typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);
}

function notify(title, body, status) {
  if (isElectron() && typeof window.electronAPI.showNotification === 'function') {
    window.electronAPI.showNotification({ title, body, status });
    return;
  }
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body }); } catch { /* ignore */ }
  }
}

export function useDesktopNotifications(deployment, projectName) {
  useEffect(() => {
    if (!deployment?.status) return;

    if (deployment.status === DEPLOYMENT_STATUS.SUCCESS) {
      notify(
        'Deployment Successful',
        `"${projectName || 'Your project'}" deployed successfully (backend + frontend).`,
        'SUCCESS'
      );
      if (isElectron() && typeof window.electronAPI.updateBadge === 'function') {
        window.electronAPI.updateBadge(0);
      }
    } else if (deployment.status === DEPLOYMENT_STATUS.FAILED) {
      notify(
        'Deployment Failed',
        `Pipeline for "${projectName || 'Your project'}" failed. Check logs for details.`,
        'FAILED'
      );
      if (isElectron() && typeof window.electronAPI.updateBadge === 'function') {
        window.electronAPI.updateBadge(1);
      }
    }
  }, [deployment?.status, deployment?.id, projectName]);
}

export function requestBrowserNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch { /* ignore */ }
  }
}

