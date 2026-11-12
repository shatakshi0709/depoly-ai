/**
 * @file env.controller.js
 * @description Controller for managing encrypted environment variables per project.
 */

import prisma from '../config/db.js';
import { encrypt, decrypt } from '../utils/crypto.js';

/**
 * List environment variables for a project with masked secret values.
 */
export async function getEnvVariables(req, res, next) {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: req.user.userId },
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
    const { key, value, serviceTarget = 'SHARED', isSecret = true } = req.body;

    if (!key || value === undefined) {
      return res.status(400).json({ success: false, message: 'Key and value are required.' });
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: req.user.userId },
    });

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    const encryptedValue = encrypt(String(value));

    const envVar = await prisma.environmentVariable.upsert({
      where: {
        projectId_serviceTarget_key: {
          projectId,
          serviceTarget,
          key,
        },
      },
      update: {
        valueEnc: encryptedValue,
        isSecret,
      },
      create: {
        projectId,
        serviceTarget,
        key,
        valueEnc: encryptedValue,
        isSecret,
      },
    });

    res.json({
      success: true,
      message: `Environment variable "${key}" saved.`,
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

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: req.user.userId },
    });

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    await prisma.environmentVariable.delete({
      where: { id: envId },
    });

    res.json({
      success: true,
      message: 'Environment variable deleted.',
    });
  } catch (error) {
    next(error);
  }
}
