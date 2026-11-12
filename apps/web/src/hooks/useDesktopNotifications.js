/**
 * @file useDesktopNotifications.js
 * @description Hook bridging Web App UI with Electron Native Desktop APIs.
 * Course Subject: Interactive System Development (Electron IPC & Native OS Integration)
 */

import { useEffect } from 'react';
import { DEPLOYMENT_STATUS } from '@deplo/shared';

export function useDesktopNotifications(deployment, projectName) {
  useEffect(() => {
    if (!deployment || !deployment.status) return;

    const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);

    if (deployment.status === DEPLOYMENT_STATUS.SUCCESS) {
      const title = `Deployment Live! 🚀`;
      const body = `"${projectName || 'Your app'}" has been deployed successfully to Render and Vercel.`;

      if (isElectron) {
        window.electronAPI.showNotification({ title, body, status: 'SUCCESS' });
        window.electronAPI.updateBadge(0);
      } else if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    } else if (deployment.status === DEPLOYMENT_STATUS.FAILED) {
      const title = `Deployment Failed ⚠️`;
      const body = `Pipeline for "${projectName || 'Your app'}" failed: ${deployment.errorMessage || 'Unknown error'}`;

      if (isElectron) {
        window.electronAPI.showNotification({ title, body, status: 'FAILED' });
        window.electronAPI.updateBadge(1);
      } else if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    }
  }, [deployment?.status, projectName]);
}

