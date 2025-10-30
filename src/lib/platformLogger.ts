/**
 * Platform Logger - Handles session and message logging to the main platform
 * 
 * This module provides functionality to track user conversations and send them
 * back to the platform. Logging is optional and will fail gracefully if env vars
 * are not configured.
 */

interface SessionData {
  deploymentId: string;
  userIdentifier: string;
  userAgent: string;
}

interface MessageData {
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
  };
}

interface SessionResponse {
  session: {
    id: string;
  };
}

/**
 * Get the platform API URL from environment variables
 */
function getPlatformUrl(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  
  const url = process.env.NEXT_PUBLIC_PLATFORM_API_URL;
  return url && url.trim() !== '' ? url : null;
}

/**
 * Get the deployment ID from environment variables
 */
function getDeploymentId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  
  const id = process.env.NEXT_PUBLIC_DEPLOYMENT_ID;
  return id && id.trim() !== '' ? id : null;
}

/**
 * Check if logging is enabled (both env vars are set)
 */
export function isLoggingEnabled(): boolean {
  return getPlatformUrl() !== null && getDeploymentId() !== null;
}

/**
 * Get or create a user identifier from localStorage
 * This is used for anonymous tracking of users
 */
export function getUserIdentifier(): string {
  const storageKey = 'agentUserId';
  
  try {
    let userId = localStorage.getItem(storageKey);
    
    if (!userId) {
      // Generate a random user ID
      userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      localStorage.setItem(storageKey, userId);
      console.log('[Platform Logger] Generated new user identifier:', userId);
    }
    
    return userId;
  } catch (error) {
    console.error('[Platform Logger] Error accessing localStorage:', error);
    // Fallback to a session-only identifier
    return `temp_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
}

/**
 * Create a new session with the platform
 * Returns the session ID if successful, null otherwise
 */
export async function createSession(): Promise<string | null> {
  if (!isLoggingEnabled()) {
    console.log('[Platform Logger] Session logging disabled - env vars not set');
    return null;
  }
  
  const platformUrl = getPlatformUrl();
  const deploymentId = getDeploymentId();
  
  if (!platformUrl || !deploymentId) {
    return null;
  }
  
  try {
    const sessionData: SessionData = {
      deploymentId,
      userIdentifier: getUserIdentifier(),
      userAgent: navigator.userAgent,
    };
    
    console.log('[Platform Logger] Creating session...', {
      deploymentId,
      userIdentifier: sessionData.userIdentifier,
    });
    
    const response = await fetch(`${platformUrl}/api/logs/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sessionData),
    });
    
    if (!response.ok) {
      console.error('[Platform Logger] Failed to create session:', response.status, response.statusText);
      return null;
    }
    
    const data: SessionResponse = await response.json();
    console.log('[Platform Logger] Session created:', data.session.id);
    return data.session.id;
  } catch (error) {
    console.error('[Platform Logger] Error creating session:', error);
    return null;
  }
}

/**
 * Log a message to the platform
 * Fails silently if logging is disabled or if the request fails
 */
export async function logMessage(
  sessionId: string | null,
  role: 'user' | 'assistant',
  content: string,
  metadata?: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
  }
): Promise<void> {
  if (!isLoggingEnabled() || !sessionId) {
    // Silently skip logging if disabled or no session
    return;
  }
  
  const platformUrl = getPlatformUrl();
  
  if (!platformUrl) {
    return;
  }
  
  try {
    const messageData: MessageData = {
      sessionId,
      role,
      content,
      metadata,
    };
    
    console.log('[Platform Logger] Logging message:', {
      sessionId,
      role,
      contentLength: content.length,
      metadata,
    });
    
    const response = await fetch(`${platformUrl}/api/logs/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messageData),
    });
    
    if (!response.ok) {
      console.error('[Platform Logger] Failed to log message:', response.status, response.statusText);
    } else {
      console.log('[Platform Logger] Message logged successfully');
    }
  } catch (error) {
    console.error('[Platform Logger] Error logging message:', error);
  }
}

