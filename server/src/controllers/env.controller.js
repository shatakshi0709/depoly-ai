/**
 * @file env.controller.js
 * @description Controller for managing encrypted environment variables per project.
 */

import prisma from '../config/db.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { isUuid, isSafeEnvKey, isValidServiceTarget } from '../utils/validate.js';

/**
 * List environment variables for a project with masked secret values.
 */
export async function getEnvVariables(req, res, next) {
  try {
    const { projectId } = req.params;
    if (!isUuid(projectId)) {
      return res.status(400).json({ success: false, message: 'Invalid project identifier.' });
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: req.user.userId },
      select: { id: true },
    });

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    const envs = await prisma.environmentVariable.findMany({
      where: { projectId },
      orderBy: { key: 'asc' },
    });

    const safeEnvs = envs.map((e) => ({
      id: e.id,
      key: e.key,
      value: e.isSecret ? '••••••••••••' : decrypt(e.valueEnc),
      serviceTarget: e.serviceTarget,
      isSecret: e.isSecret,
      updatedAt: e.updatedAt,
    }));

    res.json({
      success: true,
      data: safeEnvs,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Create or update an environment variable with AES-256 encryption.
 */
export async function saveEnvVariable(req, res, next) {
  try {
    const { projectId } = req.params;
    const { key, value, serviceTarget = 'SHARED', isSecret = true } = req.body || {};

    if (!isUuid(projectId)) {
      return res.status(400).json({ success: false, message: 'Invalid project identifier.' });
    }
    if (!isSafeEnvKey(key)) {
      return res.status(400).json({ success: false, message: 'Invalid environment variable key.' });
    }
    if (value === undefined || value === null || typeof value !== 'string' || value.length > 8192) {
      return res.status(400).json({ success: false, message: 'A valid environment variable value is required.' });
    }
    if (!isValidServiceTarget(serviceTarget)) {
      return res.status(400).json({ success: false, message: 'Invalid service target.' });
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: req.user.userId },
      select: { id: true },
    });

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    const normalizedKey = key.trim();
    const encryptedValue = encrypt(value);

    const envVar = await prisma.environmentVariable.upsert({
      where: {
        projectId_serviceTarget_key: {
          projectId,
          serviceTarget,
          key: normalizedKey,
        },
      },
      update: {
        valueEnc: encryptedValue,
        isSecret: Boolean(isSecret),
      },
      create: {
        projectId,
        serviceTarget,
        key: normalizedKey,
        valueEnc: encryptedValue,
        isSecret: Boolean(isSecret),
      },
    });

    res.json({
      success: true,
      message: `Environment variable saved.`,
      data: {
        id: envVar.id,
        key: envVar.key,
        serviceTarget: envVar.serviceTarget,
        isSecret: envVar.isSecret,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete an environment variable.
 */
export async function deleteEnvVariable(req, res, next) {
  try {
    const { projectId, envId } = req.params;

    if (!isUuid(projectId) || !isUuid(envId)) {
      return res.status(400).json({ success: false, message: 'Invalid identifier.' });
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: req.user.userId },
      select: { id: true },
    });

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    const result = await prisma.environmentVariable.deleteMany({
      where: { id: envId, projectId },
    });

    if (result.count === 0) {
      return res.status(404).json({ success: false, message: 'Environment variable not found.' });
    }

    res.json({
      success: true,
      message: 'Environment variable deleted.',
    });
  } catch (error) {
    next(error);
  }
}

