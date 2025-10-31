// Dynamic configuration loader
// Config is fetched from the platform API at runtime, allowing changes without redeployment

export interface AgentConfig {
  agent: {
    name: string;
    systemPrompt: string;
    model: string;
    rules: string[];
  };
  services: {
    webSearch: boolean;
    webSearchProvider?: string;
    browserProvider?: string;
    codeExecutionProvider?: string;
    fileSystemProvider?: string;
    emailProvider?: string;
    tools: Array<{ id: string; name: string; description: string; enabled: boolean }>;
    connectedApps: string[];
    enabledSkills: string[];
    mcps: Array<{ name: string; url: string; enabled: boolean }>;
  };
  uiCustomization: {
    chatLayout: string;
    filesystemVisible: boolean;
    todoListVisible: boolean;
    toolCallsView: string;
    theme: 'light' | 'dark';
    primaryColor: string;
  };
  deploymentId: string;
  lastUpdated: string;
}

// Cache configuration for performance
let cachedConfig: AgentConfig | null = null;
let lastFetchTime = 0;
const CACHE_DURATION = 10000; // 10 seconds - faster updates, still performant

/**
 * Fetches agent configuration from the platform API
 * Configuration is cached for 10 seconds for performance
 * Falls back to default config if platform is unavailable
 * 
 * To get updates instantly without waiting:
 * - Hard refresh browser (Cmd+Shift+R)
 * - Click "Refresh Config" button in UI
 * - Open new tab/session
 */
export async function getAgentConfig(): Promise<AgentConfig> {
  const now = Date.now();
  
  // Return cached config if still fresh
  if (cachedConfig && (now - lastFetchTime) < CACHE_DURATION) {
    return cachedConfig;
  }
  
  const platformUrl = process.env.NEXT_PUBLIC_PLATFORM_API_URL;
  const deploymentId = process.env.NEXT_PUBLIC_DEPLOYMENT_ID;
  
  if (!platformUrl || !deploymentId) {
    console.warn('Platform URL or Deployment ID not configured. Using default config.');
    return getDefaultConfig();
  }
  
  try {
    const configUrl = `${platformUrl}/api/deployments/${deploymentId}/config`;
    console.log('[Config] Fetching from:', configUrl);
    
    const response = await fetch(configUrl, {
      next: { revalidate: 30 }, // Next.js cache revalidation
      cache: 'no-store', // Don't cache during development
    });
    
    console.log('[Config] Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Config] API error response:', errorText.substring(0, 200));
      throw new Error(`Config API returned ${response.status}`);
    }
    
    const config = await response.json();
    cachedConfig = config;
    lastFetchTime = now;
    
    console.log('✅ Agent config loaded from platform:', {
      name: config.agent?.name,
      hasPrompt: !!config.agent?.systemPrompt,
      deploymentId: config.deploymentId
    });
    return config;
  } catch (error) {
    console.error('❌ Failed to fetch agent config from platform:', error);
    
    // Fall back to cached config if available
    if (cachedConfig) {
      console.warn('⚠️ Using stale cached config');
      return cachedConfig;
    }
    
    // Last resort: use default config
    console.warn('⚠️ Using default config as fallback');
    return getDefaultConfig();
  }
}

/**
 * Returns default configuration as fallback
 * This ensures the agent works even if the platform API is unavailable
 */
function getDefaultConfig(): AgentConfig {
  return {
    agent: {
      name: 'AI Agent',
      systemPrompt: 'You are a helpful AI assistant.',
      model: 'claude-haiku-4-5-20251001',
      rules: [],
    },
    services: {
      webSearch: false,
      tools: [],
      connectedApps: [],
      enabledSkills: [],
      mcps: [],
    },
    uiCustomization: {
      chatLayout: 'single',
      filesystemVisible: false,
      todoListVisible: false,
      toolCallsView: 'compact',
      theme: 'light',
      primaryColor: '#0084ff',
    },
    deploymentId: '',
    lastUpdated: new Date().toISOString(),
  };
}

