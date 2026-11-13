import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import prisma from '../config/db.js';
import { env } from '../config/env.js';
import { encrypt } from '../utils/crypto.js';
import { isNonEmptyString, isValidEmail, normalizeEmail } from '../utils/validate.js';
import { createOAuthState, verifyOAuthState } from '../utils/oauthState.js';
import { sanitizeText } from '../utils/sanitize.js';

/**
 * Generate a signed JWT for an authenticated user.
 */
function generateToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, fullName: user.fullName },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
}

/**
 * Register a new user with email and password.
 */
export async function register(req, res, next) {
  try {
    const { email, password, fullName } = req.body || {};

    if (!isValidEmail(email) || typeof password !== 'string' || !isNonEmptyString(fullName)) {
      return res.status(400).json({
        success: false,
        message: 'A valid email, password, and full name are required.',
      });
    }

    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({
        success: false,
        message: 'Password must be between 8 and 128 characters.',
      });
    }

    if (fullName.trim().length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Full name is too long.',
      });
    }

    const normalizedEmail = normalizeEmail(email);

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'A user with this email address already exists.',
      });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        fullName: fullName.trim(),
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    const token = generateToken(newUser);

    res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      data: {
        token,
        user: newUser,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Log in an existing user with email and password.
 */
export async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};

    if (!isValidEmail(email) || typeof password !== 'string' || password.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'A valid email and password are required.',
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        oauthAccounts: {
          select: { provider: true, createdAt: true },
        },
      },
    });

    if (!user || !user.passwordHash) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password credentials.',
      });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password credentials.',
      });
    }

    const token = generateToken(user);

    res.json({
      success: true,
      message: 'Logged in successfully.',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          avatarUrl: user.avatarUrl,
          oauthAccounts: user.oauthAccounts,
          createdAt: user.createdAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get profile of the currently authenticated user.
 */
export async function getMe(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        createdAt: true,
        oauthAccounts: {
          select: {
            provider: true,
            providerUserId: true,
            createdAt: true,
          },
        },
        _count: {
          select: { projects: true },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    res.json({
      success: true,
      data: {
        ...user,
        hasGithubConnected: user.oauthAccounts.some((acc) => acc.provider === 'github'),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Start GitHub OAuth flow (returns signed state for CSRF protection).
 */
export async function githubOAuthStart(req, res, next) {
  try {
    if (!env.GITHUB_CLIENT_ID) {
      return res.status(503).json({ success: false, message: 'GitHub OAuth is not configured on the server.' });
    }
    const state = createOAuthState({ t: 'github_oauth' });
    const redirectUri = env.GITHUB_CALLBACK_URL;
    const params = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: 'repo,read:user,user:email',
      state,
    });
    res.json({
      success: true,
      data: {
        state,
        authorizeUrl: `https://github.com/login/oauth/authorize?${params.toString()}`,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Handle GitHub OAuth callback: exchanges temporary code for user token and links account.
 */
export async function githubOAuthCallback(req, res, next) {
  try {
    const { code, state } = req.body || {};

    if (!isNonEmptyString(code) || code.length > 256) {
      return res.status(400).json({
        success: false,
        message: 'A valid OAuth authorization code is required.',
      });
    }
    if (!isNonEmptyString(state) || state.length > 1024) {
      return res.status(400).json({
        success: false,
        message: 'A valid OAuth state is required.',
      });
    }
    const stateCheck = verifyOAuthState(state);
    if (!stateCheck.ok) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OAuth state. Please try signing in again.',
      });
    }

    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      return res.status(503).json({
        success: false,
        message: 'GitHub OAuth is not configured on the server.',
      });
    }

    // 1. Exchange authorization code for GitHub access token
    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code: String(code).trim(),
        redirect_uri: env.GITHUB_CALLBACK_URL,
        state: String(state),
      },
      {
        headers: { Accept: 'application/json' },
      }
    );

    const { access_token: githubAccessToken, error } = tokenResponse.data || {};

    if (error || !githubAccessToken) {
      return res.status(400).json({
        success: false,
        message: 'Failed to exchange GitHub authorization code.',
      });
    }

    // 2. Fetch authenticated GitHub user details
    const ghUserResponse = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${githubAccessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    const ghUser = ghUserResponse.data || {};
    const providerUserId = String(ghUser.id || '');
    if (!providerUserId) {
      return res.status(400).json({ success: false, message: 'Failed to retrieve GitHub user profile.' });
    }
    const email = (typeof ghUser.email === 'string' && ghUser.email.includes('@'))
      ? ghUser.email
      : `${ghUser.login || providerUserId}@users.noreply.github.com`;
    const fullName = sanitizeText(ghUser.name || ghUser.login || 'GitHub User', 100).trim() || 'GitHub User';
    const avatarUrl = typeof ghUser.avatar_url === 'string' ? ghUser.avatar_url.slice(0, 500) : null;

    // Encrypt GitHub access token before saving to database
    const encryptedToken = encrypt(githubAccessToken);

    // 3. Upsert user and link OAuth account in a single transaction
    const user = await prisma.$transaction(async (tx) => {
      // Check if OAuth account exists
      const existingOAuth = await tx.oAuthAccount.findUnique({
        where: {
          provider_providerUserId: {
            provider: 'github',
            providerUserId,
          },
        },
        include: { user: true },
      });

      if (existingOAuth) {
        // Update token and avatar
        await tx.oAuthAccount.update({
          where: { id: existingOAuth.id },
          data: { accessTokenEnc: encryptedToken },
        });

        await tx.user.update({
          where: { id: existingOAuth.userId },
          data: { avatarUrl },
        });

        return existingOAuth.user;
      }

      // If user exists with the same email, link account
      let existingUser = await tx.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (!existingUser) {
        existingUser = await tx.user.create({
          data: {
            email: email.toLowerCase(),
            fullName,
            avatarUrl,
          },
        });
      }

      await tx.oAuthAccount.create({
        data: {
          userId: existingUser.id,
          provider: 'github',
          providerUserId,
          accessTokenEnc: encryptedToken,
        },
      });

      return existingUser;
    });

    const token = generateToken(user);

    res.json({
      success: true,
      message: 'GitHub account connected successfully.',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          avatarUrl: user.avatarUrl,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

